import os
import unittest
from unittest.mock import patch

from pydantic import ValidationError

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://dst2:dst2@localhost:5432/dst2",
)

from app.domain.rotation_candidate import RotationCandidateRef
from app.domain.simulation import GodningSettings
from app.services.rotations import autumn_n
from app.services.scenario import candidate_evaluator
from plantperform_fargate import preparation

VAARBYG = 1
VINTERHVEDE = 11
VINTERRAPS = 22
RAJGRAES = 101
KLOEVERGRAES = 260
GRAES = 263
PERMANENT_GRAES = 250
BAR_JORD = 921
UDLAEG_TIL_FROE = 2000
GRAESUDLAEG = 965

NORMS = {
    VAARBYG: {"n_norm": 136.0, "forfrugtsvaerdi": 0.0, "indregn_ffv": True},
    VINTERHVEDE: {"n_norm": 175.0, "forfrugtsvaerdi": 0.0, "indregn_ffv": True},
    VINTERRAPS: {"n_norm": 159.0, "forfrugtsvaerdi": 0.0, "indregn_ffv": True},
    RAJGRAES: {"n_norm": 180.0, "forfrugtsvaerdi": 0.0, "indregn_ffv": True},
    KLOEVERGRAES: {"n_norm": 286.0, "forfrugtsvaerdi": 0.0, "indregn_ffv": True},
    GRAES: {"n_norm": 336.0, "forfrugtsvaerdi": 0.0, "indregn_ffv": True},
}


def fake_lookup_norm(crop_code, jb_nr, irrigated=False, only_organic=False):
    return NORMS.get(crop_code)


class StandsInAutumnTests(unittest.TestCase):
    def test_autumn_sown_crops_stand_after_any_crop(self) -> None:
        self.assertTrue(autumn_n.stands_in_autumn(VINTERRAPS, VINTERHVEDE, None))
        self.assertTrue(autumn_n.stands_in_autumn(VINTERHVEDE, VINTERRAPS, BAR_JORD))

    def test_seed_grass_stands_from_its_undersown_crop(self) -> None:
        self.assertTrue(autumn_n.stands_in_autumn(RAJGRAES, VAARBYG, UDLAEG_TIL_FROE))

    def test_seed_grass_without_its_undersown_crop_does_not_stand(self) -> None:
        self.assertFalse(autumn_n.stands_in_autumn(RAJGRAES, VAARBYG, None))

    def test_grass_stands_when_it_continues(self) -> None:
        self.assertTrue(autumn_n.stands_in_autumn(KLOEVERGRAES, KLOEVERGRAES, None))
        self.assertTrue(autumn_n.stands_in_autumn(RAJGRAES, RAJGRAES, None))

    def test_kloevergraes_and_graes_continue_as_each_other(self) -> None:
        self.assertTrue(autumn_n.stands_in_autumn(GRAES, KLOEVERGRAES, None))
        self.assertTrue(autumn_n.stands_in_autumn(KLOEVERGRAES, GRAES, None))

    def test_ploughing_between_kloevergraes_and_graes_ends_the_grass(self) -> None:
        self.assertFalse(autumn_n.stands_in_autumn(GRAES, KLOEVERGRAES, BAR_JORD))

    def test_other_grass_does_not_continue_as_graes(self) -> None:
        self.assertFalse(autumn_n.stands_in_autumn(GRAES, PERMANENT_GRAES, None))

    def test_grass_undersown_in_a_cover_crop_does_not_count(self) -> None:
        self.assertFalse(autumn_n.stands_in_autumn(KLOEVERGRAES, VAARBYG, GRAESUDLAEG))

    def test_ploughed_grass_does_not_continue(self) -> None:
        self.assertFalse(autumn_n.stands_in_autumn(KLOEVERGRAES, KLOEVERGRAES, BAR_JORD))

    def test_spring_crop_after_grass_does_not_stand(self) -> None:
        self.assertFalse(autumn_n.stands_in_autumn(VAARBYG, KLOEVERGRAES, None))


