import os
import unittest
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://dst2:dst2@localhost:5432/dst2",
)

from app.services.economics import db_calculator

VINTERHVEDE = 11
VAARHVEDE = 2
NORM = {"udbyttenorm": 57.0, "n_norm": 175.0, "udbytteenhed": "hkg"}
PRISLISTE = {
    "Handelsgødning, kvælstof (N)": {"pris": 10.0},
    "Handelsgødning, udbringning": {"pris": 100.0},
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
            "_tilskud_kr_ha": lambda *args, **kwargs: 0.0,
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

    def test_crop_without_curve_keeps_the_udbyttenorm(self) -> None:
        result = db_calculator.calculate_db(VAARHVEDE, "Konventionel", 1, mncs=100.0)
        self.assertEqual(result["udbytte"], 57.0)

    def test_oekologisk_keeps_the_norm_based_yield(self) -> None:
        result = db_calculator.calculate_db(VINTERHVEDE, "Økologisk", 1, mncs=100.0)
        self.assertEqual(result["udbytte_faktor"], 1.0)


if __name__ == "__main__":
    unittest.main()
