"""Load the 2026 field registry from the yearly Marker_2024/2025/2026
shapefiles (PlantPerform-native Afgkode — the correct codelist, unlike the
old IMK geopackage's AgCropNr), replacing load_registry.py as the source of
registry_field's base rows (geometry, cvr, marknr, crop_history).

Fresh imk_id assignment:
  There is no field-level id that is stable across the three yearly files —
  Marknr resets/renumbers within a Markblok year to year. So each 2026 field
  gets a new imk_id, EXCEPT: to avoid orphaning existing farms' saved fields
  (FieldRecord.imk_id references into the *current* registry_field), a 2026
  field whose geometry overlaps an existing registry_field row by >=50% of
  its own area inherits that row's imk_id. If several 2026 fields all claim
  the same old id (an old field got split), only the one with the largest
  overlap keeps it; the rest get fresh ids. Fields with no qualifying match
  get a fresh id counting up from MAX(existing imk_id).

crop_history assignment (per year):
  Primary: exact (Markblok, Marknr) match against that year's layer — cheap
  and precise (confirmed 76-86% direct-match rate 2026->2024/2025). Fallback
  for the rest: geometric dominant-overlap (the polygon from that year's
  layer covering the largest share of the 2026 field's area), for the
  ~15-25% of fields resubdivided/renumbered within their block.

  2026 rows with a null Afgkode (138 as of 2026-08-27) are backfilled from
  their already-resolved 2025 crop_history value.

registry_field.crop_rotation (the old Rot_vec-format text column, distinct
from crop_history) is set to "" here — confirmed unused by any live code
path (frontend or backend); crop_history is the real per-year data now.

jbnr / kystvand_id / retention / udledningsgraense*/ oeko / oestoette /
hoejeste_hnv are intentionally left at NULL/default here — they are filled
in by the separate load_jordbundskort.py / load_kystvandoplande.py /
load_retentionskort.py / load_udledningsgraenser.py / load_oekologi_hnv.py
scripts, run afterwards (kept separate: the polygon overlays involved are
heavy and independently rerunnable).
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
MARKER_PATH = {
    year: MARKER_DIR / f"Marker_{year}" / f"Marker_{year}.shp" for year in (2024, 2025, 2026)
}
BATCH_SIZE = 50_000
OVERLAP_MIN_FRACTION = 0.5

STG_BASE = "dataimk2026_base_load"
STG_YEAR = {2024: "dataimk2026_marker_2024", 2025: "dataimk2026_marker_2025"}


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


def clean_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def clean_afgkode(value: object) -> int | None:
    if value is None:
        return None
    try:
        if value != value:  # NaN
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


# --- Step 1: load the 2026 base layer (full attributes) into a staging table ---


def load_base_2026(dsn: str) -> None:
    path = str(MARKER_PATH[2026])
    feature_count = read_info(path)["features"]
    print(f"Loading {feature_count:,} 2026 fields into staging", flush=True)

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {STG_BASE}")
            cursor.execute(
                f"""
                CREATE TABLE {STG_BASE} (
                    load_seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    marknr text,
                    markblok text,
                    journalnr text,
                    cvr text,
                    area_ha double precision,
                    afgkode_2026 integer,
                    afgkode_2025 integer,
                    afgkode_2024 integer,
                    imk_id bigint,
                    geom geometry(MULTIPOLYGON, 4326) NOT NULL
                )
                """
            )
            with cursor.copy(
                f"""COPY {STG_BASE} (marknr, markblok, journalnr, cvr, area_ha, afgkode_2026, geom)
                    FROM STDIN WITH (FORMAT CSV)"""
            ) as copy:
                loaded = 0
                offset = 0
                start = time.monotonic()
                while offset < feature_count:
                    frame = read_dataframe(
                        path,
                        columns=["Marknr", "Markblok", "Journalnr", "CVR", "IMK_areal", "Afgkode"],
                        skip_features=offset,
                        max_features=BATCH_SIZE,
                    )
                    if frame.empty:
                        break
                    frame = gpd.GeoDataFrame(frame, geometry="geometry", crs=frame.crs).to_crs(4326)
                    for row in frame.itertuples(index=False):
                        if row.geometry is None:
                            continue
                        copy.write(
                            csv_line(
                                (
                                    clean_str(row.Marknr),
                                    clean_str(row.Markblok),
                                    clean_str(row.Journalnr),
                                    clean_str(row.CVR),
                                    float(row.IMK_areal) if row.IMK_areal is not None else None,
                                    clean_afgkode(row.Afgkode),
                                    f"SRID=4326;{to_multipolygon_wkt(row.geometry)}",
                                )
                            )
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
                f"""UPDATE {STG_BASE}
                    SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
                    WHERE NOT ST_IsValid(geom)"""
            )
            print(f"  repaired {cursor.rowcount:,} rows, building spatial index...", flush=True)
            cursor.execute(f"CREATE INDEX ix_{STG_BASE}_geom ON {STG_BASE} USING gist (geom)")
            cursor.execute(
                f"CREATE INDEX ix_{STG_BASE}_block_mark ON {STG_BASE} (markblok, marknr)"
            )
            cursor.execute(f"ANALYZE {STG_BASE}")
        connection.commit()


# --- Step 2: load the 2024/2025 comparison layers (lightweight columns) ---


def load_year_layer(dsn: str, year: int) -> None:
    table = STG_YEAR[year]
    path = str(MARKER_PATH[year])
    feature_count = read_info(path)["features"]
    print(f"Loading {feature_count:,} {year} fields into staging", flush=True)

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {table}")
            cursor.execute(
                f"""
                CREATE TABLE {table} (
                    marknr text,
                    markblok text,
                    afgkode integer,
                    geom geometry(MULTIPOLYGON, 4326) NOT NULL
                )
                """
            )
            with cursor.copy(
                f"COPY {table} (marknr, markblok, afgkode, geom) FROM STDIN WITH (FORMAT CSV)"
            ) as copy:
                loaded = 0
                offset = 0
                start = time.monotonic()
                while offset < feature_count:
                    frame = read_dataframe(
                        path,
                        columns=["Marknr", "Markblok", "Afgkode"],
                        skip_features=offset,
                        max_features=BATCH_SIZE,
                    )
                    if frame.empty:
                        break
                    frame = gpd.GeoDataFrame(frame, geometry="geometry", crs=frame.crs).to_crs(4326)
                    for row in frame.itertuples(index=False):
                        if row.geometry is None:
                            continue
                        copy.write(
                            csv_line(
                                (
                                    clean_str(row.Marknr),
                                    clean_str(row.Markblok),
                                    clean_afgkode(row.Afgkode),
                                    f"SRID=4326;{to_multipolygon_wkt(row.geometry)}",
                                )
                            )
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
            cursor.execute(f"CREATE INDEX ix_{table}_block_mark ON {table} (markblok, marknr)")
            cursor.execute(f"ANALYZE {table}")
        connection.commit()


# --- Step 3: resolve crop_history for 2024/2025 (exact block/marknr, then overlap fallback) ---


def resolve_year_afgkode(dsn: str, year: int) -> None:
    table = STG_YEAR[year]
    column = f"afgkode_{year}"
    print(f"Resolving {year} afgkode (exact Markblok/Marknr match)...", flush=True)

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                UPDATE {STG_BASE} AS b
                SET {column} = y.afgkode
                FROM {table} AS y
                WHERE b.markblok = y.markblok AND b.marknr = y.marknr
                """
            )
            exact_matched = cursor.rowcount
            print(f"  {exact_matched:,} matched exactly", flush=True)
        connection.commit()

    print(f"Resolving {year} afgkode (geometric dominant-overlap fallback)...", flush=True)
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                WITH unresolved AS (
                    SELECT load_seq, geom FROM {STG_BASE} WHERE {column} IS NULL
                ),
                overlap_candidates AS (
                    SELECT
                        u.load_seq,
                        y.afgkode,
                        ST_Area(ST_Intersection(u.geom, y.geom)) AS overlap_area
                    FROM unresolved u
                    JOIN {table} y ON ST_Intersects(u.geom, y.geom)
                ),
                best AS (
                    SELECT DISTINCT ON (load_seq) load_seq, afgkode
                    FROM overlap_candidates
                    WHERE overlap_area > 0
                    ORDER BY load_seq, overlap_area DESC
                )
                UPDATE {STG_BASE} AS b
                SET {column} = best.afgkode
                FROM best
                WHERE b.load_seq = best.load_seq
                """
            )
            fallback_matched = cursor.rowcount
            print(f"  {fallback_matched:,} matched via overlap", flush=True)
        connection.commit()


def backfill_2026_from_2025(dsn: str) -> None:
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                UPDATE {STG_BASE}
                SET afgkode_2026 = afgkode_2025
                WHERE afgkode_2026 IS NULL AND afgkode_2025 IS NOT NULL
                """
            )
            print(f"Backfilled {cursor.rowcount:,} missing 2026 afgkode from 2025", flush=True)
        connection.commit()


