"""Checks for reading the merged GeoPackage's rows into the registry."""

import unittest
from types import SimpleNamespace

from database.scripts.load_registry_from_merged_gpkg import secondary_crop_history


class SecondaryCropHistoryTests(unittest.TestCase):
    def test_keeps_the_years_with_a_secondary_crop(self) -> None:
        row = SimpleNamespace(SekAfg2024=968.0, SekAfg2025=float("nan"), SekAfg2026=None)

        self.assertEqual(secondary_crop_history(row), {"2024": 968})

    def test_gives_none_without_secondary_crop_columns(self) -> None:
        self.assertEqual(secondary_crop_history(SimpleNamespace()), {})


if __name__ == "__main__":
    unittest.main()
