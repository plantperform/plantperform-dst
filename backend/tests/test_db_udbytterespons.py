import os
import unittest
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://dst2:dst2@localhost:5432/dst2",
)

from app.services.economics import db_calculator

VINTERHVEDE = 11
VAARBYG = 1
VAARHVEDE = 2
NORM = {"udbyttenorm": 57.0, "n_norm": 175.0, "udbytteenhed": "hkg"}
PRISLISTE = {
    "Handelsgødning, kvælstof (N)": {"pris": 10.0},
    "Handelsgødning, udbringning": {"pris": 100.0},
    "Gylleudbringning, slæbeslanger": {"pris": 24.0, "enhed": "ton"},
}


class CalculateDbYieldResponseTests(unittest.TestCase):
    def setUp(self) -> None:
        db_calculator.calculate_db.cache_clear()
        self.addCleanup(db_calculator.calculate_db.cache_clear)
        for name, value in {
            "_lookup_udbyttenorm": lambda *args, **kwargs: (NORM, False),
            "_lookup_salgspris": lambda *args, **kwargs: {
                "salgspris": 150.0, "enhed": "kr/hkg", "halm_pris_kr_kg": 0.0,
            },
            "_lookup_halm_udbytte": lambda *args, **kwargs: 0.0,
            "_lookup_omkostningslinjer": lambda *args, **kwargs: [],
            "_load_prisliste": lambda: PRISLISTE,
            "_tilskud_poster": lambda *args, **kwargs: [],
        }.items():
            patcher = patch.object(db_calculator, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_full_norm_keeps_the_udbyttenorm(self) -> None:
        result = db_calculator.calculate_db(VINTERHVEDE, "Konventionel", 1, mncs=175.0)
        self.assertEqual(result["udbytte"], 57.0)
        self.assertEqual(result["udbytte_faktor"], 1.0)

    def test_available_n_below_the_norm_lowers_yield(self) -> None:
        # 80 % kvote after vinterraps: 122 kg applied + 18 kg forfrugt = 140 kg.
        result = db_calculator.calculate_db(
            VINTERHVEDE, "Konventionel", 1, mncs=122.0, forfrugtsvaerdi=18.0,
        )
        self.assertAlmostEqual(result["udbytte"], 53.85, places=2)
        self.assertEqual(result["tilgaengelig_n"], 140.0)

    def test_drying_follows_the_yield(self) -> None:
        lines = [
            {
                "kategori": "Tørring/lagring",
                "behandling": "Tørring, korn",
                "udgift_kr_ha": 1000.0,
                "maengde": 5000.0,
            },
            {"kategori": "Markarbejde", "behandling": "Høst", "udgift_kr_ha": 500.0},
        ]
        with patch.object(db_calculator, "_lookup_omkostningslinjer", lambda *a, **k: lines):
            result = db_calculator.calculate_db(
                VINTERHVEDE, "Konventionel", 1, mncs=122.0, forfrugtsvaerdi=18.0,
            )
        self.assertAlmostEqual(result["toerring"], round(1000.0 * result["udbytte_faktor"]))
        self.assertEqual(result["markarbejde"], 500.0)
        self.assertEqual(lines[0]["udgift_kr_ha"], 1000.0)

    def test_crop_without_curve_keeps_the_udbyttenorm(self) -> None:
        result = db_calculator.calculate_db(VAARHVEDE, "Konventionel", 1, mncs=100.0)
        self.assertEqual(result["udbytte"], 57.0)

    def test_efteraarssaaet_vaarsaed_is_priced_and_responds_as_the_vaarsaed(self) -> None:
        priced: list[int] = []

        def salgspris(code, *args, **kwargs):
            priced.append(code)
            return {"salgspris": 150.0, "enhed": "kr/hkg", "halm_pris_kr_kg": 0.0}

        with patch.object(db_calculator, "_lookup_salgspris", salgspris):
            result = db_calculator.calculate_db(70, "Konventionel", 1, mncs=122.0)
        self.assertEqual(priced, [VAARBYG])
        self.assertTrue(result["udbytterespons"])
        self.assertLess(result["udbytte_faktor"], 1.0)

    def test_oekologisk_without_its_own_norm_keeps_the_norm_based_yield(self) -> None:
        # The konventionel fallback norm: the organic curve does not apply to it.
        result = db_calculator.calculate_db(VINTERHVEDE, "Økologisk", 1, mncs=100.0)
        self.assertEqual(result["udbytte_faktor"], 1.0)

    def test_oekologisk_with_its_own_norm_follows_the_organic_curve(self) -> None:
        norm = {"udbyttenorm": 43.3, "n_norm": 144.0, "udbytteenhed": "hkg"}
        with patch.object(db_calculator, "_lookup_udbyttenorm", lambda *a, **k: (norm, True)):
            result = db_calculator.calculate_db(VINTERHVEDE, "Økologisk", 2, mncs=72.0)
        self.assertAlmostEqual(
            result["udbytte_faktor"], 1 - (0.147713 * 0.5 + 0.229401 * 0.25), places=6
        )
        self.assertAlmostEqual(result["udbytte"], 43.3 * result["udbytte_faktor"], places=4)


class CalculateDbManureSpreadingTests(CalculateDbYieldResponseTests):
    def manure_lines(self, result: dict) -> list[dict]:
        return [
            line for line in result["linjer"] if line["behandling"] == "Udbringning, husdyrgødning"
        ]

    def test_manure_is_spread_per_tonne(self) -> None:
        result = db_calculator.calculate_db(
            VINTERHVEDE, "Økologisk", 1, mncs=120.0, org_mineral_n_applied=120.0,
            only_organic=True, husdyrgodning_ton_pr_ha=20.0, itemized=True,
        )
        [line] = self.manure_lines(result)
        self.assertEqual(line["udgift_kr_ha"], 20.0 * 24.0)

    def test_no_manure_costs_nothing(self) -> None:
        result = db_calculator.calculate_db(
            VINTERHVEDE, "Konventionel", 1, mncs=120.0, itemized=True
        )
        self.assertEqual(self.manure_lines(result), [])


if __name__ == "__main__":
    unittest.main()
