"""One-time backfill of registry_field.percolation_by_kategori/org_n_topsoil/
s_soil for rows already loaded by load_registry_from_merged_gpkg.py before
migration 20260904_0001 added these columns.

Targeted UPDATE by imk_id only — no geometry, no TRUNCATE+reload of the
603k-row table (that already ran three times today). Safe to re-run: it just
overwrites the same three columns from the same source file.
"""

import json
import time
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from pyogrio import read_dataframe, read_info

from app.data.db import DATABASE_URL

ROOT = Path(__file__).resolve().parents[1]
MERGED_GPKG = ROOT / "data" / "raw" / "V1_1_IMK2026_n604144_gpkg_merged.gpkg"
LAYER = "PlantPerform"
BATCH_SIZE = 100_000
STG = "percolation_backfill"

# Kept in sync with load_registry_from_merged_gpkg.py's own copy (not
# imported from it — that module lives outside PYTHONPATH=src's reach).
PERCOLATION_COLUMNS_BY_KATEGORI = [
    "P_vaarbygudl", "P_graes", "P_vaarbyg", "p_Vhvede",
    "p_Vraps", "P_majs", "P_kart", "P_roer",
]


def clean_int(value: object) -> int | None:
    if value is None:
        return None
    try:
        if value != value:  # NaN
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def clean_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        if value != value:  # NaN
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def format_duration(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    minutes, seconds = divmod(total_seconds, 60)
    return f"{minutes:02d}:{seconds:02d}"


def load_staging(dsn: str) -> None:
    info = read_info(str(MERGED_GPKG), layer=LAYER)
    feature_count = info["features"]
    columns = ["IMK_ID", "orgNtopsoil2024", "S_soil2024"] + PERCOLATION_COLUMNS_BY_KATEGORI
    print(f"Reading {feature_count:,} rows' percolation/org_n_topsoil/s_soil columns", flush=True)

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {STG}")
            cursor.execute(
                f"""CREATE TABLE {STG} (
                    imk_id bigint PRIMARY KEY,
                    percolation_by_kategori jsonb,
                    org_n_topsoil double precision,
                    s_soil double precision
                )"""
            )
            with cursor.copy(
                f"COPY {STG} (imk_id, percolation_by_kategori, org_n_topsoil, s_soil) FROM STDIN"
            ) as copy:
                loaded = 0
                skipped_dup = 0
                seen: set[int] = set()
                offset = 0
                start = time.monotonic()
                while offset < feature_count:
                    frame = read_dataframe(
                        str(MERGED_GPKG), layer=LAYER, columns=columns, read_geometry=False,
                        skip_features=offset, max_features=BATCH_SIZE,
                    )
                    if frame.empty:
                        break
                    for row in frame.itertuples(index=False):
                        imk_id = clean_int(row.IMK_ID)
                        if imk_id is None or imk_id in seen:
                            skipped_dup += 1
                            continue
                        seen.add(imk_id)
                        percolation = {
                            str(kategori): clean_float(getattr(row, col))
                            for kategori, col in enumerate(PERCOLATION_COLUMNS_BY_KATEGORI, start=1)
                        }
                        copy.write_row((
                            imk_id,
                            json.dumps(percolation),
                            clean_float(row.orgNtopsoil2024),
                            clean_float(row.S_soil2024),
                        ))
                        loaded += 1
                    offset += BATCH_SIZE
                    print(
                        f"  read {min(offset, feature_count):,} / {feature_count:,}, "
                        f"elapsed {format_duration(time.monotonic() - start)}",
                        flush=True,
                    )
            print(
                f"Loaded {loaded:,} rows into staging ({skipped_dup:,} duplicate imk_id skipped)",
                flush=True,
            )
        connection.commit()


def apply_backfill(dsn: str) -> None:
    print("Updating registry_field from staging...", flush=True)
    start = time.monotonic()
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""UPDATE registry_field rf
                    SET percolation_by_kategori = s.percolation_by_kategori,
                        org_n_topsoil = s.org_n_topsoil,
                        s_soil = s.s_soil
                    FROM {STG} s
                    WHERE rf.imk_id = s.imk_id"""
            )
            print(
                f"Updated {cursor.rowcount:,} registry fields "
                f"in {format_duration(time.monotonic() - start)}",
                flush=True,
            )
        connection.commit()


def drop_staging(dsn: str) -> None:
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {STG}")
        connection.commit()


def backfill_percolation() -> None:
    if not MERGED_GPKG.exists():
        raise FileNotFoundError(f"Expected {MERGED_GPKG}")
    load_dotenv(ROOT.parent / ".env")
    dsn = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    load_staging(dsn)
    apply_backfill(dsn)
    drop_staging(dsn)


if __name__ == "__main__":
    backfill_percolation()
