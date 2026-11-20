"""Checks for the PUMR 2027 retention overlap (requirements spec, field A22)."""

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
from pyogrio import read_dataframe, write_dataframe
from shapely import box

from database.scripts.load_retentionskort import (
    RETENTION_COLUMN,
    area_weighted_retention,
    load_retentionskort,
    spatial_groups,
)
from database.scripts.merged_gpkg import LAYER, gpkg_is_empty

MAP_VALUES = np.array([20.0, 60.0])
MAP_POLYGONS = np.array([box(0, 0, 100, 100), box(100, 0, 200, 100)])
# The MiljøGIS layer gives retention as a fraction, not as a percentage.
MAP_FRACTIONS = [0.2, 0.6]


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


# Five small fields in each corner of a 100 km square, in an order that mixes the corners.
CORNERS = [(0, 0), (100_000, 100_000), (100_000, 0), (0, 100_000)]
CORNER_FIELDS = np.array(
    [
        box(x + 10 * step, y + 10 * step, x + 10 * step + 5, y + 10 * step + 5)
        for step in range(5)
        for x, y in CORNERS
    ]
)


class SpatialGroupsTests(unittest.TestCase):
    fields = CORNER_FIELDS

    def test_puts_every_field_in_exactly_one_group_of_at_most_the_given_size(self) -> None:
        groups = spatial_groups(self.fields, 6)

        self.assertTrue(all(len(group) <= 6 for group in groups))
        np.testing.assert_array_equal(np.sort(np.concatenate(groups)), np.arange(len(self.fields)))

    def test_keeps_the_fields_of_a_group_close_together(self) -> None:
        groups = spatial_groups(self.fields, 5)

        self.assertEqual(len(groups), 4)
        for group in groups:
            west, south, east, north = shapely.total_bounds(self.fields[group])
            self.assertLess(east - west, 1_000)
            self.assertLess(north - south, 1_000)

    def test_gives_no_groups_without_fields(self) -> None:
        self.assertEqual(spatial_groups(np.empty(0, dtype=object), 5), [])

    def test_keeps_empty_geometries_in_a_group(self) -> None:
        fields = np.array([box(0, 0, 5, 5), shapely.Polygon(), box(50, 50, 55, 55)])

        groups = spatial_groups(fields, 2)

        np.testing.assert_array_equal(np.sort(np.concatenate(groups)), [0, 1, 2])


class GeoPackageUpdateTests(unittest.TestCase):
    def write_fields(self, directory: Path, geometries: list, rettot: list[float]) -> Path:
        gpkg_path = directory / "fields.gpkg"
        fields = gpd.GeoDataFrame(
            {"IMK_ID": list(range(1, len(geometries) + 1)), "RetTot": rettot},
            geometry=geometries,
            crs="EPSG:25832",
        )
        write_dataframe(fields, gpkg_path, layer=LAYER)
        return gpkg_path

    def write_map(
        self,
        directory: Path,
        values: list[float | None],
        polygons: np.ndarray,
        *,
        column: str = RETENTION_COLUMN,
        crs: str = "EPSG:25832",
    ) -> Path:
        map_path = directory / "retention.gpkg"
        retention_map = gpd.GeoDataFrame({column: values}, geometry=list(polygons), crs=crs)
        write_dataframe(retention_map, map_path, layer="kvaelstofretention")
        return map_path

    def test_overwrites_rettot_in_percent_from_the_fraction_and_keeps_the_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            geometries = [box(50, 0, 200, 100), box(500, 500, 600, 600)]
            gpkg_path = self.write_fields(Path(directory), geometries, [31.598, 75.0])
            map_path = self.write_map(Path(directory), MAP_FRACTIONS, MAP_POLYGONS)

            with redirect_stdout(io.StringIO()):
                load_retentionskort(gpkg_path, map_path)

            updated = read_dataframe(str(gpkg_path), layer=LAYER)
            np.testing.assert_array_equal(updated["RetTot"], [46.67, np.nan])
            expected = gpd.GeoSeries(geometries, crs="EPSG:25832")
            self.assertTrue(updated.geometry.geom_equals(expected).all())

    def test_does_not_depend_on_how_the_fields_are_grouped(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            # The first field lies on both polygons, the last one on the second only.
            geometries = [box(50, 0, 200, 100), box(500, 500, 600, 600), box(100, 0, 150, 100)]
            gpkg_path = self.write_fields(Path(directory), geometries, [0.0, 0.0, 0.0])
            map_path = self.write_map(Path(directory), MAP_FRACTIONS, MAP_POLYGONS)

            for group_size in (1, 2, 50_000):
                with self.subTest(group_size=group_size), redirect_stdout(io.StringIO()):
                    load_retentionskort(gpkg_path, map_path, group_size)

                    updated = read_dataframe(str(gpkg_path), layer=LAYER)
                    np.testing.assert_array_equal(updated["RetTot"], [46.67, np.nan, 60.0])

    def test_averages_over_the_polygons_that_have_a_retention(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            gpkg_path = self.write_fields(Path(directory), [box(50, 0, 200, 100)], [0.0])
            map_path = self.write_map(Path(directory), [0.2, None], MAP_POLYGONS)

            with redirect_stdout(io.StringIO()):
                load_retentionskort(gpkg_path, map_path)

            updated = read_dataframe(str(gpkg_path), layer=LAYER)
            np.testing.assert_array_equal(updated["RetTot"], [20.0])

    def test_refuses_a_map_without_the_retention_fraction(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            gpkg_path = self.write_fields(Path(directory), [box(50, 0, 200, 100)], [0.0])
            map_path = self.write_map(Path(directory), MAP_VALUES, MAP_POLYGONS, column="RetTot")

            with redirect_stdout(io.StringIO()), self.assertRaisesRegex(ValueError, "ret_tot"):
                load_retentionskort(gpkg_path, map_path)

    def test_refuses_a_map_in_another_crs_than_the_fields(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            gpkg_path = self.write_fields(Path(directory), [box(50, 0, 200, 100)], [0.0])
            map_path = self.write_map(
                Path(directory), [0.2], np.array([box(9, 55, 10, 56)]), crs="EPSG:4326"
            )

            with redirect_stdout(io.StringIO()), self.assertRaisesRegex(ValueError, "EPSG:25832"):
                load_retentionskort(gpkg_path, map_path)

    def test_refuses_a_missing_map(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            gpkg_path = self.write_fields(Path(directory), [box(50, 0, 200, 100)], [0.0])

            with redirect_stdout(io.StringIO()), self.assertRaises(FileNotFoundError):
                load_retentionskort(gpkg_path, Path(directory) / "missing.gpkg")


class GpkgIsEmptyTests(unittest.TestCase):
    def test_reads_the_empty_flag_from_the_blob_header(self) -> None:
        self.assertEqual(gpkg_is_empty(b"GP\x00\x11"), 1)
        self.assertEqual(gpkg_is_empty(b"GP\x00\x03"), 0)
        self.assertIsNone(gpkg_is_empty(None))


if __name__ == "__main__":
    unittest.main()
