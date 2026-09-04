"""Compute each registry field's retention (%) as a real pixel-weighted
zonal mean from the national retention raster, replacing the old
RedTot_pct-from-gpkg source.

Method: rasterize every field polygon into a single zone-id raster aligned
with the source grid (burn value = imk_id), then average the source raster's
pixel values per zone with a vectorised numpy bincount — equivalent to a
standard GIS zonal-mean (each 100m pixel counted once, for whichever field
its center falls in), not a sub-pixel fractional-coverage weighting (which
would need a much finer resample to approximate and isn't a real precision
gain over a 100m-resolution source anyway).

Source: TotalRetention_regioner_v260327.tif (EPSG:25832, 100m grid, float32
percent 0-100, nodata sentinel ~-3.4e38).
"""

import time
from pathlib import Path

import geopandas as gpd
import numpy as np
import psycopg
import rasterio
import rasterio.features
from dotenv import load_dotenv
from shapely import wkb

from app.data.db import DATABASE_URL

ROOT = Path(__file__).resolve().parents[1]
RASTER_PATH = (
    ROOT
    / "data"
    / "raw"
    / "ANGJ-data"
    / "Marker 24-25-25"
    / "Retentionskort"
    / "TotalRetention_regioner_v260327.tif"
)


def format_duration(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def fetch_fields(dsn: str) -> gpd.GeoDataFrame:
    print("Fetching registry field geometries...", flush=True)
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT imk_id, ST_AsBinary(ST_Transform(geom, 25832)) FROM registry_field"
            )
            rows = cursor.fetchall()

    imk_ids = np.array([row[0] for row in rows], dtype=np.int64)
    geometries = [wkb.loads(bytes(row[1])) for row in rows]
    print(f"  fetched {len(imk_ids):,} fields", flush=True)
    return gpd.GeoDataFrame({"imk_id": imk_ids, "geometry": geometries}, crs="EPSG:25832")


def compute_zonal_means(fields: gpd.GeoDataFrame) -> dict[int, float]:
    print(f"Rasterizing {len(fields):,} field zones against the retention grid...", flush=True)
    start = time.monotonic()

    with rasterio.open(RASTER_PATH) as src:
        data = src.read(1, masked=True)
        transform = src.transform
        out_shape = src.shape

        zones = rasterio.features.rasterize(
            zip(fields.geometry, fields["imk_id"], strict=True),
            out_shape=out_shape,
            transform=transform,
            fill=0,
            dtype="float64",
        ).astype(np.int64)

    valid = (zones > 0) & (~data.mask)
    max_id = int(zones.max()) if valid.any() else 0
    sums = np.bincount(zones[valid], weights=data.data[valid], minlength=max_id + 1)
    counts = np.bincount(zones[valid], minlength=max_id + 1)

    means: dict[int, float] = {}
    for imk_id in fields["imk_id"]:
        imk_id = int(imk_id)
        if imk_id <= max_id and counts[imk_id] > 0:
            means[imk_id] = float(sums[imk_id] / counts[imk_id])

    elapsed = time.monotonic() - start
    print(
        f"  computed retention for {len(means):,} / {len(fields):,} fields "
        f"in {format_duration(elapsed)} ({len(fields) - len(means):,} had no raster coverage)",
        flush=True,
    )
    return means


def write_retention(dsn: str, means: dict[int, float]) -> None:
    print("Writing retention back to registry_field...", flush=True)
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute("DROP TABLE IF EXISTS retentionskort_result")
            cursor.execute(
                """CREATE TABLE retentionskort_result (
                    imk_id bigint PRIMARY KEY, retention double precision
                )"""
            )
            with cursor.copy(
                "COPY retentionskort_result (imk_id, retention) FROM STDIN WITH (FORMAT CSV)"
            ) as copy:
                for imk_id, retention in means.items():
                    copy.write(f"{imk_id},{retention}\n")
            cursor.execute(
                """
                UPDATE registry_field rf
                SET retention = r.retention
                FROM retentionskort_result r
                WHERE rf.imk_id = r.imk_id
                """
            )
            updated = cursor.rowcount
            cursor.execute("DROP TABLE retentionskort_result")
        connection.commit()
    print(f"Updated {updated:,} registry fields", flush=True)


def fill_missing_from_nearest(dsn: str) -> None:
    """Fields too small to catch a raster pixel center (91% of the gaps are
    under 1 ha, smaller than the 100m grid) get their nearest already-resolved
    field's retention value instead — retention varies smoothly over the
    landscape, so a neighbour a few dozen metres away is a fine stand-in."""
    print("Filling remaining gaps from the nearest resolved field...", flush=True)
    start = time.monotonic()
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE registry_field AS target
                SET retention = (
                    SELECT r.retention
                    FROM registry_field r
                    WHERE r.retention IS NOT NULL
                    ORDER BY r.centroid <-> target.centroid
                    LIMIT 1
                )
                WHERE target.retention IS NULL
                """
            )
            filled = cursor.rowcount
        connection.commit()
    print(f"  filled {filled:,} fields in {format_duration(time.monotonic() - start)}", flush=True)


def load_retentionskort() -> None:
    if not RASTER_PATH.exists():
        raise FileNotFoundError(f"Expected {RASTER_PATH}")

    load_dotenv(ROOT.parent / ".env")
    dsn = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    fields = fetch_fields(dsn)
    means = compute_zonal_means(fields)
    write_retention(dsn, means)
    fill_missing_from_nearest(dsn)


if __name__ == "__main__":
    load_retentionskort()
