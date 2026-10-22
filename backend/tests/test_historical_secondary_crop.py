"""Checks for what a reported catch crop stands for in the history and
simulation calculations."""

import os
import unittest
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://dst2:dst2@localhost:5432/dst2",
)

from app.domain.rotation_candidate import RotationCandidateRef
from app.services.rotations import afgroede_normer, historisk_goedning
from app.services.rotations.historical_secondary_crop import (
    historical_secondary_crop,
    secondary_crop_name,
)
from app.services.scenario import candidate_evaluator, field_history_evaluator

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
    def evaluate(
        self, crop_history: dict, secondary_crop_history: dict, **kwargs
    ) -> tuple[list, dict]:
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
                **kwargs,
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
                (INTERMEDIATE_CROP, "Mellemafgrøde/tidlig såning"),
                (None, None),
                (CATCH_CROP, "Efterafgrøder, pligtige, husdyr, målrettede"),
            ],
        )

    def test_marks_a_catch_crop_before_an_autumn_sown_crop_as_either_measure(self) -> None:
        years, _ = self.evaluate(
            {"2024": VAARBYG, "2025": VINTERHVEDE, "2026": VAARBYG},
            {"2024": CATCH_CROP, "2026": CATCH_CROP},
        )

        self.assertEqual(
            [y.leaching_detail.get("mellemafgroede_eller_tidlig_saaning") for y in years[-3:]],
            [True, None, None],
        )

    def test_a_simulation_baseline_keeps_the_calculated_measure(self) -> None:
        years, _ = self.evaluate(
            {"2024": VAARBYG, "2025": VINTERHVEDE},
            {"2024": CATCH_CROP},
            show_either_measure=False,
        )

        self.assertNotIn("mellemafgroede_eller_tidlig_saaning", years[-3].leaching_detail)
        self.assertEqual(
            (years[-3].year.udlaeg_kode, years[-3].year.udlaeg_navn),
            (INTERMEDIATE_CROP, "Mellemafgrøde"),
        )

    def test_counts_a_catch_crops_preceding_crop_value_the_next_year(self) -> None:
        years, _ = self.evaluate({"2025": VAARBYG, "2026": VAARBYG}, {"2025": CATCH_CROP})

        self.assertEqual(years[-1].forfrugtsvaerdi_kgn_ha, 21.0)


class RealHistoryLookbackTests(unittest.TestCase):
    @patch.object(
        historisk_goedning, "lookup_historisk_n_input", lambda *args: {"mncs": 0.0, "g0": 0.0}
    )
    def test_carries_the_reported_catch_crops(self) -> None:
        history = historisk_goedning.real_history_lookback(
            {"2025": VAARBYG, "2026": VAARBYG}, 4, "Fyn", False, {"2026": CATCH_CROP}
        )

        self.assertEqual(
            [history[year]["secondary_crop"] for year in ("2025", "2026")], [None, CATCH_CROP]
        )


def fake_n_inputs(*args, **kwargs) -> dict:
    return {
        "mncs": 100.0,
        "mnca": 0.0,
        "g0": 0.0,
        "net_n": 100.0,
        "org_mineral_n_applied": 0.0,
        "fv_forfrugt": 0.0,
        "n_norm": 100.0,
    }


@patch.object(afgroede_normer, "lookup_crop_params", fake_crop_params)
@patch.object(afgroede_normer, "lookup_nfix", lambda *args, **kwargs: 0.0)
@patch.object(candidate_evaluator, "compute_n_inputs", fake_n_inputs)
@patch.object(
    candidate_evaluator,
    "calculate_db",
    lambda *args, **kwargs: {"db": 0.0, "udbytte": 0.0, "udbytteenhed": ""},
)
class SimulationSecondaryCropTests(unittest.TestCase):
    def first_position_prev_secondary_crop(self, first_crop: int, history_2026: dict):
        calls: dict[int, dict] = {}

        def record(**kwargs):
            calls[kwargs["y"]] = kwargs
            return {"L_nuar": 0.0}

        with patch.object(candidate_evaluator.bridge_v2, "evaluate_leaching_position", record):
            candidate_evaluator.evaluate_sequence_for_mark(
                RotationCandidateRef(saedskiftevariant="test", variant="1", n_norm_pct="100"),
                afgrode_seq=[first_crop] + [VAARBYG] * 7,
                udlaeg_seq=[None] * 8,
                udlaeg_navn_seq=[None] * 8,
                active_len=8,
                jbnr=4,
                driftsform="Konventionel",
                org_mineral_n=0.0,
                mineralsk_andel_pct=70.0,
                only_organic=False,
                real_history={
                    "2025": {"code": VAARBYG, "mncs": 0.0, "mnca": 0.0, "g0": 0.0},
                    "2026": {"code": VAARBYG, "mncs": 0.0, "mnca": 0.0, "g0": 0.0, **history_2026},
                },
            )
        return calls[candidate_evaluator.START_CALENDAR_YEAR]["prev_udlaeg_kode"]

    def test_reads_2026s_catch_crop_against_the_candidates_first_crop(self) -> None:
        reported = {"secondary_crop": CATCH_CROP}

        self.assertEqual(self.first_position_prev_secondary_crop(VAARBYG, reported), CATCH_CROP)
        self.assertEqual(
            self.first_position_prev_secondary_crop(VINTERHVEDE, reported), INTERMEDIATE_CROP
        )

    def test_has_none_for_history_stored_without_catch_crops(self) -> None:
        self.assertIsNone(self.first_position_prev_secondary_crop(VAARBYG, {}))


if __name__ == "__main__":
    unittest.main()
