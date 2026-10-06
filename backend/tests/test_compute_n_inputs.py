import os
import unittest
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://dst2:dst2@localhost:5432/dst2",
)

from app.services.scenario import candidate_evaluator

VINTERHVEDE = 11
VAARBYG = 1
VAARHVEDE = 2
VINTERRAPS = 22
KLOEVERGRAES = 260

NORMS = {
    VINTERHVEDE: {"n_norm": 175.0, "forfrugtsvaerdi": 0.0},
    VAARBYG: {"n_norm": 136.0, "forfrugtsvaerdi": 0.0},
    VAARHVEDE: {"n_norm": 165.0, "forfrugtsvaerdi": 0.0},
    VINTERRAPS: {"n_norm": 159.0, "forfrugtsvaerdi": 18.0},
    KLOEVERGRAES: {"n_norm": 286.0, "forfrugtsvaerdi": 115.0},
}


def fake_lookup_norm(crop_code, jb_nr, irrigated=False, only_organic=False):
    return NORMS.get(crop_code)


class ComputeNInputsTests(unittest.TestCase):
    def setUp(self) -> None:
        candidate_evaluator.compute_n_inputs.cache_clear()
        patcher = patch.object(
            candidate_evaluator.afgroede_normer, "lookup_norm", fake_lookup_norm,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(candidate_evaluator.compute_n_inputs.cache_clear)

    def mncs(
        self, afgrode: int, forfrugt: int, pct: float, driftsform: str = "Konventionel",
    ) -> float:
        result = candidate_evaluator.compute_n_inputs(
            afgrode, forfrugt, None, 1, pct, 0.0, 70.0, False, False, driftsform,
        )
        return result["mncs"]

    def test_full_norm_fertilizes_what_the_forfrugt_does_not_cover(self) -> None:
        self.assertEqual(self.mncs(VINTERHVEDE, VINTERRAPS, 100), 175.0 - 18.0)

    def test_kvote_is_total_available_n_including_forfrugt(self) -> None:
        # 80 % of 175 = 140 available; the forfrugt covers 18 of it.
        self.assertAlmostEqual(self.mncs(VINTERHVEDE, VINTERRAPS, 80), 122.0)

    def test_forfrugt_above_the_kvote_means_no_fertilizer(self) -> None:
        # 80 % of 136 = 108.8 < forfrugtsværdi 115.
        self.assertEqual(self.mncs(VAARBYG, KLOEVERGRAES, 80), 0.0)

    def test_crop_without_response_curve_is_fertilized_at_full_norm(self) -> None:
        self.assertEqual(self.mncs(VAARHVEDE, VINTERRAPS, 80), 165.0 - 18.0)

    def test_oekologisk_is_fertilized_at_full_norm(self) -> None:
        self.assertEqual(self.mncs(VINTERHVEDE, VINTERRAPS, 80, "Økologisk"), 175.0 - 18.0)


if __name__ == "__main__":
    unittest.main()
