"""Checks for the per-field NT, P and S the draft 2027 executive order prescribes."""

import io
import math
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import geopandas as gpd
import numpy as np
from database.scripts.load_nles5_soil_inputs import (
    N_COLUMN,
    P_COLUMNS,
    S_COLUMN,
    dominant_values,
    load_nles5_soil_inputs,
    soil_effect,
)
from database.scripts.merged_gpkg import LAYER
from pyogrio import read_dataframe, write_dataframe
from shapely import box

# Two polygons with data side by side, then one without data (0).
MAP_POLYGONS = np.array([box(0, 0, 100, 100), box(100, 0, 200, 100), box(200, 0, 300, 100)])
N_VALUES = np.array([5.0, 7.0, 0.0])


class DominantValueTests(unittest.TestCase):
    def dominant_n(self, *fields: object) -> np.ndarray:
        return dominant_values(np.array(fields), {"N": N_VALUES}, MAP_POLYGONS)["N"]

    def test_takes_the_value_covering_the_largest_part(self) -> None:
        # 5,000 m² at 5 and 10,000 m² at 7.
        np.testing.assert_array_equal(self.dominant_n(box(50, 0, 200, 100)), [7.0])

    def test_breaks_a_tie_towards_the_higher_value(self) -> None:
        np.testing.assert_array_equal(self.dominant_n(box(0, 0, 200, 100)), [7.0])

    def test_takes_the_value_of_the_part_with_data(self) -> None:
        # 5,000 m² at 7 and 10,000 m² without data.
        np.testing.assert_array_equal(self.dominant_n(box(150, 0, 300, 100)), [7.0])

    def test_leaves_a_field_without_data_unresolved(self) -> None:
        fields = (box(200, 0, 300, 100), box(500, 500, 600, 600))

        np.testing.assert_array_equal(self.dominant_n(*fields), [np.nan, np.nan])

    def test_sums_the_polygons_that_share_a_value(self) -> None:
        polygons = np.array([box(0, 0, 60, 100), box(60, 0, 90, 100), box(90, 0, 130, 100)])

        # The largest polygon holds 5 (6,000 m²), but 7 covers 3,000 + 4,000 m².
        result = dominant_values(
            np.array([box(0, 0, 130, 100)]), {"N": np.array([5.0, 7.0, 7.0])}, polygons
        )

        np.testing.assert_array_equal(result["N"], [7.0])


class SoilEffectTests(unittest.TestCase):
    def test_uses_the_clay_percentage_of_bilag_2_table_14(self) -> None:
        np.testing.assert_allclose(
            soil_effect(np.array([1.0, 8.0, 11.0])),
            [math.exp(-0.001849 * 5), math.exp(-0.001849 * 27), math.exp(-0.001849 * 9)],
        )

    def test_refuses_a_soil_type_outside_the_table(self) -> None:
        for codes in ([9.0], [np.nan]):
            with self.subTest(codes=codes), self.assertRaises(ValueError):
                soil_effect(np.array(codes))


class GeoPackageUpdateTests(unittest.TestCase):
    def test_writes_nt_p_and_s_for_every_field(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            gpkg_path = Path(directory) / "fields.gpkg"
            n_path = Path(directory) / "n.shp"
            p_path = Path(directory) / "p.shp"
            old_inputs = {N_COLUMN: 6.4, **dict.fromkeys(P_COLUMNS.values(), 0.25), S_COLUMN: 0.97}
            write_dataframe(
                gpd.GeoDataFrame(
                    {"JB_Kode": [4.0, 1.0], **{k: [v, v] for k, v in old_inputs.items()}},
                    geometry=[box(50, 0, 200, 100), box(200, 0, 300, 100)],
                    crs="EPSG:25832",
                ),
                gpkg_path,
                layer=LAYER,
            )
            write_dataframe(
                gpd.GeoDataFrame({"N_vaerdi": N_VALUES}, geometry=MAP_POLYGONS, crs="EPSG:25832"),
                n_path,
            )
            p_values = {
                column: [0.1 + k / 100, 0.2 + k / 100, 0.0] for k, column in enumerate(P_COLUMNS)
            }
            write_dataframe(
                gpd.GeoDataFrame(p_values, geometry=MAP_POLYGONS, crs="EPSG:25832"), p_path
            )

            with redirect_stdout(io.StringIO()):
                load_nles5_soil_inputs(gpkg_path, n_path, p_path)

            updated = read_dataframe(str(gpkg_path), layer=LAYER)
            np.testing.assert_array_equal(updated[N_COLUMN], [7.0, np.nan])
            for k, column in enumerate(P_COLUMNS.values()):
                np.testing.assert_allclose(updated[column], [0.2 + k / 100, np.nan])
            np.testing.assert_allclose(
                updated[S_COLUMN], [math.exp(-0.001849 * 7), math.exp(-0.001849 * 5)]
            )


if __name__ == "__main__":
    unittest.main()
