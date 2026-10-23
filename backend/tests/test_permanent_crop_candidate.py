import os
import unittest
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://dst2:dst2@localhost:5432/dst2",
)

from app.domain.simulation import GodningSettings
from app.services.scenario import candidate_evaluator

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


if __name__ == "__main__":
    unittest.main()
