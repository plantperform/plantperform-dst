import unittest
from unittest.mock import patch

from test_permanent_crop_candidate import HISTORY, NORM, ORGANIC, PERMANENT_GRASS

from app.data import repository, simulation_store
from app.domain.field import FieldRecord
from app.domain.rotation_candidate import RotationCandidateRef
from app.domain.simulation import Simulation, VandingSettings
from app.services.scenario import candidate_evaluator
from optimizer import preparation

VAARBYG = 1
VINTERHVEDE = 11


class VandingSettingsTests(unittest.TestCase):
    def test_only_a_chosen_field_on_jb_1_to_4_waters_the_chosen_crops(self) -> None:
        vanding = VandingSettings(imk_ids=[7], afgrode_koder=[VAARBYG])
        self.assertEqual(vanding.crops_for(7, 4), frozenset({VAARBYG}))
        self.assertEqual(vanding.crops_for(7, 5), frozenset())
        self.assertEqual(vanding.crops_for(8, 3), frozenset())
        self.assertEqual(vanding.crops_for(None, 3), frozenset())

    def test_a_removed_field_is_no_longer_a_vandingsmark(self) -> None:
        kept, removed = (
            FieldRecord(
                id=str(imk_id),
                farm_id="farm",
                name=f"{imk_id}-0",
                imk_id=imk_id,
                area_ha=1,
                db2=0,
                n_load=0,
                leaching=0,
            )
            for imk_id in (7, 8)
        )
        data = {"vanding": {"imk_ids": [7, 8], "afgrode_koder": [VAARBYG]}}
        fitted = simulation_store._fit_settings(data, [kept, removed], [kept])
        self.assertEqual(fitted["vanding"], {"imk_ids": [7], "afgrode_koder": [VAARBYG]})


class IrrigatedYearTests(unittest.TestCase):
    def setUp(self) -> None:
        candidate_evaluator.compute_n_inputs.cache_clear()
        self.addCleanup(candidate_evaluator.compute_n_inputs.cache_clear)
        patchers = [
            patch.object(candidate_evaluator.afgroede_normer, "lookup_norm", return_value=NORM),
            patch.object(candidate_evaluator.afgroede_normer, "lookup_nfix", return_value=0.0),
            patch.object(
                candidate_evaluator.afgroede_normer,
                "lookup_crop_params",
                return_value={"navn": "Afgrøde"},
            ),
            patch.object(
                candidate_evaluator.bridge_v2,
                "evaluate_leaching_position",
                return_value={"L_nuar": 10.0},
            ),
        ]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)
        calculate = patch.object(
            candidate_evaluator,
            "calculate_db",
            return_value={"db": 0.0, "udbytte": 0.0, "udbytteenhed": "hkg/ha"},
        )
        self.calculate = calculate.start()
        self.addCleanup(calculate.stop)

    def irrigated_by_crop(self) -> dict[int, set[bool]]:
        flags: dict[int, set[bool]] = {}
        for call in self.calculate.call_args_list:
            flags.setdefault(call.args[0], set()).add(call.kwargs["irrigated"])
        return flags

    def test_only_the_watered_crop_is_priced_as_irrigated(self) -> None:
        candidate_evaluator.evaluate_sequence_for_mark(
            RotationCandidateRef(saedskiftevariant="test", variant="1", n_norm_pct="100"),
            [VAARBYG, VINTERHVEDE] * 4,
            [None] * 8,
            [None] * 8,
            2,
            3,
            "Konventionel",
            0.0,
            100.0,
            False,
            irrigated_crops=frozenset({VAARBYG}),
        )
        self.assertEqual(self.irrigated_by_crop(), {VAARBYG: {True}, VINTERHVEDE: {False}})

    def prepare(self, vanding: VandingSettings) -> dict[int, set[bool]]:
        self.calculate.reset_mock()
        candidate_evaluator.compute_n_inputs.cache_clear()
        field = FieldRecord(
            id="field",
            farm_id="farm",
            name="1-0",
            imk_id=7,
            area_ha=2,
            db2=0,
            n_load=0,
            leaching=0,
        )
        registry = {
            "jbnr": 3,
            "crop_history": {"2026": PERMANENT_GRASS},
            "secondary_crop_history": {},
            "goedningsregion": None,
            "oeko": True,
        }
        simulation = Simulation(
            id="simulation",
            farm_id="farm",
            name="Test",
            created_at="2026-11-25",
            godning=ORGANIC,
            vanding=vanding,
        )
        with (
            patch.object(repository, "is_permanent_afgrode", return_value=True),
            patch.object(repository, "real_history_lookback", return_value=HISTORY),
            patch.object(repository, "_soil_data_for_context", return_value=None),
        ):
            preparation.prepare(simulation, [field], {}, {"field": registry})
        return self.irrigated_by_crop()

    def test_preparing_waters_the_chosen_crop_on_a_chosen_field_only(self) -> None:
        watered = VandingSettings(imk_ids=[7], afgrode_koder=[PERMANENT_GRASS])
        other_field = VandingSettings(imk_ids=[8], afgrode_koder=[PERMANENT_GRASS])
        self.assertEqual(self.prepare(watered), {PERMANENT_GRASS: {True}})
        self.assertEqual(self.prepare(other_field), {PERMANENT_GRASS: {False}})


if __name__ == "__main__":
    unittest.main()