class GodningSettingsTests(unittest.TestCase):
    def test_the_plan_marks_husdyrgoedning(self) -> None:
        godning = GodningSettings(
            autumn_allocations=[
                {"afgrode_kode": VINTERRAPS, "kg_n_ha": 40.0, "fertiliser": "manure"},
                {"afgrode_kode": VINTERHVEDE, "kg_n_ha": 15.0},
            ]
        )
        self.assertEqual(
            godning.autumn_plan(), ((VINTERRAPS, 40.0, True), (VINTERHVEDE, 15.0, False))
        )

    def test_no_allocations_means_no_plan(self) -> None:
        self.assertEqual(GodningSettings().autumn_plan(), ())

    def test_a_crop_can_only_be_allocated_once(self) -> None:
        allocation = {"afgrode_kode": VINTERRAPS, "kg_n_ha": 40.0}
        with self.assertRaises(ValidationError):
            GodningSettings(autumn_allocations=[allocation, allocation])

    def test_evaluation_args_give_the_worker_the_plan(self) -> None:
        godning = GodningSettings(
            autumn_allocations=[{"afgrode_kode": VINTERRAPS, "kg_n_ha": 40.0}]
        )
        simulation = unittest.mock.MagicMock(godning=godning)
        with patch.object(
            preparation.repository, "_soil_data_for_context", return_value=None
        ):
            args = preparation.evaluation_args(simulation, None, None, 4)
        self.assertEqual(args["autumn_plan"], ((VINTERRAPS, 40.0, False),))
        self.assertNotIn("autumn_allocations", args)


