"""Load three national polygon layers and set the corresponding registry_field
flags via simple "does it touch" / "max score among what touches" overlays —
no area-weighting needed here, per the confirmed rule for oestoette ("bare
røre... for at få værdien 1"), applied identically to oeko:

  - oeko: true if the field touches any Oekologiske Arealer polygon.
  - oestoette: true if the field touches any O-stoette polygon.
  - hoejeste_hnv: MAX(HNVscore) among all HNV_5_13_2025 polygons touching the
    field (HNVscore ranges 5-13 in the source layer).

Sources (all in "Marker 24-25-25", EPSG:25832):
  Økologiske Arealer/Oekologiske_arealer_2025.shp (82,973 polygons)
  Ø-støtte/O_Stotte.shp (90 polygons)
  HNV_5_13_2025/HNV_5_13_2025.shp (1,254,766 polygons, column "HNVscore")
"""

import csv
import time
from io import StringIO
from pathlib import Path

import geopandas as gpd
import psycopg
from dotenv import load_dotenv
from pyogrio import read_dataframe, read_info
from shapely.geometry import MultiPolygon, Polygon

from app.data.db import DATABASE_URL

ROOT = Path(__file__).resolve().parents[1]
MARKER_DIR = ROOT / "data" / "raw" / "ANGJ-data" / "Marker 24-25-25"
OEKO_PATH = MARKER_DIR / "Økologiske Arealer" / "Oekologiske_arealer_2025.shp"
OESTOETTE_PATH = MARKER_DIR / "Ø-støtte" / "O_Stotte.shp"
HNV_PATH = MARKER_DIR / "HNV_5_13_2025" / "HNV_5_13_2025.shp"
BATCH_SIZE = 50_000


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
    output = StringIO()
    csv.writer(output).writerow(row)
    return output.getvalue()


def _load_polygons_staging(
    dsn: str,
    table: str,
    path: Path,
    extra_columns: dict[str, str] | None = None,
    source_columns: list[str] | None = None,
) -> None:
    """Load a polygon layer into `table (geom [, extra columns])`."""
    extra_columns = extra_columns or {}
    source_columns = source_columns or []
    feature_count = read_info(str(path))["features"]
    print(f"Loading {feature_count:,} polygons from {path.name} into {table}", flush=True)

    column_defs = ", ".join(f"{name} {sql_type}" for name, sql_type in extra_columns.items())
    insert_columns = ", ".join([*extra_columns, "geom"])

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {table}")
            cursor.execute(
                f"""
                CREATE TABLE {table} (
                    {column_defs + "," if column_defs else ""}
                    geom geometry(MULTIPOLYGON, 4326) NOT NULL
                )
                """
            )
            with cursor.copy(
                f"COPY {table} ({insert_columns}) FROM STDIN WITH (FORMAT CSV)"
            ) as copy:
                loaded = 0
                offset = 0
                start = time.monotonic()
                while offset < feature_count:
                    frame = read_dataframe(
                        str(path),
                        columns=source_columns,
                        skip_features=offset,
                        max_features=BATCH_SIZE,
                    )
                    if frame.empty:
                        break
                    frame = gpd.GeoDataFrame(frame, geometry="geometry", crs=frame.crs).to_crs(4326)
                    for row in frame.itertuples(index=False):
                        if row.geometry is None:
                            continue
                        values = tuple(getattr(row, col) for col in source_columns)
                        copy.write(
                            csv_line((*values, f"SRID=4326;{to_multipolygon_wkt(row.geometry)}"))
                        )
                        loaded += 1
                    offset += BATCH_SIZE
                    elapsed = time.monotonic() - start
                    print(
                        f"  read {min(offset, feature_count):,} / {feature_count:,}, "
                        f"elapsed {format_duration(elapsed)}",
                        flush=True,
                    )
            print(f"Loaded {loaded:,} rows, repairing invalid geometries...", flush=True)
            cursor.execute(
                f"""UPDATE {table}
                    SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
                    WHERE NOT ST_IsValid(geom)"""
            )
            print(f"  repaired {cursor.rowcount:,} rows, building spatial index...", flush=True)
            cursor.execute(f"CREATE INDEX ix_{table}_geom ON {table} USING gist (geom)")
            cursor.execute(f"ANALYZE {table}")
        connection.commit()


def set_touch_flag(dsn: str, table: str, column: str) -> None:
    print(f"Setting {column} where a field touches {table}...", flush=True)
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                UPDATE registry_field rf
                SET {column} = true
                WHERE EXISTS (
                    SELECT 1 FROM {table} s WHERE ST_Intersects(rf.geom, s.geom)
                )
                """
            )
            print(f"  set {column} = true on {cursor.rowcount:,} fields", flush=True)
        connection.commit()


def set_max_hnv(dsn: str, table: str) -> None:
    print("Setting hoejeste_hnv to the max touching HNVscore...", flush=True)
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                WITH scores AS (
                    SELECT rf.imk_id, MAX(s.hnvscore) AS max_hnv
                    FROM registry_field rf
                    JOIN {table} s ON ST_Intersects(rf.geom, s.geom)
                    GROUP BY rf.imk_id
                )
                UPDATE registry_field rf
                SET hoejeste_hnv = scores.max_hnv
                FROM scores
                WHERE rf.imk_id = scores.imk_id
                """
            )
            print(f"  updated {cursor.rowcount:,} fields", flush=True)
        connection.commit()


def drop_staging_tables(dsn: str, tables: list[str]) -> None:
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            for table in tables:
                cursor.execute(f"DROP TABLE IF EXISTS {table}")
        connection.commit()


def load_oekologi_hnv(*, keep_staging: bool = False) -> None:
    for path in (OEKO_PATH, OESTOETTE_PATH, HNV_PATH):
        if not path.exists():
            raise FileNotFoundError(f"Expected {path}")

    load_dotenv(ROOT.parent / ".env")
    dsn = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    _load_polygons_staging(dsn, "oekologiske_arealer_load", OEKO_PATH)
    set_touch_flag(dsn, "oekologiske_arealer_load", "oeko")

    _load_polygons_staging(dsn, "oestoette_load", OESTOETTE_PATH)
    set_touch_flag(dsn, "oestoette_load", "oestoette")

    _load_polygons_staging(
        dsn,
        "hnv_load",
        HNV_PATH,
        extra_columns={"hnvscore": "smallint"},
        source_columns=["HNVscore"],
    )
    set_max_hnv(dsn, "hnv_load")

    if not keep_staging:
        drop_staging_tables(dsn, ["oekologiske_arealer_load", "oestoette_load", "hnv_load"])


if __name__ == "__main__":
    load_oekologi_hnv()
