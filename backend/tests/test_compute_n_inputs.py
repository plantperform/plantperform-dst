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
    VINTERHVEDE: {"n_norm": 175.0, "forfrugtsvaerdi": 0.0, "indregn_ffv": True},
    VAARBYG: {"n_norm": 136.0, "forfrugtsvaerdi": 0.0, "indregn_ffv": True},
    VAARHVEDE: {"n_norm": 165.0, "forfrugtsvaerdi": 0.0, "indregn_ffv": True},
    VINTERRAPS: {"n_norm": 159.0, "forfrugtsvaerdi": 18.0, "indregn_ffv": True},
    KLOEVERGRAES: {"n_norm": 286.0, "forfrugtsvaerdi": 115.0, "indregn_ffv": False},
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

    def test_oekologisk_on_the_konventionel_norm_is_fertilized_at_full_norm(self) -> None:
        # No organic row: cutting N here would have no yield loss to go with it.
        self.assertEqual(self.mncs(VINTERHVEDE, VINTERRAPS, 80, "Økologisk"), 175.0 - 18.0)

    def test_oekologisk_with_its_own_norm_follows_the_kvote(self) -> None:
        norms = {
            **NORMS,
            VINTERHVEDE: {
                "n_norm": 144.0, "forfrugtsvaerdi": 0.0, "indregn_ffv": True,
                "driftsform": "Økologisk",
            },
        }
        with patch.object(
            candidate_evaluator.afgroede_normer,
            "lookup_norm",
            lambda crop_code, *args, **kwargs: norms.get(crop_code),
        ):
            # 80 % of the organic 144 = 115.2 available; the forfrugt covers 18.
            self.assertAlmostEqual(self.mncs(VINTERHVEDE, VINTERRAPS, 80, "Økologisk"), 97.2)

    def test_kloevergraes_standing_on_gets_no_forfrugtsvaerdi(self) -> None:
        # indregn_ffv Nej: the stand is not ploughed, so the full norm is fertilized.
        self.assertEqual(self.mncs(KLOEVERGRAES, KLOEVERGRAES, 100), 286.0)

    def test_indregn_ffv_nej_gets_no_forfrugtsvaerdi_after_another_afgroede(self) -> None:
        self.assertEqual(self.mncs(KLOEVERGRAES, VINTERRAPS, 100), 286.0)

    def fv(self, prev_udlaeg: int | None, afgrode: int = VAARBYG) -> float:
        result = candidate_evaluator.compute_n_inputs(
            afgrode, VINTERHVEDE, prev_udlaeg, 1, 100, 0.0, 70.0, False, False,
        )
        return result["fv_forfrugt"]

    def test_efterafgroede_gives_the_following_afgroede_a_forfrugtsvaerdi(self) -> None:
        for code in (950, 951, 954, 968, 970):
            self.assertEqual(self.fv(code), 21.0)

    def test_kvaelstoffikserende_efterafgroede_gives_50_kg(self) -> None:
        self.assertEqual(self.fv(952), 50.0)
        self.assertEqual(self.fv(953), 50.0)

    def test_mellemafgroede_and_continuing_froegraes_give_no_forfrugtsvaerdi(self) -> None:
        self.assertEqual(self.fv(9682), 0.0)
        self.assertEqual(self.fv(9680), 0.0)
        self.assertEqual(self.fv(None), 0.0)

    def test_indregn_ffv_nej_gets_no_efterafgroede_forfrugtsvaerdi(self) -> None:
        self.assertEqual(self.fv(950, KLOEVERGRAES), 0.0)
        self.assertEqual(self.fv(952, KLOEVERGRAES), 0.0)


if __name__ == "__main__":
    unittest.main()
