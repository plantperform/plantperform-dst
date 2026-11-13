"""Checks for reading the merged GeoPackage's rows into the registry."""

import unittest
from types import SimpleNamespace

from database.scripts.load_registry_from_merged_gpkg import deduction_area, secondary_crop_history


class SecondaryCropHistoryTests(unittest.TestCase):
    def test_keeps_the_years_with_a_secondary_crop(self) -> None:
        row = SimpleNamespace(SekAfg2024=968.0, SekAfg2025=float("nan"), SekAfg2026=None)

        self.assertEqual(secondary_crop_history(row), {"2024": 968})

    def test_gives_none_without_secondary_crop_columns(self) -> None:
        self.assertEqual(secondary_crop_history(SimpleNamespace()), {})


class DeductionAreaTests(unittest.TestCase):
    def test_reads_the_fradragsareal_in_ha_with_four_decimals(self) -> None:
        self.assertEqual(deduction_area(SimpleNamespace(Fradragsareal=0.123456)), 0.1235)

    def test_gives_no_deduction_without_the_column_or_a_value(self) -> None:
        for row in (
            SimpleNamespace(),
            SimpleNamespace(Fradragsareal=None),
            SimpleNamespace(Fradragsareal=float("nan")),
        ):
            with self.subTest(row=row):
                self.assertEqual(deduction_area(row), 0.0)


if __name__ == "__main__":
    unittest.main()
