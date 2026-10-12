"""Checks for what a reported catch crop stands for in the history calculation."""

import os
import unittest
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://dst2:dst2@localhost:5432/dst2",
)

from app.services.rotations import afgroede_normer
from app.services.rotations.historical_secondary_crop import (
    historical_secondary_crop,
    secondary_crop_name,
)
from app.services.scenario import field_history_evaluator

VAARBYG = 1
VINTERHVEDE = 11
VINTERRAPS = 22
MAJSHELSAED = 216
KLOEVERGRAES = 264
PIL = 592
CATCH_CROP = 968
INTERMEDIATE_CROP = 9682
EARLY_SOWING = 9683

# The crop table's Grund6Procent, "Normal såmåned", "ME" flags and table 8 W
# for these codes.
CROP_PARAMS = {
    VAARBYG: {
        "navn": "Vårbyg",
        "grund6procent": True,
        "saamaaned": 4,
        "mellemafgroede_mulig": True,
        "tidlig_saaning_mulig": True,
    },
    VINTERHVEDE: {
        "navn": "Vinterhvede",
        "grund6procent": True,
        "saamaaned": 9,
        "mellemafgroede_mulig": True,
        "tidlig_saaning_mulig": True,
    },
    VINTERRAPS: {
        "navn": "Vinterraps",
        "grund6procent": True,
        "saamaaned": 8,
        "mellemafgroede_mulig": True,
        "tidlig_saaning_mulig": True,
    },
    MAJSHELSAED: {
        "navn": "Majshelsæd",
        "grund6procent": True,
        "saamaaned": 5,
        "mellemafgroede_mulig": False,
        "tidlig_saaning_mulig": True,
    },
    KLOEVERGRAES: {
        "navn": "Græs og kløvergræs uden norm, under 50 % kløver (omdrift)",
        "grund6procent": False,
        "saamaaned": 0,
        "W_omploejning": 8,
    },
    PIL: {"navn": "Pil", "grund6procent": False, "saamaaned": 4},
    CATCH_CROP: {"navn": "Efterafgrøder, pligtige, husdyr, målrettede"},
}


def fake_crop_params(crop_code):
    return CROP_PARAMS.get(crop_code, {})


@patch.object(afgroede_normer, "lookup_crop_params", fake_crop_params)
class HistoricalSecondaryCropTests(unittest.TestCase):
    def test_is_none_without_a_reported_catch_crop(self) -> None:
        self.assertIsNone(historical_secondary_crop(None, VAARBYG, VAARBYG))

    def test_is_none_after_a_crop_a_catch_crop_cannot_follow(self) -> None:
        self.assertIsNone(historical_secondary_crop(CATCH_CROP, PIL, PIL))

    def test_keeps_the_catch_crop_before_a_spring_sown_or_unknown_crop(self) -> None:
        self.assertEqual(historical_secondary_crop(CATCH_CROP, VAARBYG, VAARBYG), CATCH_CROP)
        self.assertEqual(historical_secondary_crop(CATCH_CROP, VAARBYG, None), CATCH_CROP)

    def test_is_an_intermediate_crop_before_a_winter_cereal(self) -> None:
        self.assertEqual(
            historical_secondary_crop(CATCH_CROP, VAARBYG, VINTERHVEDE), INTERMEDIATE_CROP
        )

    def test_is_early_sowing_where_only_that_is_allowed(self) -> None:
        self.assertEqual(
            historical_secondary_crop(CATCH_CROP, MAJSHELSAED, VINTERHVEDE), EARLY_SOWING
        )

    def test_is_none_before_an_autumn_crop_that_allows_neither(self) -> None:
        self.assertIsNone(historical_secondary_crop(CATCH_CROP, VAARBYG, VINTERRAPS))

    def test_is_none_before_grass_whose_establishment_is_the_winter_cover(self) -> None:
        self.assertIsNone(historical_secondary_crop(CATCH_CROP, VINTERHVEDE, KLOEVERGRAES))

    def test_names_the_secondary_crop(self) -> None:
        self.assertEqual(secondary_crop_name(INTERMEDIATE_CROP), "Mellemafgrøde")
        self.assertEqual(secondary_crop_name(EARLY_SOWING), "Tidlig såning")
        self.assertEqual(
            secondary_crop_name(CATCH_CROP), "Efterafgrøder, pligtige, husdyr, målrettede"
        )
        self.assertIsNone(secondary_crop_name(None))


@patch.object(afgroede_normer, "lookup_crop_params", fake_crop_params)
@patch.object(afgroede_normer, "lookup_nfix", lambda *args, **kwargs: 0.0)
@patch.object(
    afgroede_normer,
    "lookup_norm",
    lambda *args, **kwargs: {"n_norm": 100.0, "forfrugtsvaerdi": 0.0, "indregn_ffv": True},
)
@patch.object(
    field_history_evaluator,
    "lookup_historisk_n_input",
    lambda *args: {"mncs": 100.0, "g0": 0.0},
)
@patch.object(
    field_history_evaluator,
    "calculate_db",
    lambda *args, **kwargs: {"db": 0.0, "udbytte": 0.0, "udbytteenhed": ""},
)
class HistoryEvaluatorSecondaryCropTests(unittest.TestCase):
    def evaluate(self, crop_history: dict, secondary_crop_history: dict) -> tuple[list, dict]:
        calls: dict[int, dict] = {}

        def record(**kwargs):
            calls[kwargs["y"]] = kwargs
            return {"L_nuar": 0.0}

        with patch.object(field_history_evaluator.bridge_v2, "evaluate_leaching_position", record):
            years = field_history_evaluator.evaluate_real_history_for_field(
                crop_history,
                4,
                "Fyn",
                False,
                secondary_crop_history=secondary_crop_history,
            )
        return years, calls

    def test_passes_each_year_and_the_year_before_its_secondary_crop(self) -> None:
        years, calls = self.evaluate(
            {"2024": VAARBYG, "2025": VINTERHVEDE, "2026": VAARBYG},
            {"2024": CATCH_CROP, "2026": CATCH_CROP},
        )

        self.assertEqual(
            [(calls[y]["udlaeg_kode"], calls[y]["prev_udlaeg_kode"]) for y in (2024, 2025, 2026)],
            [(INTERMEDIATE_CROP, None), (None, INTERMEDIATE_CROP), (CATCH_CROP, None)],
        )
        self.assertEqual(
            [(y.year.udlaeg_kode, y.year.udlaeg_navn) for y in years[-3:]],
            [
                (INTERMEDIATE_CROP, "Mellemafgrøde"),
                (None, None),
                (CATCH_CROP, "Efterafgrøder, pligtige, husdyr, målrettede"),
            ],
        )

    def test_counts_a_catch_crops_preceding_crop_value_the_next_year(self) -> None:
        years, _ = self.evaluate({"2025": VAARBYG, "2026": VAARBYG}, {"2025": CATCH_CROP})

        self.assertEqual(years[-1].forfrugtsvaerdi_kgn_ha, 21.0)


if __name__ == "__main__":
    unittest.main()
