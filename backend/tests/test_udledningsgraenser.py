"""Checks for the PUMR 2027 udledningsgrænse overlap (requirements spec, field A78)."""

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import geopandas as gpd
import numpy as np
from pyogrio import read_dataframe, write_dataframe
from shapely import box

from database.scripts.load_udledningsgraenser import (
    LIMIT_COLUMN,
    area_weighted_limit,
    load_udledningsgraenser,
)
from database.scripts.merged_gpkg import LAYER

CELL_LIMITS = np.array([10.0, 20.5])
CELL_POLYGONS = np.array([box(0, 0, 100, 100), box(100, 0, 200, 100)])


class AreaWeightedLimitTests(unittest.TestCase):
    def test_weights_each_cell_by_its_overlap_and_rounds_to_two_decimals(self) -> None:
        fields = np.array([box(0, 0, 130, 100)])

        limit = area_weighted_limit(fields, CELL_LIMITS, CELL_POLYGONS)

        # (10,000 m² at 10.0 + 3,000 m² at 20.5) / 13,000 m² = 12.4230...
        np.testing.assert_array_equal(limit, [12.42])

    def test_averages_only_over_the_part_that_overlaps_the_map(self) -> None:
        fields = np.array([box(-100, 0, 100, 100)])

        limit = area_weighted_limit(fields, CELL_LIMITS, CELL_POLYGONS)

        np.testing.assert_array_equal(limit, [10.0])

    def test_leaves_a_field_without_overlap_area_unresolved(self) -> None:
        # The second field only touches the map along an edge.
        fields = np.array([box(500, 500, 600, 600), box(200, 0, 300, 100)])

        limit = area_weighted_limit(fields, CELL_LIMITS, CELL_POLYGONS)

        np.testing.assert_array_equal(limit, [np.nan, np.nan])

    def test_reports_the_progress_once_the_last_field_is_done(self) -> None:
        fields = np.array([box(0, 0, 50, 50), box(100, 0, 150, 50), box(500, 500, 600, 600)])
        reported: list[tuple[int, int]] = []

        area_weighted_limit(
            fields,
            CELL_LIMITS,
            CELL_POLYGONS,
            progress=lambda done, total: reported.append((done, total)),
        )

        self.assertEqual(reported[-1], (3, 3))


class GeoPackageUpdateTests(unittest.TestCase):
    def write_sources(self, directory: str, fields: gpd.GeoDataFrame) -> tuple[Path, Path]:
        gpkg_path = Path(directory) / "fields.gpkg"
        map_path = Path(directory) / "limits.shp"
        write_dataframe(fields, gpkg_path, layer=LAYER)
        write_dataframe(
            gpd.GeoDataFrame({"Udledgr": CELL_LIMITS}, geometry=CELL_POLYGONS, crs="EPSG:25832"),
            map_path,
        )
        return gpkg_path, map_path

    def test_overwrites_the_limit_and_keeps_the_geometry(self) -> None:
        fields = gpd.GeoDataFrame(
            {"IMK_ID": [1, 2], LIMIT_COLUMN: [99.0, 99.0]},
            geometry=[box(0, 0, 130, 100), box(500, 500, 600, 600)],
            crs="EPSG:25832",
        )
        with tempfile.TemporaryDirectory() as directory:
            gpkg_path, map_path = self.write_sources(directory, fields)

            with redirect_stdout(io.StringIO()):
                load_udledningsgraenser(gpkg_path, map_path)

            updated = read_dataframe(str(gpkg_path), layer=LAYER)
            np.testing.assert_array_equal(updated[LIMIT_COLUMN], [12.42, np.nan])
            self.assertTrue(updated.geometry.geom_equals(fields.geometry).all())

    def test_adds_the_column_to_a_geopackage_that_lacks_it(self) -> None:
        fields = gpd.GeoDataFrame({"IMK_ID": [1]}, geometry=[box(0, 0, 100, 100)], crs="EPSG:25832")
        with tempfile.TemporaryDirectory() as directory:
            gpkg_path, map_path = self.write_sources(directory, fields)

            with redirect_stdout(io.StringIO()):
                load_udledningsgraenser(gpkg_path, map_path)

            updated = read_dataframe(str(gpkg_path), layer=LAYER)
            np.testing.assert_array_equal(updated[LIMIT_COLUMN], [10.0])

    def test_refuses_a_missing_map(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fields = gpd.GeoDataFrame(
                {"IMK_ID": [1]}, geometry=[box(0, 0, 100, 100)], crs="EPSG:25832"
            )
            gpkg_path, map_path = self.write_sources(directory, fields)
            map_path.with_suffix(".shp").unlink()

            with self.assertRaises(FileNotFoundError):
                load_udledningsgraenser(gpkg_path, map_path)


if __name__ == "__main__":
    unittest.main()
