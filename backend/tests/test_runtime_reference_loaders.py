import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from database.scripts import runtime_lookup_loader
from database.scripts.load_afgroede_normer import parse_afgroede_normer
from database.scripts.load_afstromningskategorier import parse_afstromningskategorier
from database.scripts.load_oekonomital_afgroedebundet import parse_oekonomital_afgroedebundet
from database.scripts.load_oekonomital_generelle_satser import (
    parse_oekonomital_generelle_satser,
)
from database.scripts.load_permanente_afgrodekoder import parse_permanente_afgrodekoder


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

    def test_oekonomital_loaders_split_on_kilde_tabel(self) -> None:
        afgroedebundet_headers = [
            "kilde_tabel", "afgroedekode", "driftsform", "jordbonitet", "kvalitet",
            "kategori", "behandling", "antal", "enhed", "beloeb", "beloeb_type",
        ]

        def afgroedebundet_row(**overrides: str) -> list[str]:
            row = {header: "" for header in afgroedebundet_headers}
            row.update(overrides)
            return [row[header] for header in afgroedebundet_headers]

        generelle_satser_headers = [
            "kilde_tabel", "aar", "type", "afgroedekode", "driftsform", "jordbonitet",
            "kategori", "post", "pris", "enhed",
        ]

        def generelle_satser_row(**overrides: str) -> list[str]:
            row = {header: "" for header in generelle_satser_headers}
            row.update(overrides)
            return [row[header] for header in generelle_satser_headers]

        with tempfile.TemporaryDirectory() as directory:
            afgroedebundet = Path(directory) / "afgroedebundet.csv"
            write_csv(
                afgroedebundet,
                afgroedebundet_headers,
                [
                    afgroedebundet_row(
                        kilde_tabel="arbejdsmaengde", afgroedekode="1", driftsform="Konventionel",
                        jordbonitet="JB1-3", kategori="Udsæd", behandling="Såning", antal="2",
                    ),
                    afgroedebundet_row(
                        kilde_tabel="dyrkningsomkostning", afgroedekode="1",
                        driftsform="Konventionel", kategori="Udsæd", behandling="Korn",
                        beloeb="12", beloeb_type="udgift_kr_ha",
                    ),
                    afgroedebundet_row(
                        kilde_tabel="halmudbytte", afgroedekode="1", jordbonitet="JB1-3",
                        kategori="Udbytte", behandling="Halmudbytte", antal="2", enhed="kg/ha",
                    ),
                    afgroedebundet_row(
                        kilde_tabel="salgspris", afgroedekode="1", driftsform="Konventionel",
                        kategori="Salg", behandling="Salg af afgrøde", enhed="kg", beloeb="1.5",
                        beloeb_type="salgspris",
                    ),
                ],
            )
            generelle_satser = Path(directory) / "generelle_satser.csv"
            write_csv(
                generelle_satser,
                generelle_satser_headers,
                [
                    generelle_satser_row(
                        kilde_tabel="arbejdssats", aar="2026", type="Omkostning",
                        jordbonitet="JB1-3", post="Såning", pris="3",
                    ),
                    generelle_satser_row(
                        kilde_tabel="prisliste_2026", aar="2026", type="Omkostning",
                        kategori="Gødning", post="N", pris="4", enhed="kr/kg",
                    ),
                ],
            )

            arbejdsmaengde, dyrkningsomkostning, halmudbytte, salgspris = (
                parse_oekonomital_afgroedebundet(afgroedebundet)
            )
            arbejdssats, prisliste = parse_oekonomital_generelle_satser(generelle_satser)

        self.assertEqual(arbejdsmaengde[0][-1], 2.0)
        self.assertEqual(dyrkningsomkostning[0][-1], 12.0)
        self.assertEqual(halmudbytte[0][-1], 2.0)
        self.assertEqual(salgspris[0][-2:], ("kg", 0.0))  # halm price absent -> 0.0
        self.assertIsNone(arbejdssats[0][3])  # afgroedekode blank -> universal rate
        self.assertEqual(prisliste[0][-1], "kr/kg")

    def test_empty_replacement_never_opens_a_database_connection(self) -> None:
        with patch.object(runtime_lookup_loader.psycopg, "connect") as connect:
            with self.assertRaisesRegex(ValueError, "no rows"):
                runtime_lookup_loader.replace_tables([("salgspris", ("source_order",), [])])
        connect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
