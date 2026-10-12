"""Checks for the PUMR 2027 retention overlap (requirements spec, field A22)."""

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import geopandas as gpd
import numpy as np
from pyogrio import read_dataframe, write_dataframe
from shapely import box

from database.scripts.load_retentionskort import area_weighted_retention, load_retentionskort
from database.scripts.merged_gpkg import LAYER, gpkg_is_empty

MAP_VALUES = np.array([20.0, 60.0])
MAP_POLYGONS = np.array([box(0, 0, 100, 100), box(100, 0, 200, 100)])


class AreaWeightedRetentionTests(unittest.TestCase):
    def test_weights_each_polygon_by_its_overlap_and_rounds_to_two_decimals(self) -> None:
        fields = np.array([box(50, 0, 200, 100)])

        retention = area_weighted_retention(fields, MAP_VALUES, MAP_POLYGONS)

        # (5,000 m² at 20 % + 10,000 m² at 60 %) / 15,000 m² = 46.666...
        np.testing.assert_array_equal(retention, [46.67])

    def test_averages_only_over_the_part_that_overlaps_the_map(self) -> None:
        fields = np.array([box(-100, 0, 100, 100)])

        retention = area_weighted_retention(fields, MAP_VALUES, MAP_POLYGONS)

        np.testing.assert_array_equal(retention, [20.0])

    def test_leaves_a_field_without_overlap_area_unresolved(self) -> None:
        fields = np.array([box(500, 500, 600, 600), box(200, 0, 300, 100)])

        retention = area_weighted_retention(fields, MAP_VALUES, MAP_POLYGONS)

        np.testing.assert_array_equal(retention, [np.nan, np.nan])


class GeoPackageUpdateTests(unittest.TestCase):
    def test_overwrites_rettot_and_keeps_the_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            gpkg_path = Path(directory) / "fields.gpkg"
            map_path = Path(directory) / "retention.shp"
            fields = gpd.GeoDataFrame(
                {"IMK_ID": [1, 2], "RetTot": [31.598, 75.0]},
                geometry=[box(50, 0, 200, 100), box(500, 500, 600, 600)],
                crs="EPSG:25832",
            )
            write_dataframe(fields, gpkg_path, layer=LAYER)
            write_dataframe(
                gpd.GeoDataFrame({"RetTot": MAP_VALUES}, geometry=MAP_POLYGONS, crs="EPSG:25832"),
                map_path,
            )

            with redirect_stdout(io.StringIO()):
                load_retentionskort(gpkg_path, map_path)

            updated = read_dataframe(str(gpkg_path), layer=LAYER)
            np.testing.assert_array_equal(updated["RetTot"], [46.67, np.nan])
            self.assertTrue(updated.geometry.geom_equals(fields.geometry).all())


class GpkgIsEmptyTests(unittest.TestCase):
    def test_reads_the_empty_flag_from_the_blob_header(self) -> None:
        self.assertEqual(gpkg_is_empty(b"GP\x00\x11"), 1)
        self.assertEqual(gpkg_is_empty(b"GP\x00\x03"), 0)
        self.assertIsNone(gpkg_is_empty(None))


if __name__ == "__main__":
    unittest.main()
