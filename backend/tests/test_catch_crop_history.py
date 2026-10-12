"""Checks for the catch crop history columns in the merged GeoPackage."""

import io
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from pyogrio import read_dataframe, write_dataframe
from shapely import box

from database.scripts.load_catch_crop_history import (
    KINDS,
    YEARS,
    covered_share,
    load_catch_crop_history,
)
from database.scripts.merged_gpkg import LAYER

FIELD = box(0, 0, 100, 100)


class CoveredShareTests(unittest.TestCase):
    def share(self, *polygons: object) -> float:
        return covered_share(np.array([FIELD]), np.array(polygons))[0]

    def test_adds_up_adjacent_catch_crop_fields(self) -> None:
        self.assertAlmostEqual(self.share(box(0, 0, 100, 60), box(0, 60, 100, 95)), 0.95)

    def test_counts_overlapping_catch_crop_fields_once(self) -> None:
        # The same field twice, as when it is listed as both mandatory and targeted.
        self.assertAlmostEqual(self.share(box(0, 0, 100, 85), box(0, 0, 100, 85)), 0.85)

    def test_is_zero_without_catch_crop_fields(self) -> None:
        self.assertEqual(self.share(box(500, 500, 600, 600)), 0.0)


class GeoPackageUpdateTests(unittest.TestCase):
    def test_marks_each_year_with_catch_crops_covering_90_percent(self) -> None:
        coverage_by_year = dict(
            zip(YEARS, (box(0, 0, 100, 95), box(0, 0, 100, 85), None), strict=True)
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gpkg_path = root / "fields.gpkg"
            write_dataframe(
                gpd.GeoDataFrame({"IMK_ID": [1]}, geometry=[FIELD], crs="EPSG:25832"),
                gpkg_path,
                layer=LAYER,
            )
            zip_path = root / "Efterafgrøder test.zip"
            with zipfile.ZipFile(zip_path, "w") as outer:
                for kind in KINDS:
                    for year in YEARS:
                        name = f"{kind} efterafgrøder {year}"
                        polygon = coverage_by_year[year] if kind == KINDS[0] else None
                        shapefile_dir = root / name
                        shapefile_dir.mkdir()
                        write_dataframe(
                            gpd.GeoDataFrame(
                                geometry=[polygon or box(900, 900, 950, 950)], crs="EPSG:25832"
                            ),
                            shapefile_dir / f"{name}.shp",
                        )
                        inner = io.BytesIO()
                        with zipfile.ZipFile(inner, "w") as inner_zip:
                            for part in shapefile_dir.iterdir():
                                inner_zip.write(part, part.name)
                        outer.writestr(f"{zip_path.stem}/{name}.zip", inner.getvalue())

            with redirect_stdout(io.StringIO()):
                load_catch_crop_history(gpkg_path, zip_path)

            updated = read_dataframe(str(gpkg_path), layer=LAYER)
            values = [updated[f"SekAfg{year}"].tolist()[0] for year in YEARS]
            self.assertEqual(values[0], 968)
            self.assertTrue(pd.isna(values[1]) and pd.isna(values[2]))


if __name__ == "__main__":
    unittest.main()
