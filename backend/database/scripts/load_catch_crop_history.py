"""Add each field's catch crop history to the merged GeoPackage as a secondary
crop: one column per year, SekAfg<year>, holding crop code 968 ("Efterafgrøder,
pligtige, husdyr, målrettede") when the field had a catch crop that year and
NULL when not.

The source holds, per year, the field map of the fields that had mandatory or
targeted catch crops, without a crop code for the catch crop itself. The
source has no markblok, so its fields are matched to the GeoPackage's fields
geometrically: a field had a catch crop when catch crop fields cover at least
COVERED_SHARE of it. Catch crop fields that overlap each other count once.

Run it whenever the GeoPackage or the catch crop data is replaced.

Source: Efterafgrøder 2024-2026.zip, which holds one zipped shapefile per kind
(mandatory, targeted) and year (EPSG:25832).
"""

import time
from pathlib import Path

import numpy as np
import pandas as pd
import shapely
from pyogrio import read_dataframe

from database.scripts.merged_gpkg import (
    LAYER,
    MERGED_GPKG,
    RAW_DIR,
    add_columns,
    format_duration,
    write_columns,
)

SOURCE_ZIP = (
    RAW_DIR
    / "ANGJ-data"
    / "Marker 24-25-25"
    / "Efterafgrøde_historik"
    / "Efterafgrøder 2024-2026.zip"
)
YEARS = (2024, 2025, 2026)
# The source's file name prefix per kind: mandatory and targeted catch crops.
KINDS = ("Pligtige", "Målrettede")
CATCH_CROP_CODE = 968
COVERED_SHARE = 0.9


def source_path(zip_path: Path, kind: str, year: int) -> str:
    """GDAL path to one shapefile inside the zip inside the source zip."""
    name = f"{kind} efterafgrøder {year}"
    inner = f"/vsizip/{zip_path.as_posix()}/{zip_path.stem}/{name}.zip"
    return f"/vsizip/{{{inner}}}/{name}.shp"


def covered_share(fields: np.ndarray, polygons: np.ndarray) -> np.ndarray:
    """Return the share of each field the polygons cover, counting area where
    polygons overlap each other once."""
    field_index, polygon_index = shapely.STRtree(polygons).query(fields, predicate="intersects")
    if len(field_index) == 0:
        return np.zeros(len(fields))
    order = np.argsort(field_index, kind="stable")
    field_index = field_index[order]
    pieces = shapely.intersection(fields[field_index], polygons[polygon_index[order]])
    first = np.flatnonzero(np.r_[True, np.diff(field_index) != 0])
    covered = np.zeros(len(fields))
    covered[field_index[first]] = [
        shapely.area(shapely.union_all(group) if len(group) > 1 else group[0])
        for group in np.split(pieces, first[1:])
    ]
    with np.errstate(divide="ignore", invalid="ignore"):
        return covered / shapely.area(fields)


def read_year(zip_path: Path, year: int, crs: object) -> np.ndarray:
    frames = [
        read_dataframe(source_path(zip_path, kind, year), columns=[]).to_crs(crs) for kind in KINDS
    ]
    return pd.concat(frames, ignore_index=True).geometry.to_numpy()


def load_catch_crop_history(gpkg_path: Path = MERGED_GPKG, zip_path: Path = SOURCE_ZIP) -> None:
    for path in (gpkg_path, zip_path):
        if not path.exists():
            raise FileNotFoundError(f"Expected {path}")

    print(f"Reading fields from {gpkg_path.name}...", flush=True)
    fields = read_dataframe(str(gpkg_path), layer=LAYER, columns=[], fid_as_index=True)
    geometries = fields.geometry.to_numpy()

    updates: dict[str, np.ndarray] = {}
    for year in YEARS:
        start = time.monotonic()
        polygons = read_year(zip_path, year, fields.crs)
        has = covered_share(geometries, polygons) >= COVERED_SHARE
        updates[f"SekAfg{year}"] = np.where(has, CATCH_CROP_CODE, None)
        print(
            f"  {year}: {len(polygons):,} catch crop fields -> {np.count_nonzero(has):,} fields "
            f"in {format_duration(time.monotonic() - start)}",
            flush=True,
        )

    add_columns(gpkg_path, dict.fromkeys(updates, "INTEGER"))
    write_columns(gpkg_path, fields.index.to_numpy(), updates)
    print(f"Updated {len(updates)} columns for {len(fields):,} features in {gpkg_path.name}")


if __name__ == "__main__":
    load_catch_crop_history()
