import unittest

from app.services.nles5.engine import WP_FALLBACK, C_func, calculate_leaching, sample_crop_mapping


class CropEffectTests(unittest.TestCase):
    def test_potato_codes_keep_the_m_they_are_given(self) -> None:
        sample = {**sample_crop_mapping(), "M": 2}
        potato = calculate_leaching({**sample, "crop_code": 151})
        other_crop = calculate_leaching({**sample, "crop_code": 1})
        self.assertEqual(potato["L"], other_crop["L"])

    def test_known_wp_uses_its_category_coefficient(self) -> None:
        self.assertAlmostEqual(C_func(M=1, W=1, MP=1, WP=2), 9.704)

    def test_wp11_placeholder_uses_the_fixed_wp_constant(self) -> None:
        self.assertEqual(WP_FALLBACK, 7.2595)
        self.assertAlmostEqual(C_func(M=1, W=1, MP=1, WP=11), 7.2595)


if __name__ == "__main__":
    unittest.main()
