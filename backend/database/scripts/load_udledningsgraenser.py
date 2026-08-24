"""Load the national udledningsgraense (discharge-limit) polygon layer into a
staging table, then compute each registry field's area-weighted average
udledningsgraense (kg N/ha) via a real geometric overlay — not a centroid or
dominant-polygon lookup, since the limit genuinely varies within a single
kystvand catchment (confirmed: 25,892 distinct (catchment, value) pairs across
only 107 catchments in the source layer).

Source: Foreloebige_udledningsgraenser_til_Udledningsbaseret_Markregulering.shp
(EPSG:25832, ~2.8M polygon parts, column "Udledgr" = discharge limit kg N/ha).
"""

import time
from collections.abc import Iterator
from io import StringIO
from pathlib import Path

import geopandas as gpd
import pandas as pd
import psycopg
from dotenv import load_dotenv
from pyogrio import read_dataframe, read_info
from shapely.geometry import MultiPolygon, Polygon

from app.data.db import DATABASE_URL

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw" / "ANGJ-data" / "Udeledningsdata"
SHP_PATH = (
    RAW_DIR / "Foreloebige_udledningsgraenser_til_Udledningsbaseret_Markregulering.shp"
)
BATCH_SIZE = 50_000
STAGING_TABLE = "udledningsgraense_omrade_load"


def format_duration(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def to_multipolygon_wkt(geometry: Polygon | MultiPolygon) -> str:
    if isinstance(geometry, Polygon):
        geometry = MultiPolygon([geometry])
    return geometry.wkt


def csv_line(row: tuple[object, ...]) -> str:
    import csv

    output = StringIO()
    csv.writer(output).writerow(row)
    return output.getvalue()


def iter_staging_rows(feature_count: int) -> Iterator[tuple[object, ...]]:
    offset = 0
    start = time.monotonic()
    last_print = start

    while offset < feature_count:
        frame = read_dataframe(
            str(SHP_PATH),
            columns=["Udledgr"],
            skip_features=offset,
            max_features=BATCH_SIZE,
        )
        if frame.empty:
            break

        frame = gpd.GeoDataFrame(frame, geometry="geometry", crs=frame.crs).to_crs(4326)

        for row in frame.itertuples(index=False):
            if row.geometry is None or pd.isna(row.Udledgr):
                continue
            yield (float(row.Udledgr), to_multipolygon_wkt(row.geometry))

        offset += BATCH_SIZE
        now = time.monotonic()
        if now - last_print >= 5.0:
            last_print = now
            elapsed = now - start
            pct = offset / feature_count
            rate = offset / elapsed if elapsed > 0 else 0
            eta = format_duration((feature_count - offset) / rate) if rate > 0 else "--:--"
            print(
                f"Read {offset:,} / {feature_count:,} ({pct:.1%}), "
                f"elapsed {format_duration(elapsed)}, ETA {eta}",
                flush=True,
            )


def load_staging_table(dsn: str) -> None:
    feature_count = read_info(str(SHP_PATH))["features"]
    print(f"Loading {feature_count:,} udledningsgraense polygons into staging table", flush=True)

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {STAGING_TABLE}")
            cursor.execute(
                f"""
                CREATE TABLE {STAGING_TABLE} (
                    udledgr double precision NOT NULL,
                    geom geometry(MULTIPOLYGON, 4326) NOT NULL
                )
                """
            )
            with cursor.copy(
                f"COPY {STAGING_TABLE} (udledgr, geom) FROM STDIN WITH (FORMAT CSV)"
            ) as copy:
                loaded = 0
                for udledgr, geom_wkt in iter_staging_rows(feature_count):
                    copy.write(csv_line((udledgr, f"SRID=4326;{geom_wkt}")))
                    loaded += 1
            print(f"Loaded {loaded:,} rows, building spatial index...", flush=True)
            cursor.execute(
                f"CREATE INDEX ix_{STAGING_TABLE}_geom ON {STAGING_TABLE} "
                f"USING gist (geom)"
            )
            cursor.execute(f"ANALYZE {STAGING_TABLE}")
        connection.commit()


def compute_overlay(dsn: str) -> None:
    print("Computing area-weighted overlay onto registry_field...", flush=True)
    start = time.monotonic()

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                WITH parts AS (
                    SELECT
                        rf.imk_id,
                        ST_Area(
                            ST_Intersection(rf.geom, u.geom)::geography
                        ) AS overlap_area_m2,
                        u.udledgr AS value
                    FROM registry_field rf
                    JOIN {STAGING_TABLE} u ON ST_Intersects(rf.geom, u.geom)
                ),
                agg AS (
                    SELECT
                        imk_id,
                        SUM(overlap_area_m2 * value) / NULLIF(SUM(overlap_area_m2), 0)
                            AS weighted_avg_kgn_ha
                    FROM parts
                    WHERE overlap_area_m2 > 0
                    GROUP BY imk_id
                )
                UPDATE registry_field rf
                SET
                    udledningsgraense_kgn_ha = agg.weighted_avg_kgn_ha,
                    udledningskvote_mark_kgn = agg.weighted_avg_kgn_ha * rf.area_ha
                FROM agg
                WHERE rf.imk_id = agg.imk_id
                """
            )
            updated = cursor.rowcount
        connection.commit()

    elapsed = time.monotonic() - start
    print(f"Updated {updated:,} registry fields in {format_duration(elapsed)}", flush=True)


def drop_staging_table(dsn: str) -> None:
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {STAGING_TABLE}")
        connection.commit()


def load_udledningsgraenser(*, keep_staging: bool = False) -> None:
    if not SHP_PATH.exists():
        raise FileNotFoundError(f"Expected {SHP_PATH}")

    load_dotenv(ROOT.parent / ".env")
    dsn = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    load_staging_table(dsn)
    compute_overlay(dsn)
    if not keep_staging:
        drop_staging_table(dsn)


if __name__ == "__main__":
    load_udledningsgraenser()
