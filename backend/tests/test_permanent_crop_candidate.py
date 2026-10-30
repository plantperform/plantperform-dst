import os
import unittest
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://dst2:dst2@localhost:5432/dst2",
)

from app.data import repository
from app.data.simulation_store import split_field
from app.domain.field import FieldRecord
from app.domain.rotation_candidate import RotationCandidateRef, RotationPositionOverride
from app.domain.simulation import GodningSettings, Simulation
from app.services.scenario import candidate_evaluator
from plantperform_fargate import preparation

PERMANENT_GRASS = 252
NORM = {"n_norm": 158.0, "forfrugtsvaerdi": 18.0, "indregn_ffv": True}
# The field's Bilag 3 allocation in 2025/26, as real_history_lookback returns it.
HISTORY = {
    "2025": {"code": PERMANENT_GRASS, "mncs": 108.0, "mnca": 0.0, "g0": 44.0},
    "2026": {"code": PERMANENT_GRASS, "mncs": 108.0, "mnca": 0.0, "g0": 44.0},
}
ORGANIC = GodningSettings(
    driftsform="Økologisk", org_mineral_n=170.0, mineralsk_andel_pct=70.0, only_organic=True,
)


class PermanentCropCandidateTests(unittest.TestCase):
    def setUp(self) -> None:
        candidate_evaluator.compute_n_inputs.cache_clear()
        self.addCleanup(candidate_evaluator.compute_n_inputs.cache_clear)
        self.leaching_inputs: list[dict] = []
        patchers = [
            patch.object(candidate_evaluator.afgroede_normer, "lookup_norm", return_value=NORM),
            patch.object(candidate_evaluator.afgroede_normer, "lookup_nfix", return_value=0.0),
            patch.object(
                candidate_evaluator.afgroede_normer,
                "lookup_crop_params",
                return_value={"navn": "Permanent græs, normalt udbytte"},
            ),
            patch.object(
                candidate_evaluator.bridge_v2,
                "evaluate_leaching_position",
                side_effect=self.leaching,
            ),
            patch.object(
                candidate_evaluator,
                "calculate_db",
                return_value={"db": 1800.0, "udbytte": 5000.0, "udbytteenhed": "FE/ha"},
            ),
        ]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    def leaching(self, **values) -> dict:
        self.leaching_inputs.append(values)
        return {"L_nuar": 10.0}

    def candidate(self, godning: GodningSettings):
        return candidate_evaluator.generate_permanent_crop_candidate(
            PERMANENT_GRASS, 3, godning, real_history=HISTORY,
        )

    def test_organic_simulation_gets_no_mineral_fertiliser(self) -> None:
        for year in self.candidate(ORGANIC).years:
            self.assertEqual(year.tildelt_handelsgodning_kgn_ha, 0.0)
            self.assertEqual(year.tildelt_husdyrgodning_udnyttet_kgn_ha, 158.0 - 18.0)
            self.assertAlmostEqual(year.husdyrgodning_organisk_bundet_kgn_ha, 140.0 * 30 / 70)

    def test_conventional_simulation_without_manure_gets_mineral_fertiliser(self) -> None:
        for year in self.candidate(GodningSettings()).years:
            self.assertEqual(year.tildelt_handelsgodning_kgn_ha, 158.0 - 18.0)
            self.assertEqual(year.tildelt_husdyrgodning_udnyttet_kgn_ha, 0.0)

    def test_indregn_ffv_nej_keeps_the_full_norm_without_a_preceding_crop_deduction(self) -> None:
        with patch.object(
            candidate_evaluator.afgroede_normer,
            "lookup_norm",
            return_value={**NORM, "indregn_ffv": False},
        ):
            for godning in (ORGANIC, GodningSettings()):
                with self.subTest(driftsform=godning.driftsform):
                    for year in self.candidate(godning).years:
                        self.assertEqual(year.forfrugtsvaerdi_kgn_ha, 0.0)
                        self.assertEqual(
                            year.tildelt_handelsgodning_kgn_ha
                            + year.tildelt_husdyrgodning_udnyttet_kgn_ha,
                            NORM["n_norm"],
                        )

    def test_organic_manure_covers_a_norm_above_the_manure_setting(self) -> None:
        # 252 has no yield-response curve, so a cap below its norm of 158
        # would cut its N without costing any yield.
        godning = ORGANIC.model_copy(update={"org_mineral_n": 107.0})
        with patch.object(
            candidate_evaluator.afgroede_normer,
            "lookup_norm",
            return_value={**NORM, "indregn_ffv": False},
        ):
            for year in self.candidate(godning).years:
                self.assertEqual(year.tildelt_husdyrgodning_udnyttet_kgn_ha, 158.0)
                self.assertEqual(year.tildelt_handelsgodning_kgn_ha, 0.0)

    def test_stays_locked_to_the_crop_at_full_n_norm(self) -> None:
        candidate = self.candidate(ORGANIC)
        self.assertEqual(candidate.ref.to_id(), "permanent:252:100")
        self.assertEqual({year.year.afgrode_kode for year in candidate.years}, {PERMANENT_GRASS})
        self.assertEqual({year.n_norm_pct for year in candidate.years}, {100.0})

    def test_lookback_to_2025_and_2026_keeps_the_real_history(self) -> None:
        self.candidate(ORGANIC)
        first = self.leaching_inputs[0]
        self.assertEqual(
            (first["m1"], first["g1"], first["m2"], first["g2"]), (108.0, 44.0, 108.0, 44.0),
        )

    def preview(self, variant=str(PERMANENT_GRASS), overrides=()):
        return candidate_evaluator.evaluate_with_overrides(
            RotationCandidateRef(saedskiftevariant="permanent", variant=variant, n_norm_pct="100"),
            list(overrides),
            jbnr=3,
            driftsform=ORGANIC.driftsform,
            org_mineral_n=ORGANIC.org_mineral_n,
            mineralsk_andel_pct=ORGANIC.mineralsk_andel_pct,
            only_organic=ORGANIC.only_organic,
            real_history=HISTORY,
        )

    def test_manual_preview_without_changes_matches_the_locked_candidate(self) -> None:
        preview = self.preview()
        candidate = self.candidate(ORGANIC)
        self.assertEqual(preview.ref, candidate.ref)
        self.assertEqual(preview.active_len, 8)
        self.assertEqual(
            [year.year.afgrode_kode for year in preview.years],
            [PERMANENT_GRASS] * 8,
        )
        self.assertEqual(preview.avg_db_kr_ha, candidate.avg_db_kr_ha)
        self.assertEqual(preview.avg_leaching_kg_n_ha, candidate.avg_leaching_kg_n_ha)

    def test_manual_override_changes_one_year_and_keeps_the_permanent_base(self) -> None:
        preview = self.preview(
            overrides=[RotationPositionOverride(position=0, afgrode_kode=PERMANENT_GRASS + 1)]
        )
        self.assertEqual(preview.years[0].year.afgrode_kode, PERMANENT_GRASS + 1)
        self.assertEqual(preview.years[1].year.afgrode_kode, PERMANENT_GRASS)
        self.assertEqual(preview.base_ref.to_id(), f"permanent:{PERMANENT_GRASS}:100")
        self.assertIn("+manuel-", preview.ref.variant)

    def test_manual_preview_of_a_permanent_ref_without_a_crop_code_gives_nothing(self) -> None:
        with patch.object(
            candidate_evaluator.saedskifte_library,
            "generate_rotation",
            return_value=[(None, None, None)] * 8,
        ):
            self.assertIsNone(self.preview(variant="ukendt"))

    def prepare_field_locked_to(self, candidate):
        rotation_id = candidate.ref.to_id()
        field = FieldRecord(
            id="field",
            farm_id="farm",
            name="1-0",
            area_ha=2,
            db2=0,
            n_load=0,
            leaching=0,
            rotation_id=rotation_id,
            allowed_rotation_ids=[rotation_id],
        )
        setup = {
            **split_field(field.model_dump(mode="json")),
            "fixed_candidate": candidate.model_dump(mode="json"),
        }
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
            created_at="2026-10-30",
            godning=ORGANIC,
        )
        with (
            patch.object(repository, "is_permanent_afgrode", return_value=True),
            patch.object(repository, "real_history_lookback", return_value=HISTORY),
            patch.object(repository, "_soil_data_for_context", return_value=None),
        ):
            snapshot = preparation.prepare(
                simulation, [field], {"field": setup}, {"field": registry}
            )
        return snapshot.fields[0], snapshot.setup_fields["field"]["fixed_candidate"]

    def test_preparing_again_keeps_a_saved_edit_of_a_permanent_field(self) -> None:
        edited = self.preview(
            overrides=[RotationPositionOverride(position=0, afgrode_kode=PERMANENT_GRASS + 1)]
        )
        field, candidate = self.prepare_field_locked_to(edited)
        self.assertEqual(field.rotation_id, edited.ref.to_id())
        self.assertEqual(field.allowed_rotation_ids, [edited.ref.to_id()])
        self.assertEqual(field.crop_rotation[0].afgrode_kode, PERMANENT_GRASS + 1)
        self.assertEqual(candidate["ref"]["variant"], edited.ref.variant)

    def test_preparing_again_keeps_the_automatic_lock_of_a_permanent_field(self) -> None:
        locked = self.candidate(ORGANIC)
        field, candidate = self.prepare_field_locked_to(locked)
        self.assertEqual(field.rotation_id, locked.ref.to_id())
        self.assertEqual(field.crop_rotation[0].afgrode_kode, PERMANENT_GRASS)
        self.assertIsNone(candidate["base_ref"])


if __name__ == "__main__":
    unittest.main()
