"""Focused checks for merging the crop-code reference sources."""

import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from database.scripts import load_afgroeder as loader
from database.scripts.load_afgroeder import (
    AFGROEDE_COLUMNS,
    build_afgroede_rows,
    registry_names,
)


class AfgroedeLoaderTests(unittest.TestCase):
    def test_merges_all_code_sources_and_preserves_name_priority(self) -> None:
        norm = [
            (
                2,
                1,
                1,
                "Normnavn",
                "JB 1",
                "Uvandet",
                "hkg",
                50.0,
                None,
                100.0,
                20.0,
                5.0,
                True,
                "Konventionel",
            )
        ]
        nfix = [(2, 1, 1, "Uvandet", 7.0)]
        nuar = [(1, "NUAR-navn", 1, 2, 3, 4, 5, False, True, False, True, False)]
        runoff = [(1, "Runoff-navn", 3, 1), (2, "Kun runoff", 4, None)]
        permanent = [(1, "Permanent-navn"), (908, "Kun permanent")]

        rows, conditional = build_afgroede_rows(
            norm,
            nfix,
            nuar,
            runoff,
            permanent,
            {0, 905},
            {905: "Historisk navn"},
        )
        by_code = {row[0]: dict(zip(AFGROEDE_COLUMNS, row, strict=True)) for row in rows}

        self.assertEqual(set(by_code), {1, 2, 905, 908})
        self.assertEqual(by_code[1]["navn"], "NUAR-navn")
        self.assertEqual(by_code[1]["norm_navn"], "Normnavn")
        self.assertEqual(by_code[1]["udbytteenhed"], "hkg")
        self.assertEqual(by_code[1]["p_norm"], 20.0)
        self.assertTrue(by_code[1]["permanent"])
        self.assertEqual(by_code[2]["navn"], "Kun runoff")
        self.assertIsNone(by_code[2]["m"])
        self.assertFalse(by_code[905]["has_nuar"])
        self.assertEqual(by_code[905]["navn"], "Historisk navn")
        self.assertEqual(by_code[908]["navn"], "Kun permanent")
        self.assertEqual(
            conditional, [(2, 1, 1, "JB 1", "Uvandet", 50.0, None, 100.0, "Konventionel")]
        )

    def test_rejects_norm_fields_that_vary_for_one_code(self) -> None:
        row = (
            2,
            1,
            1,
            "Normnavn",
            "JB 1",
            "Uvandet",
            "hkg",
            50.0,
            None,
            100.0,
            20.0,
            5.0,
            True,
            "Konventionel",
        )
        changed = (*row[:10], 21.0, *row[11:])
        with self.assertRaisesRegex(ValueError, "Nonconstant norm attributes"):
            build_afgroede_rows([row, changed], [], [], [], [], set())

    def test_conflicting_source_does_not_write_to_database(self) -> None:
        norm = (
            2,
            1,
            1,
            "Normnavn",
            "JB 1",
            "Uvandet",
            "hkg",
            50.0,
            None,
            100.0,
            20.0,
            5.0,
            True,
            "Konventionel",
        )
        conflicting = (*norm[:10], 21.0, *norm[11:])
        with (
            patch.object(
                loader, "parse_afgroede_normer", return_value=([norm, conflicting], [], [])
            ),
            patch.object(loader, "parse_afstromningskategorier", return_value=[]),
            patch.object(loader, "parse_permanente_afgrodekoder", return_value=[]),
            patch.object(loader, "registry_names", return_value={}),
            patch.object(loader, "registry_codes", return_value=set()),
            patch.object(loader, "replace_tables") as replace,
        ):
            with self.assertRaisesRegex(ValueError, "Nonconstant norm attributes"):
                loader.load_afgroeder()
        replace.assert_not_called()

    def test_registry_name_prefers_full_label(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "registry.gpkg"
            with closing(sqlite3.connect(path)) as connection:
                columns = ", ".join(
                    f"Afg{year} integer, Afg{year}txt text" for year in range(2016, 2027)
                )
                connection.execute(f"CREATE TABLE PlantPerform ({columns})")
                connection.execute(
                    "INSERT INTO PlantPerform (Afg2016, Afg2016txt, Afg2026, Afg2026txt) "
                    "VALUES (905, 'Anden anvendelse', 905, 'Anden anvendelse på tilsagnsarealer')"
                )
                connection.commit()
            self.assertEqual(registry_names(path)[905], "Anden anvendelse på tilsagnsarealer")


if __name__ == "__main__":
    unittest.main()
