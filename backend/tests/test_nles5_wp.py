import unittest
from unittest.mock import patch

from app.services.nles5.bridge_v2 import _resolve_wp

# A slice of the afgrøde table's WP column (11 is its placeholder).
_TABLE_WP = {
    1: 11,     # Vårbyg
    11: 1,     # Vinterhvede
    22: 8,     # Vinterraps
    160: 11,   # Sukkerroer til fabrik
    216: 11,   # Majshelsæd
    151: 11,   # Kartofler, stivelses-
    252: 3,    # Permanent græs, normalt udbytte
    101: 5,    # Rajgræsfrø
    125: 6,    # Bederoefrø
    968: 4,    # Efterafgrøder, pligtige
    965: 11,   # Kløvergræs udlæg, placeholder
    1011: 11,  # Vinterhvede in a table without WP values
    1022: 11,  # Vinterraps in a table without WP values
    1101: 5,   # Frøgræs that would be M1
}

# M is only set where a test relies on it.
_TABLE_M = {1: 2, 1011: 1, 1022: 9, 1101: 1}


def _params(code):
    if code not in _TABLE_WP:
        return {}
    return {"WP": _TABLE_WP[code], "M": _TABLE_M.get(code)}


def resolve(prev, this, prev_udlaeg=None):
    return _resolve_wp(prev, _params(prev), _params(this), prev_udlaeg)


@patch("app.services.nles5.bridge_v2.afgroede_normer.lookup_crop_params", _params)
class ResolveWpTests(unittest.TestCase):
    def test_sekundaer_afgroede_uses_its_table_wp(self) -> None:
        self.assertEqual(resolve(1, 11, prev_udlaeg=968), 4)

    def test_sekundaer_afgroede_without_table_wp_uses_udlaeg_mapping(self) -> None:
        self.assertEqual(resolve(1, 1, prev_udlaeg=965), 3)
        self.assertEqual(resolve(1, 1, prev_udlaeg=2000), 5)

    def test_tidlig_saaning_marker_falls_through_to_the_afgroeder(self) -> None:
        self.assertEqual(resolve(1, 1, prev_udlaeg=9683), 2)

    def test_autumn_sown_current_afgroede_occupies_the_winter(self) -> None:
        self.assertEqual(resolve(1, 11), 1)
        self.assertEqual(resolve(1, 22), 8)

    def test_autumn_sown_m_decides_only_without_a_table_wp(self) -> None:
        self.assertEqual(resolve(1, 1011), 1)
        self.assertEqual(resolve(1, 1022), 8)
        self.assertEqual(resolve(1, 1101), 2)

    def test_overwintering_forfrugt_uses_its_own_wp(self) -> None:
        self.assertEqual(resolve(252, 1), 3)
        self.assertEqual(resolve(101, 1), 5)
        self.assertEqual(resolve(125, 1), 6)

    def test_bare_winter_after_majs_or_kartofler_is_wp7(self) -> None:
        self.assertEqual(resolve(216, 1), 7)
        self.assertEqual(resolve(151, 1), 7)

    def test_other_bare_winters_are_wp2(self) -> None:
        self.assertEqual(resolve(1, 1), 2)
        self.assertEqual(resolve(11, 1), 2)
        self.assertEqual(resolve(160, 1), 2)

    def test_unknown_forfrugt_is_left_to_the_fixed_value(self) -> None:
        self.assertEqual(resolve(None, 1), 11)


if __name__ == "__main__":
    unittest.main()
