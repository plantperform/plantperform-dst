import unittest
from unittest.mock import patch

from app.services.nles5.bridge_v2 import _resolve_mp, _resolve_w

GRAES = 252
KLOVERGRAES = 260
BRAK = 310
VINTERHVEDE = 11
VAARBYG = 1
MAJS = 5
KARTOFLER = 151
GRAES_UDEGRISE = 270

GRAES_PARAMS = {"M": 4, "W": 6, "MP": 3, "W_efteraar": 6, "W_omploejning": 8}
KLOVERGRAES_PARAMS = {"M": 4, "W": 6, "MP": 3, "W_efteraar": 6, "W_omploejning": 8}
BRAK_PARAMS = {"M": 6, "W": 4, "MP": 2, "W_efteraar": 5}
VINTERHVEDE_PARAMS = {"M": 1, "W": None, "MP": 1, "W_efteraar": 1, "W_efter_graes": 7}
VAARBYG_PARAMS = {"M": 2, "W": None, "MP": 2}
MAJS_PARAMS = {"M": 8, "W": 3, "MP": 2}
KARTOFLER_PARAMS = {"M": 7, "W": 6, "MP": 2}
GRAES_UDEGRISE_PARAMS = {"M": 11, "W": 3, "MP": 3, "W_efteraar": 3}

# Udlægskoder as the afgrøde table holds them (Bilag 2, table 7).
_UDLAEG_PARAMS = {968: {"M": 4, "W": None, "W_efteraar": 5}}


def _lookup(code):
    return _UDLAEG_PARAMS.get(code, {})


class ResolveMpTest(unittest.TestCase):
    """græs -> vinterhvede -> vårbyg: MP4 belongs to the vårbyg, not the vinterhvede."""

    def test_afgroede_right_after_graes_gets_the_graes_mp(self) -> None:
        self.assertEqual(_resolve_mp(GRAES_PARAMS, GRAES, VAARBYG), 3)

    def test_afgroede_two_years_after_graes_gets_mp4(self) -> None:
        self.assertEqual(_resolve_mp(VINTERHVEDE_PARAMS, VINTERHVEDE, GRAES), 4)

    def test_forfrugt_outside_the_mp4_list_keeps_its_own_mp(self) -> None:
        self.assertEqual(_resolve_mp({"MP": 2}, 999, GRAES), 2)

    def test_no_langvarig_forforfrugt_keeps_the_forfrugt_mp(self) -> None:
        self.assertEqual(_resolve_mp(VAARBYG_PARAMS, VAARBYG, VINTERHVEDE), 2)


