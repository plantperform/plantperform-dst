import unittest
from unittest.mock import patch

from app.services.virkemidler import praecisionsgoedskning_tilladt, virkemiddel_tilladt

VAARBYG = 1
VINTERHVEDE = 11
VINTERRAPS = 22
VAARBYG_EFTERAARSSAAET = 70
RAJGRAESFROE = 101
MAJS = 5
KLOEVERGRAES = 260

MELLEMAFGROEDE = 9682
MELLEMAFGROEDE_E_FROEGRAES = 9684
TIDLIG_SAANING = 9683

# "ME - mellemafgroeder", "ME - tidlig saaning" and "Praec.goedsk.eff." as the
# afgrøde table holds them.
_PARAMS = {
    VAARBYG: {"praecisionsgoedskning_mulig": True},
    VINTERRAPS: {"praecisionsgoedskning_mulig": True},
    VAARBYG_EFTERAARSSAAET: {"praecisionsgoedskning_mulig": True},
    VINTERHVEDE: {"mellemafgroede_mulig": True, "tidlig_saaning_mulig": True},
    RAJGRAESFROE: {"mellemafgroede_mulig": True, "tidlig_saaning_mulig": True},
    MAJS: {"mellemafgroede_mulig": False, "tidlig_saaning_mulig": False},
    KLOEVERGRAES: {"mellemafgroede_mulig": False, "tidlig_saaning_mulig": True},
}


def _lookup(code):
    return _PARAMS.get(code, {})


@patch("app.services.virkemidler.afgroede_normer.lookup_crop_params", _lookup)
class VirkemiddelTilladtTests(unittest.TestCase):
    def test_mellemafgroede_before_vintersaed(self) -> None:
        self.assertTrue(virkemiddel_tilladt(MELLEMAFGROEDE, VINTERHVEDE, VINTERHVEDE))
        self.assertTrue(
            virkemiddel_tilladt(MELLEMAFGROEDE_E_FROEGRAES, RAJGRAESFROE, VAARBYG_EFTERAARSSAAET)
        )

    def test_mellemafgroede_needs_an_efteraarssaaet_vintersaed_after_it(self) -> None:
        self.assertFalse(virkemiddel_tilladt(MELLEMAFGROEDE_E_FROEGRAES, RAJGRAESFROE, VAARBYG))
        self.assertFalse(virkemiddel_tilladt(MELLEMAFGROEDE, VINTERHVEDE, VINTERRAPS))
        self.assertFalse(virkemiddel_tilladt(TIDLIG_SAANING, VINTERHVEDE, VAARBYG))

    def test_the_hovedafgroede_must_allow_the_virkemiddel(self) -> None:
        self.assertFalse(virkemiddel_tilladt(MELLEMAFGROEDE, MAJS, VINTERHVEDE))
        self.assertFalse(virkemiddel_tilladt(MELLEMAFGROEDE, KLOEVERGRAES, VINTERHVEDE))
        self.assertTrue(virkemiddel_tilladt(TIDLIG_SAANING, KLOEVERGRAES, VINTERHVEDE))

    def test_unknown_next_afgroede_checks_only_the_hovedafgroede(self) -> None:
        self.assertTrue(virkemiddel_tilladt(MELLEMAFGROEDE, VINTERHVEDE, None))
        self.assertFalse(virkemiddel_tilladt(MELLEMAFGROEDE, MAJS, None))

    def test_other_udlaeg_are_not_restricted(self) -> None:
        for code in (None, 968, 960, 921, 2000, 9680):
            self.assertTrue(virkemiddel_tilladt(code, MAJS, VAARBYG))


@patch("app.services.virkemidler.afgroede_normer.lookup_crop_params", _lookup)
class PraecisionsgoedskningTilladtTests(unittest.TestCase):
    def test_korn_and_raps_from_the_afgroede_table(self) -> None:
        for code in (VAARBYG, VINTERRAPS, VAARBYG_EFTERAARSSAAET):
            self.assertTrue(praecisionsgoedskning_tilladt(code))

    def test_other_afgroeder_may_not(self) -> None:
        for code in (MAJS, KLOEVERGRAES, RAJGRAESFROE, None):
            self.assertFalse(praecisionsgoedskning_tilladt(code))


if __name__ == "__main__":
    unittest.main()
