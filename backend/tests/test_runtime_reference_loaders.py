import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from database.scripts import runtime_lookup_loader
from database.scripts.load_afgroede_normer import parse_afgroede_normer
from database.scripts.load_afstromningskategorier import parse_afstromningskategorier
from database.scripts.load_arbejdsmaengder import parse_arbejdsmaengder
from database.scripts.load_arbejdssatser import parse_arbejdssatser
from database.scripts.load_dyrkningsomkostninger import parse_dyrkningsomkostninger
from database.scripts.load_halmudbytte import parse_halmudbytte
from database.scripts.load_permanente_afgrodekoder import parse_permanente_afgrodekoder
from database.scripts.load_prisliste import parse_prisliste
from database.scripts.load_salgspriser import parse_salgspriser


def write_csv(
    path: Path, headers: list[str], rows: list[list[str]], *, delimiter: str = ",",
) -> None:
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output, delimiter=delimiter)
        writer.writerow(headers)
        writer.writerows(rows)


MASTER_CSV_HEADERS = [
    "AfgroedeKode", "Navn", "Hovedafgrøde", "Grund6Procent",
    "nuar_m", "nuar_w", "nuar_wc", "nuar_mp", "nuar_wp",
    "udbytteenhed", "indregn_ffv",
    "udbyttenorm_grovsand_konventionel", "n_norm_grovsand_konventionel",
    "p_norm_grovsand_konventionel", "forfrugtsvaerdi_grovsand_konventionel",
    "nfix_normgrp1",
    "nuar_afstromningskategori", "p_afstromningskategori_med_w",
    "kvotegivende_aktivitet", "kvotegivende_areal", "er_permanent_afgroede",
]


def master_csv_row(**overrides: str) -> list[str]:
    row = {
        "AfgroedeKode": "1", "Navn": "Vårbyg", "Hovedafgrøde": "1", "Grund6Procent": "1",
        "nuar_m": "1", "nuar_w": "2", "nuar_wc": "3",
        "nuar_mp": "4", "nuar_wp": "5", "udbytteenhed": "hkg", "indregn_ffv": "Ja",
        "udbyttenorm_grovsand_konventionel": "50", "n_norm_grovsand_konventionel": "100",
        "p_norm_grovsand_konventionel": "20", "forfrugtsvaerdi_grovsand_konventionel": "5",
        "nfix_normgrp1": "7",
        "nuar_afstromningskategori": "3", "p_afstromningskategori_med_w": "1",
        "kvotegivende_aktivitet": "Ja", "kvotegivende_areal": "Ja", "er_permanent_afgroede": "",
    }
    row.update(overrides)
    return [row[header] for header in MASTER_CSV_HEADERS]


class RuntimeReferenceLoaderTests(unittest.TestCase):
    def test_master_csv_loaders_parse_the_wide_afgroedekode_format(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            master = Path(directory) / "master.csv"
            write_csv(master, MASTER_CSV_HEADERS, [master_csv_row()])

            norm_rows, nfix_rows, nuar_rows = parse_afgroede_normer(master)
            runoff_rows = parse_afstromningskategorier(master)
            permanent_rows = parse_permanente_afgrodekoder(master)

        self.assertEqual(nuar_rows[0][0:7], (1, "Vårbyg", 1, 2, 3, 4, 5))
        self.assertTrue(nuar_rows[0][12])  # er_hovedafgrode
        self.assertTrue(nuar_rows[0][13])  # grund6procent
        # JB 1 + 3 -> jb_nr 1 and 3, both konventionel-only rows for code 1.
        self.assertEqual({row[1] for row in norm_rows}, {1, 3})
        self.assertEqual(norm_rows[0][2], 1)  # afgroedekode
        self.assertEqual(norm_rows[0][6], "hkg")  # udbytteenhed
        self.assertEqual(norm_rows[0][9], 100.0)  # n_norm
        self.assertTrue(norm_rows[0][12])  # indregn_ffv
        self.assertEqual({row[1] for row in nfix_rows}, {1, 3})  # normgrp1 -> jb_nr 1, 3
        self.assertEqual(nfix_rows[0][4], 7.0)
        self.assertEqual(runoff_rows, [(1, 3, 1)])
        self.assertEqual(permanent_rows, [])  # er_permanent_afgroede is blank for code 1

    def test_permanent_afgrode_filters_on_ja(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            master = Path(directory) / "master.csv"
            write_csv(
                master, MASTER_CSV_HEADERS,
                [master_csv_row(er_permanent_afgroede="Ja")],
            )
            self.assertEqual(parse_permanente_afgrodekoder(master), [(1, "Vårbyg")])

    def test_each_csv_loader_parses_its_own_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            sales = base / "sales.csv"
            write_csv(
                sales,
                ["afgroedekode", "driftsform", "kvalitet", "salgspris", "enhed", "halm_pris_kr_kg"],
                [["1", "Konventionel", "", "1.5", "kg", ""]],
            )
            straw = base / "straw.csv"
            write_csv(
                straw,
                ["afgroedekode", "jordbonitet", "halm_udbytte_kg_ha"],
                [["1", "JB1-3", "2"]],
            )
            rates = base / "rates.csv"
            write_csv(
                rates,
                ["behandling", "jordbonitet", "afgroedekode", "driftsform", "pris_kr_per_enhed"],
                [["Såning", "JB1-3", "", "", "3"]],
            )
            quantities = base / "quantities.csv"
            write_csv(
                quantities,
                [
                    "afgroedekode", "driftsform", "jordbonitet", "kvalitet", "kategori",
                    "behandling", "antal",
                ],
                [["1", "Konventionel", "JB1-3", "", "Udsæd", "Såning", "2"]],
            )
            costs = base / "costs.csv"
            write_csv(
                costs,
                ["afgroedekode", "driftsform", "kategori", "behandling", "udgift_kr_ha"],
                [["1", "Konventionel", "Udsæd", "Korn", "12"]],
            )
            prices = base / "prices.csv"
            write_csv(
                prices,
                ["post", "kategori", "type", "pris", "enhed"],
                [["N", "Gødning", "Omkostning", "4", "kr/kg"]],
                delimiter=";",
            )

            self.assertEqual(parse_salgspriser(sales)[0][-2:], ("kg", 0.0))
            self.assertEqual(parse_halmudbytte(straw)[0][-1], 2.0)
            self.assertIsNone(parse_arbejdssatser(rates)[0][3])
            self.assertEqual(parse_arbejdsmaengder(quantities)[0][-1], 2.0)
            self.assertEqual(parse_dyrkningsomkostninger(costs)[0][-1], 12.0)
            self.assertEqual(parse_prisliste(prices)[0][-1], "kr/kg")

    def test_empty_replacement_never_opens_a_database_connection(self) -> None:
        with patch.object(runtime_lookup_loader.psycopg, "connect") as connect:
            with self.assertRaisesRegex(ValueError, "no rows"):
                runtime_lookup_loader.replace_tables([("salgspris", ("source_order",), [])])
        connect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