@patch("app.services.nles5.bridge_v2.afgroede_normer.lookup_crop_params", _lookup)
class ResolveWTest(unittest.TestCase):
    """W is the winter cover after the afgrøde, inferred from the rotation."""

    def test_graes_before_vintersaed_is_w7(self) -> None:
        w = _resolve_w(GRAES, GRAES_PARAMS, VINTERHVEDE, VINTERHVEDE_PARAMS, None)
        self.assertEqual(w, 7)

    def test_graes_standing_through_the_winter_keeps_w6(self) -> None:
        for next_code, next_params in (
            (VAARBYG, VAARBYG_PARAMS), (MAJS, MAJS_PARAMS), (KARTOFLER, KARTOFLER_PARAMS),
        ):
            self.assertEqual(_resolve_w(GRAES, GRAES_PARAMS, next_code, next_params, None), 6)

    def test_graes_ploughed_after_harvest_is_w8(self) -> None:
        w = _resolve_w(GRAES, GRAES_PARAMS, VAARBYG, VAARBYG_PARAMS, 921)
        self.assertEqual(w, 8)

    def test_froegraes_continuing_after_harvest_keeps_its_own_w(self) -> None:
        w = _resolve_w(GRAES, GRAES_PARAMS, VAARBYG, VAARBYG_PARAMS, 9680)
        self.assertEqual(w, 6)

    def test_brak_before_spring_crop_keeps_its_fixed_w(self) -> None:
        w = _resolve_w(BRAK, BRAK_PARAMS, VAARBYG, VAARBYG_PARAMS, None)
        self.assertEqual(w, 4)

    def test_brak_before_vintersaed_is_w7(self) -> None:
        w = _resolve_w(BRAK, BRAK_PARAMS, VINTERHVEDE, VINTERHVEDE_PARAMS, None)
        self.assertEqual(w, 7)

    def test_vintersaed_after_graes_does_not_get_w7_itself(self) -> None:
        w = _resolve_w(VINTERHVEDE, VINTERHVEDE_PARAMS, VAARBYG, VAARBYG_PARAMS, None)
        self.assertEqual(w, 5)

    def test_vintersaed_sown_after_the_afgroede_is_its_w(self) -> None:
        w = _resolve_w(VAARBYG, VAARBYG_PARAMS, VINTERHVEDE, VINTERHVEDE_PARAMS, None)
        self.assertEqual(w, 1)

    def test_fixed_w_beats_vintersaed_sown_after_the_afgroede(self) -> None:
        w = _resolve_w(KARTOFLER, KARTOFLER_PARAMS, VINTERHVEDE, VINTERHVEDE_PARAMS, None)
        self.assertEqual(w, 6)

    def test_fixed_w_beats_an_efterafgroede(self) -> None:
        self.assertEqual(_resolve_w(MAJS, MAJS_PARAMS, VAARBYG, VAARBYG_PARAMS, 968), 3)
        self.assertEqual(
            _resolve_w(KARTOFLER, KARTOFLER_PARAMS, VAARBYG, VAARBYG_PARAMS, 968), 6
        )

    def test_efterafgroede_after_an_afgroede_without_fixed_w(self) -> None:
        w = _resolve_w(VAARBYG, VAARBYG_PARAMS, VAARBYG, VAARBYG_PARAMS, 968)
        self.assertEqual(w, 5)

    def test_mellemafgroede_leaves_w_to_the_vintersaed_after_it(self) -> None:
        w = _resolve_w(VAARBYG, VAARBYG_PARAMS, VINTERHVEDE, VINTERHVEDE_PARAMS, 9682)
        self.assertEqual(w, 1)

    def test_fixed_w_without_a_vinterplantedaekke(self) -> None:
        w = _resolve_w(MAJS, MAJS_PARAMS, VAARBYG, VAARBYG_PARAMS, None)
        self.assertEqual(w, 3)

    def test_vintersaed_after_itself_is_sown_anew(self) -> None:
        w = _resolve_w(VINTERHVEDE, VINTERHVEDE_PARAMS, VINTERHVEDE, VINTERHVEDE_PARAMS, None)
        self.assertEqual(w, 1)

    def test_fixed_w_beats_a_table_7_afgroede_after_brak_or_graes(self) -> None:
        self.assertEqual(_resolve_w(BRAK, BRAK_PARAMS, BRAK, BRAK_PARAMS, None), 4)
        self.assertEqual(
            _resolve_w(GRAES, GRAES_PARAMS, KLOVERGRAES, KLOVERGRAES_PARAMS, None), 6
        )
        self.assertEqual(_resolve_w(GRAES, GRAES_PARAMS, BRAK, BRAK_PARAMS, None), 6)

    def test_graesudlaeg_after_vaarbyg_is_its_w(self) -> None:
        w = _resolve_w(VAARBYG, VAARBYG_PARAMS, KLOVERGRAES, KLOVERGRAES_PARAMS, None)
        self.assertEqual(w, 6)

    def test_table_7_afgroede_does_not_replace_a_fixed_w(self) -> None:
        w = _resolve_w(MAJS, MAJS_PARAMS, KLOVERGRAES, KLOVERGRAES_PARAMS, None)
        self.assertEqual(w, 3)

    def test_static_m11_afgroede_does_not_mean_ploughed_graes(self) -> None:
        w = _resolve_w(VAARBYG, VAARBYG_PARAMS, GRAES_UDEGRISE, GRAES_UDEGRISE_PARAMS, None)
        self.assertEqual(w, 3)


if __name__ == "__main__":
    unittest.main()