# --- Step 4: assign imk_id (reuse where a confident overlap match exists) ---


def assign_imk_ids(dsn: str) -> None:
    print("Matching 2026 fields against the current registry for imk_id reuse...", flush=True)
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                WITH overlap_candidates AS (
                    SELECT
                        b.load_seq,
                        r.imk_id AS old_imk_id,
                        ST_Area(ST_Intersection(b.geom, ST_MakeValid(r.geom)))
                            / NULLIF(ST_Area(b.geom), 0) AS overlap_fraction
                    FROM {STG_BASE} b
                    JOIN registry_field r ON ST_Intersects(b.geom, ST_MakeValid(r.geom))
                ),
                qualified AS (
                    SELECT DISTINCT ON (load_seq) load_seq, old_imk_id, overlap_fraction
                    FROM overlap_candidates
                    WHERE overlap_fraction >= {OVERLAP_MIN_FRACTION}
                    ORDER BY load_seq, overlap_fraction DESC
                ),
                winners AS (
                    SELECT DISTINCT ON (old_imk_id) load_seq, old_imk_id
                    FROM qualified
                    ORDER BY old_imk_id, overlap_fraction DESC
                )
                UPDATE {STG_BASE} AS b
                SET imk_id = winners.old_imk_id
                FROM winners
                WHERE b.load_seq = winners.load_seq
                """
            )
            reused = cursor.rowcount
            print(f"  reused {reused:,} existing imk_id values", flush=True)

            cursor.execute("SELECT COALESCE(MAX(imk_id), 0) FROM registry_field")
            next_id = cursor.fetchone()[0] + 1

            cursor.execute(
                f"""
                WITH fresh AS (
                    SELECT load_seq, ROW_NUMBER() OVER (ORDER BY load_seq) - 1 AS offset
                    FROM {STG_BASE}
                    WHERE imk_id IS NULL
                )
                UPDATE {STG_BASE} AS b
                SET imk_id = %s + fresh.offset
                FROM fresh
                WHERE b.load_seq = fresh.load_seq
                """,
                (next_id,),
            )
            print(
                f"  assigned {cursor.rowcount:,} fresh imk_id values starting at {next_id:,}",
                flush=True,
            )
        connection.commit()


# --- Step 5: replace registry_field with the resolved staging rows ---


def finalize_registry_field(dsn: str) -> None:
    print("Replacing registry_field with resolved 2026 rows...", flush=True)
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute("TRUNCATE registry_field")
            cursor.execute(
                f"""
                INSERT INTO registry_field (
                    imk_id, cvr, marknr, markblok, journalnr, area_ha,
                    crop_rotation, crop_history,
                    geom, centroid, sample_bucket, in_takeout_plan,
                    udledningsgraense_kgn_ha, udledningskvote_mark_kgn
                )
                SELECT
                    imk_id,
                    cvr,
                    marknr,
                    markblok,
                    journalnr,
                    area_ha,
                    '',
                    jsonb_build_object(
                        '2024', afgkode_2024,
                        '2025', afgkode_2025,
                        '2026', afgkode_2026
                    ),
                    geom,
                    ST_PointOnSurface(geom),
                    (hashtext(imk_id::text) & 1023),
                    'nej',
                    0,
                    0
                FROM {STG_BASE}
                WHERE area_ha IS NOT NULL AND area_ha > 0
                """
            )
            print(f"Inserted {cursor.rowcount:,} registry fields", flush=True)
        connection.commit()


def drop_staging_tables(dsn: str) -> None:
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {STG_BASE}")
            for table in STG_YEAR.values():
                cursor.execute(f"DROP TABLE IF EXISTS {table}")
        connection.commit()


def load_dataimk2026(*, keep_staging: bool = False) -> None:
    for path in MARKER_PATH.values():
        if not path.exists():
            raise FileNotFoundError(f"Expected {path}")

    load_dotenv(ROOT.parent / ".env")
    dsn = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    start = time.monotonic()
    load_base_2026(dsn)
    for year in (2024, 2025):
        load_year_layer(dsn, year)
        resolve_year_afgkode(dsn, year)
    backfill_2026_from_2025(dsn)
    assign_imk_ids(dsn)
    finalize_registry_field(dsn)
    if not keep_staging:
        drop_staging_tables(dsn)

    print(f"Done in {format_duration(time.monotonic() - start)}", flush=True)


if __name__ == "__main__":
    load_dataimk2026()
