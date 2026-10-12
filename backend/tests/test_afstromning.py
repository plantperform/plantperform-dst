import unittest
from unittest.mock import patch

from app.services.nles5.bridge_v2 import _har_vinterplantedaekke
from app.services.rotations import afstromning

VAARBYG = 1
VINTERHVEDE = 11
KLOVERGRAES = 260
BRAK = 310

VAARBYG_PARAMS = {"M": 2, "W": None}
VINTERHVEDE_PARAMS = {"M": 1, "W": None, "W_efteraar": 1}
KLOVERGRAES_PARAMS = {"M": 4, "W": 6, "W_efteraar": 6}
BRAK_PARAMS = {"M": 6, "W": 4, "W_efteraar": 5}


def har(this, this_params, nxt, next_params, udlaeg=None):
    return _har_vinterplantedaekke(this, this_params, nxt, next_params, udlaeg)


class HarVinterplantedaekkeTest(unittest.TestCase):
    """PUMR, felt A64: any vinterplantedække but 921 Bar jord or 922 Stub."""

    def test_sekundaer_afgroede_is_a_vinterplantedaekke(self) -> None:
        for udlaeg in (968, 950, 965, 2000, 9682, 9683):
            self.assertTrue(har(VAARBYG, VAARBYG_PARAMS, VAARBYG, VAARBYG_PARAMS, udlaeg))

    def test_bar_jord_and_stub_are_not(self) -> None:
        for udlaeg in (921, 922):
            self.assertFalse(
                har(VAARBYG, VAARBYG_PARAMS, VINTERHVEDE, VINTERHVEDE_PARAMS, udlaeg)
            )

    def test_afgroede_established_in_autumn_after_it(self) -> None:
        self.assertTrue(har(VAARBYG, VAARBYG_PARAMS, VINTERHVEDE, VINTERHVEDE_PARAMS))
        self.assertTrue(har(VAARBYG, VAARBYG_PARAMS, KLOVERGRAES, KLOVERGRAES_PARAMS))

    def test_spring_sown_afgroede_after_it_leaves_stub(self) -> None:
        self.assertFalse(har(VAARBYG, VAARBYG_PARAMS, VAARBYG, VAARBYG_PARAMS))
        self.assertFalse(har(VAARBYG, VAARBYG_PARAMS, None, {}))

    def test_continuing_afgroede_establishes_nothing(self) -> None:
        self.assertFalse(har(BRAK, BRAK_PARAMS, BRAK, BRAK_PARAMS))


@patch.object(afstromning, "_load", lambda: {VAARBYG: (3, 1), VINTERHVEDE: (4, None)})
class AfstromningskategoriTest(unittest.TestCase):
    def test_vinterplantedaekke_switches_to_the_alternative_category(self) -> None:
        self.assertEqual(afstromning.afstromningskategori(VAARBYG), 3)
        self.assertEqual(afstromning.afstromningskategori(VAARBYG, vinterdaekke=True), 1)

    def test_afgroede_without_an_alternative_keeps_its_category(self) -> None:
        self.assertEqual(afstromning.afstromningskategori(VINTERHVEDE, vinterdaekke=True), 4)

    def test_unknown_afgroede(self) -> None:
        self.assertIsNone(afstromning.afstromningskategori(999, vinterdaekke=True))


if __name__ == "__main__":
    unittest.main()
