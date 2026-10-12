"""Shared helpers for the scripts that set per-field map values in the merged
GeoPackage before `pixi run load-registry-data` loads it."""

import math
import sqlite3
from contextlib import closing
from pathlib import Path

import numpy as np
import pandas as pd
import shapely

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
MERGED_GPKG = RAW_DIR / "V1_1_IMK2026_n604144_gpkg_merged.gpkg"
LAYER = "PlantPerform"


def format_duration(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def overlaps(
    fields: np.ndarray, map_polygons: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (field index, map polygon index, overlap area) for every field
    and map polygon that share area."""
    field_index, map_index = shapely.STRtree(map_polygons).query(fields, predicate="intersects")
    area = shapely.area(shapely.intersection(fields[field_index], map_polygons[map_index]))
    shared = area > 0
    return field_index[shared], map_index[shared], area[shared]


def area_weighted(
    field_index: np.ndarray, values: np.ndarray, area: np.ndarray, size: int
) -> np.ndarray:
    """Return each field's overlap-area-weighted mean value; NaN for a field
    without overlap. The weights are the overlaps only, so a field partly
    outside the map is averaged over the part that has a value."""
    weighted = np.bincount(field_index, weights=area * values, minlength=size)
    covered = np.bincount(field_index, weights=area, minlength=size)
    means = np.full(size, np.nan)
    np.divide(weighted, covered, out=means, where=covered > 0)
    return means


def dominant(
    field_index: np.ndarray, values: np.ndarray, area: np.ndarray, size: int
) -> np.ndarray:
    """Return each field's value that covers the largest part of it, summing
    the overlaps of all polygons with that value. A tie goes to the higher
    value. NaN values count as no value; a field without any value gets NaN."""
    valued = ~np.isnan(values)
    parts = pd.DataFrame(
        {"field": field_index[valued], "value": values[valued], "area": area[valued]}
    )
    per_value = parts.groupby(["field", "value"], as_index=False)["area"].sum()
    winners = per_value.sort_values(["area", "value"]).drop_duplicates("field", keep="last")
    result = np.full(size, np.nan)
    result[winners["field"].to_numpy()] = winners["value"].to_numpy()
    return result


def gpkg_is_empty(blob: bytes | None) -> int | None:
    """ST_IsEmpty for a GeoPackage geometry blob: the empty flag is bit 4 of
    the header's flags byte."""
    return None if blob is None else (blob[3] >> 4) & 1


def fid_change_only(_blob: bytes | None) -> float:
    raise sqlite3.NotSupportedError("only needed when a feature's fid changes")


def sql_value(value: object) -> object:
    """Return a column value as SQLite takes it: None and NaN as NULL."""
    if isinstance(value, np.generic):
        value = value.item()
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return value


def write_columns(gpkg_path: Path, fids: np.ndarray, columns: dict[str, np.ndarray]) -> None:
    """Overwrite the given attribute columns for the given features, None and
    NaN as NULL. Geometry and spatial index stay as they are."""
    assignments = ", ".join(f'"{name}" = ?' for name in columns)
    with closing(sqlite3.connect(gpkg_path)) as connection, connection:
        # The layer's spatial-index triggers call GDAL functions that plain
        # SQLite lacks, and SQLite needs them to compile any UPDATE on the
        # layer. On an attribute update those triggers only fire when a fid
        # changes, which this UPDATE never does, so only ST_IsEmpty, from
        # their WHEN clause, is implemented.
        connection.create_function("ST_IsEmpty", 1, gpkg_is_empty, deterministic=True)
        for name in ("ST_MinX", "ST_MaxX", "ST_MinY", "ST_MaxY"):
            connection.create_function(name, 1, fid_change_only, deterministic=True)
        cursor = connection.executemany(
            f'UPDATE "{LAYER}" SET {assignments} WHERE fid = ?',
            (
                (*(sql_value(value) for value in row), int(fid))
                for fid, *row in zip(fids, *columns.values(), strict=True)
            ),
        )
        if cursor.rowcount != len(fids):
            raise RuntimeError(f"Updated {cursor.rowcount:,} features, expected {len(fids):,}")