class ComputeNInputsTests(unittest.TestCase):
    def setUp(self) -> None:
        candidate_evaluator.compute_n_inputs.cache_clear()
        self.addCleanup(candidate_evaluator.compute_n_inputs.cache_clear)
        patcher = patch.object(
            candidate_evaluator.afgroede_normer, "lookup_norm", fake_lookup_norm,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def inputs(self, autumn_kg_n, autumn_manure=False, org=0.0, only_organic=False, drift=None):
        return candidate_evaluator.compute_n_inputs(
            VINTERRAPS, VINTERHVEDE, None, 1, 100.0, org, 70.0, only_organic, False,
            drift or "Konventionel", autumn_kg_n, autumn_manure,
        )

    def test_handelsgoedning_moves_from_spring(self) -> None:
        result = self.inputs(40.0)
        self.assertEqual(result["mncs"], 119.0)
        self.assertEqual(result["autumn_n"], 40.0)
        self.assertEqual(result["autumn_mineral_n"], 40.0)
        self.assertEqual(result["autumn_g0"], 0.0)

    def test_at_most_the_crops_n_moves(self) -> None:
        result = self.inputs(400.0)
        self.assertEqual(result["autumn_n"], 159.0)
        self.assertEqual(result["mncs"], 0.0)

    def test_husdyrgoedning_takes_its_organic_part_along(self) -> None:
        # 100 kg utilised at 70 % mineral share holds 42.86 kg organically bound N.
        result = self.inputs(40.0, autumn_manure=True, org=100.0)
        self.assertEqual(result["autumn_n"], 40.0)
        self.assertEqual(result["autumn_mineral_n"], 0.0)
        self.assertAlmostEqual(result["autumn_g0"], 40.0 * 30.0 / 70.0)
        self.assertAlmostEqual(result["g0"], 60.0 * 30.0 / 70.0)
        self.assertEqual(result["mncs"], 119.0)
        self.assertEqual(result["org_mineral_n_applied"], 100.0)

    def test_autumn_husdyrgoedning_stops_at_the_crops_husdyrgoedning(self) -> None:
        result = self.inputs(40.0, autumn_manure=True, org=30.0)
        self.assertEqual(result["autumn_n"], 30.0)
        self.assertEqual(result["g0"], 0.0)

    def test_autumn_handelsgoedning_keeps_the_husdyrgoedning_in_spring(self) -> None:
        result = self.inputs(40.0, org=100.0)
        self.assertEqual(result["autumn_mineral_n"], 40.0)
        self.assertEqual(result["org_mineral_n_applied"], 100.0)
        self.assertAlmostEqual(result["g0"], 100.0 * 30.0 / 70.0)

    def test_autumn_handelsgoedning_leaves_less_room_for_husdyrgoedning(self) -> None:
        # 159 kg in all, so only 119 kg of the 150 kg husdyrgødning fits in spring.
        result = self.inputs(40.0, org=150.0)
        self.assertEqual(result["org_mineral_n_applied"], 119.0)
        self.assertEqual(result["mncs"], 119.0)

    def test_without_husdyrgoedning_the_moved_n_is_handelsgoedning(self) -> None:
        result = self.inputs(40.0, autumn_manure=True)
        self.assertEqual(result["autumn_mineral_n"], 40.0)

    def test_oekologisk_moves_husdyrgoedning_whatever_is_chosen(self) -> None:
        result = self.inputs(40.0, autumn_manure=False, drift="Økologisk", only_organic=True)
        self.assertEqual(result["autumn_n"], 40.0)
        self.assertEqual(result["autumn_mineral_n"], 0.0)
        self.assertAlmostEqual(result["autumn_g0"], 40.0 * 30.0 / 70.0)

    def test_only_organic_without_husdyrgoedning_moves_nothing(self) -> None:
        result = self.inputs(40.0, only_organic=True)
        self.assertEqual(result["autumn_n"], 0.0)
        self.assertEqual(result["mncs"], 0.0)

    def test_a_crop_without_a_norm_moves_nothing(self) -> None:
        result = candidate_evaluator.compute_n_inputs(
            999, None, None, 1, 100.0, 0.0, 70.0, False, False, "Konventionel", 40.0, False,
        )
        self.assertEqual(result["autumn_n"], 0.0)
        self.assertEqual(result["autumn_mineral_n"], 0.0)

    def test_nothing_moves_by_default(self) -> None:
        result = candidate_evaluator.compute_n_inputs(
            VINTERRAPS, VINTERHVEDE, None, 1, 100.0, 0.0, 70.0, False,
        )
        self.assertEqual(result["mncs"], 159.0)
        self.assertEqual(result["autumn_n"], 0.0)


class EvaluateSequenceTests(unittest.TestCase):
    def setUp(self) -> None:
        candidate_evaluator.compute_n_inputs.cache_clear()
        self.addCleanup(candidate_evaluator.compute_n_inputs.cache_clear)
        self.leaching_inputs: dict[int, dict] = {}
        self.db_inputs: dict[int, list[dict]] = {}
        patchers = [
            patch.object(candidate_evaluator.afgroede_normer, "lookup_norm", fake_lookup_norm),
            patch.object(candidate_evaluator.afgroede_normer, "lookup_nfix", return_value=0.0),
            patch.object(
                candidate_evaluator.afgroede_normer,
                "lookup_crop_params",
                return_value={"navn": "Afgrøde"},
            ),
            patch.object(
                candidate_evaluator.afgroede_normer,
                "catch_crop_preceding_crop_value",
                return_value=0.0,
            ),
            patch.object(
                candidate_evaluator.bridge_v2,
                "evaluate_leaching_position",
                side_effect=self.leaching,
            ),
            patch.object(candidate_evaluator, "calculate_db", side_effect=self.db),
        ]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    def leaching(self, **values) -> dict:
        self.leaching_inputs[values["y"]] = values
        return {"L_nuar": 10.0}

    def db(self, code, *args, **values) -> dict:
        self.db_inputs.setdefault(code, []).append(values)
        return {"db": 0.0, "udbytte": 0.0, "udbytteenhed": ""}

    def evaluate(self, crops, secondary=None, plan=(), org=0.0, real_history=None):
        count = len(crops)
        secondary = secondary or [None] * count
        return candidate_evaluator.evaluate_sequence_for_mark(
            RotationCandidateRef(saedskiftevariant="test", variant="1", n_norm_pct="100"),
            [crops[index % count] for index in range(8)],
            [secondary[index % count] for index in range(8)],
            [None] * 8,
            count,
            1,
            "Konventionel",
            org,
            70.0,
            False,
            real_history=real_history,
            autumn_plan=plan,
        )

    def position(self, index: int) -> dict:
        return self.leaching_inputs[candidate_evaluator.START_CALENDAR_YEAR + index]

    def test_autumn_n_counts_in_the_year_before_the_harvest(self) -> None:
        self.evaluate([VINTERHVEDE, VINTERRAPS], plan=((VINTERRAPS, 40.0, False),))

        self.assertEqual(self.position(0)["mnca"], 40.0)
        self.assertEqual(self.position(0)["mncs"], 175.0)
        self.assertEqual(self.position(1)["mnca"], 0.0)
        self.assertEqual(self.position(1)["mncs"], 119.0)

    def test_the_last_position_takes_the_autumn_of_the_first_crop(self) -> None:
        self.evaluate([VINTERRAPS, VINTERHVEDE], plan=((VINTERRAPS, 40.0, False),))

        self.assertEqual(self.position(1)["mnca"], 40.0)
        self.assertEqual(self.position(0)["mncs"], 119.0)

    def test_the_n_of_a_cycle_stays_the_same(self) -> None:
        crops = [VINTERHVEDE, VINTERRAPS, VINTERHVEDE, VAARBYG]

        def total() -> float:
            return sum(self.position(i)["mncs"] + self.position(i)["mnca"] for i in range(4))

        self.evaluate(crops)
        without = total()
        self.evaluate(crops, plan=((VINTERRAPS, 40.0, False),))
        self.assertEqual(total(), without)

    def test_the_organic_part_moves_to_the_year_of_the_autumn(self) -> None:
        self.evaluate(
            [VINTERHVEDE, VINTERRAPS], plan=((VINTERRAPS, 40.0, True),), org=100.0,
        )
        organic_per_kg = 30.0 / 70.0

        self.assertAlmostEqual(self.position(0)["g0"], (100.0 + 40.0) * organic_per_kg)
        self.assertAlmostEqual(self.position(1)["g0"], 60.0 * organic_per_kg)

    def test_the_next_years_lookback_counts_the_autumn_n_in_its_own_year(self) -> None:
        self.evaluate([VINTERHVEDE, VINTERRAPS, VAARBYG], plan=((VINTERRAPS, 40.0, False),))

        self.assertEqual(self.position(1)["m1"], 175.0 + 40.0)
        self.assertEqual(self.position(2)["m1"], 119.0)

    def test_only_the_grass_that_continues_takes_autumn_n(self) -> None:
        self.evaluate(
            [VAARBYG, KLOEVERGRAES, KLOEVERGRAES, VAARBYG],
            [GRAESUDLAEG, None, None, None],
            plan=((KLOEVERGRAES, 60.0, False),),
        )

        self.assertEqual([self.position(i)["mnca"] for i in range(4)], [0.0, 60.0, 0.0, 0.0])
        self.assertEqual(self.position(1)["mncs"], 286.0)
        self.assertEqual(self.position(2)["mncs"], 226.0)
        self.assertEqual(self.position(3)["mncs"], 136.0)

    def test_every_year_of_a_grass_rotation_takes_autumn_n(self) -> None:
        self.evaluate(
            [KLOEVERGRAES, KLOEVERGRAES, GRAES],
            plan=((KLOEVERGRAES, 60.0, False), (GRAES, 40.0, False)),
        )

        self.assertEqual([self.position(i)["mnca"] for i in range(3)], [60.0, 40.0, 60.0])
        self.assertEqual([self.position(i)["mncs"] for i in range(3)], [226.0, 226.0, 296.0])

    def test_seed_grass_takes_autumn_n_from_its_undersown_crop(self) -> None:
        self.evaluate(
            [VAARBYG, RAJGRAES, RAJGRAES],
            [UDLAEG_TIL_FROE, None, None],
            plan=((RAJGRAES, 30.0, False),),
        )

        self.assertEqual([self.position(i)["mnca"] for i in range(3)], [30.0, 30.0, 0.0])

    def test_the_first_crop_follows_the_cycle_not_the_real_year_before(self) -> None:
        history = {
            "2025": {"code": VAARBYG, "mncs": 100.0, "mnca": 0.0, "g0": 0.0},
            "2026": {"code": VAARBYG, "mncs": 100.0, "mnca": 0.0, "g0": 0.0},
        }
        self.evaluate(
            [RAJGRAES, RAJGRAES, VAARBYG],
            [None, None, UDLAEG_TIL_FROE],
            plan=((RAJGRAES, 30.0, False),),
            real_history=history,
        )

        self.assertEqual(self.position(2)["mnca"], 30.0)
        self.assertEqual(self.position(0)["mncs"], 150.0)

    def test_crop_figures_and_costs_follow_the_harvest_year(self) -> None:
        result = self.evaluate([VINTERHVEDE, VINTERRAPS], plan=((VINTERRAPS, 40.0, False),))

        year = result.years[1]
        self.assertEqual(year.tildelt_handelsgodning_kgn_ha, 159.0)
        self.assertEqual(year.autumn_allocated_kg_n_ha, 40.0)
        self.assertEqual(result.years[0].tildelt_handelsgodning_kgn_ha, 175.0)
        self.assertEqual(result.years[0].autumn_allocated_kg_n_ha, 0.0)
        self.assertEqual(self.db_inputs[VINTERRAPS][0]["mncs"], 119.0)
        self.assertEqual(self.db_inputs[VINTERRAPS][0]["mnca"], 40.0)
        self.assertEqual(self.db_inputs[VINTERHVEDE][0]["mnca"], 0.0)

    def test_autumn_husdyrgoedning_is_no_handelsgoedning_in_the_costs(self) -> None:
        result = self.evaluate(
            [VINTERHVEDE, VINTERRAPS], plan=((VINTERRAPS, 40.0, True),), org=100.0,
        )

        self.assertEqual(self.db_inputs[VINTERRAPS][0]["mncs"], 159.0)
        self.assertEqual(self.db_inputs[VINTERRAPS][0]["mnca"], 0.0)
        self.assertEqual(self.db_inputs[VINTERRAPS][0]["org_mineral_n_applied"], 100.0)
        self.assertAlmostEqual(
            result.years[1].husdyrgodning_organisk_bundet_kgn_ha, 100.0 * 30.0 / 70.0
        )

    def test_a_crop_outside_the_plan_changes_nothing(self) -> None:
        self.evaluate([VINTERHVEDE, VAARBYG], plan=((VINTERRAPS, 40.0, False),))

        self.assertEqual(self.position(0)["mnca"], 0.0)
        self.assertEqual(self.position(1)["mncs"], 136.0)


if __name__ == "__main__":
    unittest.main()
