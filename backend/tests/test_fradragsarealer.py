"""Checks for the fradragsareal (PUMR 2027 requirements spec, table A, field A4)."""

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import geopandas as gpd
import numpy as np
from pyogrio import read_dataframe, write_dataframe
from shapely import box

from database.scripts.load_fradragsarealer import (
    DEDUCTION_COLUMN,
    deduction_area_ha,
    load_fradragsarealer,
    union_area,
)
from database.scripts.merged_gpkg import LAYER

# 100 m², 100 m² (25 m² of it shared with the first) and 100 m² inside the field below.
OVERLAPPING_PAIR = [box(0, 0, 10, 10), box(5, 5, 15, 15)]
EDGE_POLYGON = box(90, 90, 120, 120)


class UnionAreaTests(unittest.TestCase):
    def test_counts_parts_that_overlap_once(self) -> None:
        index = np.array([0, 0, 1])
        parts = np.array([*OVERLAPPING_PAIR, box(0, 0, 4, 4)])

        area = union_area(index, parts, 3)

        np.testing.assert_allclose(area, [175.0, 16.0, 0.0])

    def test_ignores_parts_without_area(self) -> None:
        index = np.array([0, 0])
        parts = np.array([box(0, 0, 10, 10).boundary, box(20, 0, 20, 5)])

        np.testing.assert_array_equal(union_area(index, parts, 1), [0.0])

    def test_gives_zero_without_any_parts(self) -> None:
        area = union_area(np.empty(0, dtype=np.intp), np.empty(0, dtype=object), 2)

        np.testing.assert_array_equal(area, [0.0, 0.0])


class DeductionAreaTests(unittest.TestCase):
    polygons = np.array([*OVERLAPPING_PAIR, EDGE_POLYGON])

    def test_adds_the_polygons_inside_the_field_and_counts_an_overlap_once(self) -> None:
        fields = np.array([box(0, 0, 100, 100)])

        area = deduction_area_ha(fields, self.polygons)

        # 175 m² for the pair and 100 m² of the edge polygon; 0.03 ha if the overlap counted twice.
        np.testing.assert_array_equal(area, [0.0275])

    def test_gives_zero_for_a_field_that_overlaps_nothing_or_only_touches(self) -> None:
        fields = np.array([box(500, 500, 600, 600), box(120, 90, 200, 200)])

        area = deduction_area_ha(fields, self.polygons)

        np.testing.assert_array_equal(area, [0.0, 0.0])

    def test_rounds_to_whole_square_metres(self) -> None:
        fields = np.array([box(0, 0, 100, 100)])
        polygons = np.array([box(0, 0, 10, 33.33333)])

        # 333.333 m² is 0.0333333 ha.
        np.testing.assert_array_equal(deduction_area_ha(fields, polygons), [0.0333])

    def test_does_not_depend_on_the_chunk_size(self) -> None:
        fields = np.array([box(0, 0, 100, 100), box(500, 500, 600, 600), box(100, 0, 200, 100)])

        one_by_one = deduction_area_ha(fields, self.polygons, chunk_size=1)

        np.testing.assert_array_equal(one_by_one, deduction_area_ha(fields, self.polygons))
        # The third field holds 20 m x 10 m of the edge polygon.
        np.testing.assert_array_equal(one_by_one, [0.0275, 0.0, 0.02])


class GeoPackageUpdateTests(unittest.TestCase):
    def write_layer(self, directory: Path, name: str, polygons: list) -> None:
        layer = gpd.GeoDataFrame(
            {"AREAL_HA": [0.0] * len(polygons)}, geometry=polygons, crs="EPSG:25832"
        )
        write_dataframe(layer, directory / f"{name}.shp")

    def test_overwrites_the_deduction_and_keeps_the_geometry(self) -> None:
        fields = gpd.GeoDataFrame(
            {"IMK_ID": [1, 2], DEDUCTION_COLUMN: [9.0, 9.0]},
            geometry=[box(0, 0, 100, 100), box(500, 500, 600, 600)],
            crs="EPSG:25832",
        )
        with tempfile.TemporaryDirectory() as directory:
            layers = Path(directory)
            gpkg_path = layers / "fields.gpkg"
            write_dataframe(fields, gpkg_path, layer=LAYER)
            self.write_layer(layers, "wells", OVERLAPPING_PAIR[:1])
            self.write_layer(layers, "strips", [OVERLAPPING_PAIR[1], EDGE_POLYGON])

            with redirect_stdout(io.StringIO()):
                load_fradragsarealer(gpkg_path, layers, ("wells", "strips"))

            updated = read_dataframe(str(gpkg_path), layer=LAYER)
            # A part on two layers counts once: 100 + 100 - 25 + 100 m².
            np.testing.assert_array_equal(updated[DEDUCTION_COLUMN], [0.0275, 0.0])
            self.assertTrue(updated.geometry.geom_equals(fields.geometry).all())

    def test_adds_the_column_to_a_geopackage_that_lacks_it(self) -> None:
        fields = gpd.GeoDataFrame({"IMK_ID": [1]}, geometry=[box(0, 0, 100, 100)], crs="EPSG:25832")
        with tempfile.TemporaryDirectory() as directory:
            layers = Path(directory)
            gpkg_path = layers / "fields.gpkg"
            write_dataframe(fields, gpkg_path, layer=LAYER)
            self.write_layer(layers, "wells", [EDGE_POLYGON])

            with redirect_stdout(io.StringIO()):
                load_fradragsarealer(gpkg_path, layers, ("wells",))

            updated = read_dataframe(str(gpkg_path), layer=LAYER)
            np.testing.assert_array_equal(updated[DEDUCTION_COLUMN], [0.01])

    def test_refuses_a_missing_layer(self) -> None:
        fields = gpd.GeoDataFrame({"IMK_ID": [1]}, geometry=[box(0, 0, 100, 100)], crs="EPSG:25832")
        with tempfile.TemporaryDirectory() as directory:
            layers = Path(directory)
            gpkg_path = layers / "fields.gpkg"
            write_dataframe(fields, gpkg_path, layer=LAYER)

            with redirect_stdout(io.StringIO()), self.assertRaises(FileNotFoundError):
                load_fradragsarealer(gpkg_path, layers, ("wells",))


if __name__ == "__main__":
    unittest.main()
