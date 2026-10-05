import unittest

from app.services.economics.udbytterespons import har_udbytterespons, udbytte_faktor

# Yields from ResponsTilKvotereduktion.xlsx at 100, 80 and 50 % of the N-norm.
VINTERHVEDE_JB1_3 = {1.0: 57.0, 0.8: 53.85069299999999, 0.5: 42.876468749999994}
VAARBYG_JB5_6 = {1.0: 66.0, 0.8: 62.923446995744676, 0.5: 53.94416648936169}


class UdbytteFaktorTests(unittest.TestCase):
    def assert_matches_sheet(self, code: int, jbnr: int, n_norm: float, sheet: dict) -> None:
        for andel, udbytte in sheet.items():
            faktor = udbytte_faktor(code, jbnr, False, andel * n_norm, n_norm)
            self.assertAlmostEqual(faktor * sheet[1.0], udbytte, places=2)

    def test_full_norm_gives_full_yield(self) -> None:
        self.assertEqual(udbytte_faktor(11, 1, False, 175.0, 175.0), 1.0)

    def test_matches_the_source_sheet(self) -> None:
        self.assert_matches_sheet(11, 1, 175.0, VINTERHVEDE_JB1_3)
        self.assert_matches_sheet(1, 5, 140.0, VAARBYG_JB5_6)

    def test_forfrugt_above_the_norm_gives_full_yield(self) -> None:
        self.assertEqual(udbytte_faktor(1, 1, False, 140.0, 136.0), 1.0)

    def test_forfrugt_above_the_kvote_drives_the_yield(self) -> None:
        # Vårbyg after kløvergræs at 80 %: no fertilizer, forfrugt 115 of norm 136.
        faktor = udbytte_faktor(1, 1, False, 115.0, 136.0)
        self.assertAlmostEqual(47.0 * faktor, 44.91, places=2)

    def test_curve_is_held_below_fifty_percent(self) -> None:
        self.assertEqual(
            udbytte_faktor(11, 1, False, 40.0, 175.0),
            udbytte_faktor(11, 1, False, 87.5, 175.0),
        )

    def test_irrigated_sand_uses_the_irrigated_curve(self) -> None:
        self.assertNotEqual(
            udbytte_faktor(11, 1, True, 140.0, 175.0),
            udbytte_faktor(11, 1, False, 140.0, 175.0),
        )

    def test_crop_without_curve_keeps_full_yield(self) -> None:
        self.assertEqual(udbytte_faktor(2, 1, False, 80.0, 165.0), 1.0)


class HarUdbytteresponsTests(unittest.TestCase):
    def test_only_konventionelle_crops_with_a_curve(self) -> None:
        self.assertTrue(har_udbytterespons(11, "Konventionel"))
        self.assertFalse(har_udbytterespons(11, "Økologisk"))
        self.assertFalse(har_udbytterespons(2, "Konventionel"))
        self.assertFalse(har_udbytterespons(None, "Konventionel"))


if __name__ == "__main__":
    unittest.main()
