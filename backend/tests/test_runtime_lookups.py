import csv
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://dst2:dst2@localhost:5432/dst2",
)

from app.services.rotations import historisk_goedning, saedskifte_library
from database.scripts import load_saedskifte_lookup


def source_row(
    saedskiftevariant: int,
    variant: int,
    category: str,
    *,
    first_crop: str = "10",
    second_crop: str = "",
    second_undersow: str = "20",
    driftsform: str = "Konventionel",
) -> list[str]:
    row = [""] * load_saedskifte_lookup.EXPECTED_COLUMNS
    row[1] = str(saedskiftevariant)
    row[2] = str(variant)
    row[3] = first_crop
    row[7] = second_crop
    row[9] = second_undersow
    row[10] = "Udlæg"
    row[35] = driftsform
    row[38] = category
    return row


def write_lookup(path: Path, rows: list[list[str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.writer(output, delimiter=";")
        for _ in range(load_saedskifte_lookup.HEADER_ROWS_TO_SKIP):
            writer.writerow(["header"])
        writer.writerows(rows)


class SaedskifteLookupLoaderTests(unittest.TestCase):
    def test_parser_deduplicates_categories_for_an_identical_rotation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "lookup.csv"
            write_lookup(
                path,
                [
                    source_row(1, 2, "Plante"),
                    source_row(1, 2, "Øko samlet"),
                    source_row(2, 1, "Konv. kvæg", first_crop="30"),
                ],
            )

            records = load_saedskifte_lookup.parse_saedskifte_lookup(path)

        self.assertEqual(set(records), {(1, 2), (2, 1)})
        self.assertEqual(records[(1, 2)].categories, {"Plante", "Øko samlet"})
        self.assertEqual(records[(1, 2)].rotation[0], (10, None, None))
        self.assertEqual(records[(1, 2)].rotation[1], (None, 20, "Udlæg"))

        _, category_rows = load_saedskifte_lookup._database_rows(records)
        self.assertEqual(
            category_rows,
            [(1, "Plante"), (1, "Øko samlet"), (2, "Konv. kvæg")],
        )

    def test_parser_rejects_conflicting_duplicate_rotation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "lookup.csv"
            write_lookup(
                path,
                [source_row(1, 2, "Plante"), source_row(1, 2, "Plante", first_crop="11")],
            )

            with self.assertRaisesRegex(ValueError, "Conflicting rotation sequence"):
                load_saedskifte_lookup.parse_saedskifte_lookup(path)

    def test_invalid_source_does_not_open_a_database_connection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "lookup.csv"
            path.write_text("header\n" * 4 + "only;two;columns\n", encoding="utf-8")

            with patch.object(load_saedskifte_lookup.psycopg, "connect") as connect:
                with self.assertRaisesRegex(ValueError, "Expected 41 columns"):
                    load_saedskifte_lookup.load_saedskifte_lookup(
                        path,
                        database_url="postgresql+psycopg://user:pass@localhost/db",
                    )

            connect.assert_not_called()


class RuntimeLookupServiceTests(unittest.TestCase):
    def tearDown(self) -> None:
        saedskifte_library.clear_lookup_cache()
        historisk_goedning.clear_historisk_goedning_cache()

    def test_rotation_service_uses_database_rows_and_preserves_behavior(self) -> None:
        rotation_rows = [
            SimpleNamespace(
                saedskiftevariant=1,
                variant=2,
                rotation=[
                    {"afgrode_kode": 10, "udlaeg_kode": None, "udlaeg_navn": None},
                    {"afgrode_kode": None, "udlaeg_kode": 20, "udlaeg_navn": "Udlæg"},
                ] + [
                    {"afgrode_kode": None, "udlaeg_kode": None, "udlaeg_navn": None}
                    for _ in range(6)
                ],
                driftsform="Konventionel",
            ),
            SimpleNamespace(
                saedskiftevariant=2,
                variant=1,
                rotation=[
                    {"afgrode_kode": 30, "udlaeg_kode": None, "udlaeg_navn": None}
                    for _ in range(8)
                ],
                driftsform="Økologisk",
            ),
        ]
        category_rows = [
            SimpleNamespace(saedskiftevariant=1, kategori="Plante"),
            SimpleNamespace(saedskiftevariant=1, kategori="Øko samlet"),
            SimpleNamespace(saedskiftevariant=2, kategori="Øko samlet"),
        ]

        with patch.object(
            saedskifte_library,
            "_fetch_lookup_rows",
            return_value=(rotation_rows, category_rows),
        ):
            saedskifte_library.clear_lookup_cache()
            self.assertEqual(saedskifte_library.list_saedskifter(), ["1", "2"])
            self.assertEqual(saedskifte_library.list_variants("1"), ["2"])
            self.assertEqual(saedskifte_library.get_kategori("1"), ["Plante", "Øko samlet"])
            self.assertEqual(saedskifte_library.get_driftsform("2"), "Økologisk")
            self.assertEqual(
                saedskifte_library.get_raw_rotation("1", "2")[:2],
                [(10, None, None), (10, 20, "Udlæg")],
            )
            self.assertEqual(
                saedskifte_library.generate_rotation("1", "2", start_year=2)[:4],
                [(10, 20, "Udlæg"), (10, None, None), (10, 20, "Udlæg"), (10, None, None)],
            )

    def test_historical_lookup_uses_database_rows_and_region_alias(self) -> None:
        rows = [
            SimpleNamespace(
                region="Øst og Nordjylland",
                driftsform="Konventionel",
                afgroedekode=10,
                jb_nr=4,
                n_type="mineralsk",
                vaerdi=12.5,
            ),
            SimpleNamespace(
                region="Øst og Nordjylland",
                driftsform="Konventionel",
                afgroedekode=10,
                jb_nr=4,
                n_type="organisk",
                vaerdi=4.5,
            ),
        ]

        with patch.object(historisk_goedning, "_fetch_historical_rows", return_value=rows):
            historisk_goedning.clear_historisk_goedning_cache()
            self.assertEqual(
                historisk_goedning.lookup_historisk_n_input(10, 4, "Nordjylland", False),
                {"mncs": 12.5, "g0": 4.5},
            )
            self.assertEqual(
                historisk_goedning.lookup_historisk_n_input(11, 4, "Nordjylland", False),
                {"mncs": 0.0, "g0": 0.0},
            )

    def test_empty_runtime_lookup_has_an_actionable_error(self) -> None:
        with patch.object(saedskifte_library, "_fetch_lookup_rows", return_value=([], [])):
            saedskifte_library.clear_lookup_cache()
            with self.assertRaisesRegex(RuntimeError, "load-saedskifte-lookup"):
                saedskifte_library.list_saedskifter()


if __name__ == "__main__":
    unittest.main()
