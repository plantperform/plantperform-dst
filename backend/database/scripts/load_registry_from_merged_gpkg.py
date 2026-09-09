"""Replace registry_field from the merged 2026 PlantPerform GeoPackage.

The merged source contains the production registry columns plus real per-field
P/S/Nt inputs. Kystvand data and MARS field annotations must still be recomputed
after this load by their existing loaders.
"""

import json
import math
import time
from pathlib import Path

import geopandas as gpd
import psycopg
from dotenv import load_dotenv
from pyogrio import read_dataframe, read_info
from shapely.geometry import MultiPolygon, Polygon

from app.data.db import DATABASE_URL

ROOT = Path(__file__).resolve().parents[1]
MERGED_GPKG = ROOT / "data" / "raw" / "V1_1_IMK2026_n604144_gpkg_merged.gpkg"
LAYER = "PlantPerform"
BATCH_SIZE = 50_000
ROUND_DIGITS = 3
CROP_HISTORY_YEARS = range(2016, 2027)
PERCOLATION_COLUMNS_BY_KATEGORI = (
    "P_vaarbygudl",
    "P_graes",
    "P_vaarbyg",
    "p_Vhvede",
    "p_Vraps",
    "P_majs",
    "P_kart",
    "P_roer",
)
STAGING_TABLE = "registry_merged_load"
MISSING_STRINGS = frozenset({"nan", "<na>"})


def format_duration(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes:02d}:{seconds:02d}"


def to_multipolygon_wkt(geometry: Polygon | MultiPolygon) -> str:
    if isinstance(geometry, Polygon):
        geometry = MultiPolygon([geometry])
    return geometry.wkt


def clean_str(value: object) -> str | None:
    if value is None:
        return None
    text_value = str(value).strip()
    return None if not text_value or text_value.casefold() in MISSING_STRINGS else text_value


def clean_int(value: object) -> int | None:
    try:
        number = float(value)
        return int(number) if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def clean_float(value: object) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def clean_float_rounded(value: object) -> float | None:
    cleaned = clean_float(value)
    return round(cleaned, ROUND_DIGITS) if cleaned is not None else None


def clean_bool(value: object) -> bool:
    text_value = clean_str(value)
    return text_value is not None and text_value.casefold() in {"true", "1", "t", "yes"}


def load_staging(dsn: str) -> None:
    info = read_info(str(MERGED_GPKG), layer=LAYER)
    feature_count = info["features"]
    print(f"Loading {feature_count:,} fields from merged gpkg into staging", flush=True)
    columns = (
        [
            "IMK_ID", "Marknr", "IMK_areal", "CVR", "JB_Kode", "UdledgrKgNPerHa",
            "RetTot", "KystvandID", "markblok", "journalnr", "goedningsregion", "oeko",
            "oestoette", "hoejeste_hnv", "kvotegivende", "omlaegningsplan_virkemiddel",
            "omlaegningsplan_status", "kystvand_navn", "orgNtopsoil2024", "S_soil2024",
        ]
        + list(PERCOLATION_COLUMNS_BY_KATEGORI)
        + [f"Afg{year}" for year in CROP_HISTORY_YEARS]
    )

    with psycopg.connect(dsn) as connection, connection.cursor() as cursor:
        cursor.execute(f"DROP TABLE IF EXISTS {STAGING_TABLE}")
        cursor.execute(
            f"""
            CREATE TABLE {STAGING_TABLE} (
                imk_id bigint PRIMARY KEY, marknr text, markblok text, journalnr text, cvr text,
                area_ha double precision, crop_history jsonb, jbnr smallint,
                kystvand_id integer, kystvand_navn text, retention double precision,
                udledningsgraense_kgn_ha double precision, goedningsregion text, oeko boolean,
                oestoette boolean, hoejeste_hnv smallint, kvotegivende boolean,
                omlaegningsplan_virkemiddel text, omlaegningsplan_status text,
                percolation_by_kategori jsonb, org_n_topsoil double precision,
                s_soil double precision, banned boolean NOT NULL,
                geom geometry(MULTIPOLYGON, 4326) NOT NULL
            )
            """
        )
        with cursor.copy(
            f"""COPY {STAGING_TABLE} (
                imk_id, marknr, markblok, journalnr, cvr, area_ha, crop_history, jbnr,
                kystvand_id, kystvand_navn, retention, udledningsgraense_kgn_ha,
                goedningsregion, oeko, oestoette, hoejeste_hnv, kvotegivende,
                omlaegningsplan_virkemiddel, omlaegningsplan_status,
                percolation_by_kategori, org_n_topsoil, s_soil, banned, geom
            ) FROM STDIN"""
        ) as copy:
            loaded = skipped_no_geom = skipped_dup_imk_id = 0
            seen_imk_ids: set[int] = set()
            offset = 0
            start = time.monotonic()
            while offset < feature_count:
                frame = read_dataframe(
                    str(MERGED_GPKG), layer=LAYER, columns=columns,
                    skip_features=offset, max_features=BATCH_SIZE,
                )
                if frame.empty:
                    break
                frame = gpd.GeoDataFrame(frame, geometry="geometry", crs=frame.crs).to_crs(4326)
                for row in frame.itertuples(index=False):
                    if row.geometry is None:
                        skipped_no_geom += 1
                        continue
                    imk_id = clean_int(row.IMK_ID)
                    # Source order is stable; retaining its first occurrence makes duplicate
                    # resolution deterministic across repeated loads.
                    if imk_id is None or imk_id in seen_imk_ids:
                        skipped_dup_imk_id += 1
                        continue
                    seen_imk_ids.add(imk_id)
                    crop_history = {
                        str(year): clean_int(getattr(row, f"Afg{year}"))
                        for year in CROP_HISTORY_YEARS
                    }
                    area_ha = clean_float(row.IMK_areal)
                    udledningsgraense = clean_float_rounded(row.UdledgrKgNPerHa) or 0.0
                    percolation_values = tuple(
                        clean_float_rounded(getattr(row, column))
                        for column in PERCOLATION_COLUMNS_BY_KATEGORI
                    )
                    percolation = {
                        str(kategori): value
                        for kategori, value in enumerate(percolation_values, start=1)
                    }
                    org_n_topsoil = clean_float_rounded(row.orgNtopsoil2024)
                    s_soil = clean_float_rounded(row.S_soil2024)
                    banned = (
                        org_n_topsoil is None
                        or s_soil is None
                        or any(value is None for value in percolation_values)
                    )
                    virkemiddel = clean_str(row.omlaegningsplan_virkemiddel)
                    cvr = clean_int(row.CVR)
                    copy.write_row(
                        (
                            imk_id, clean_str(row.Marknr), clean_str(row.markblok),
                            clean_str(row.journalnr),
                            str(cvr).zfill(8) if cvr is not None else None,
                            area_ha, json.dumps(crop_history), clean_int(row.JB_Kode),
                            clean_int(row.KystvandID), clean_str(row.kystvand_navn),
                            clean_float_rounded(row.RetTot), udledningsgraense,
                            clean_str(row.goedningsregion), clean_bool(row.oeko),
                            clean_bool(row.oestoette), clean_int(row.hoejeste_hnv),
                            clean_bool(row.kvotegivende), virkemiddel,
                            clean_str(row.omlaegningsplan_status), json.dumps(percolation),
                            org_n_topsoil, s_soil, banned,
                            f"SRID=4326;{to_multipolygon_wkt(row.geometry)}",
                        )
                    )
                    loaded += 1
                offset += BATCH_SIZE
                print(
                    f"  read {min(offset, feature_count):,} / {feature_count:,}, "
                    f"elapsed {format_duration(time.monotonic() - start)}",
                    flush=True,
                )
        print(
            f"Loaded {loaded:,} rows ({skipped_no_geom:,} missing geometry, "
            f"{skipped_dup_imk_id:,} duplicate/invalid IMK_ID), repairing geometries...",
            flush=True,
        )
        cursor.execute(
            f"""UPDATE {STAGING_TABLE}
                SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
                WHERE NOT ST_IsValid(geom)"""
        )
        print(f"  repaired {cursor.rowcount:,} rows", flush=True)
        connection.commit()


def finalize_registry_field(dsn: str) -> None:
    print("Replacing registry_field with merged-gpkg rows...", flush=True)
    with psycopg.connect(dsn) as connection, connection.cursor() as cursor:
        cursor.execute("TRUNCATE registry_field")
        cursor.execute(
            f"""
            INSERT INTO registry_field (
                imk_id, cvr, marknr, markblok, journalnr, area_ha, crop_rotation, crop_history,
                geom, centroid, sample_bucket, in_takeout_plan, udledningsgraense_kgn_ha,
                udledningskvote_mark_kgn, jbnr, kystvand_id, kystvand_navn, retention,
                goedningsregion, oeko, oestoette, hoejeste_hnv, kvotegivende,
                omlaegningsplan_virkemiddel, omlaegningsplan_status,
                percolation_by_kategori, org_n_topsoil, s_soil, banned
            )
            SELECT
                imk_id, cvr, marknr, markblok, journalnr, area_ha, '', crop_history,
                geom, ST_PointOnSurface(geom), (hashtext(imk_id::text) & 1023),
                COALESCE(omlaegningsplan_virkemiddel, 'nej'), udledningsgraense_kgn_ha,
                ROUND((udledningsgraense_kgn_ha * COALESCE(area_ha, 0))::numeric,
                      {ROUND_DIGITS})::float,
                jbnr, kystvand_id, kystvand_navn, retention, goedningsregion, oeko, oestoette,
                hoejeste_hnv, kvotegivende, omlaegningsplan_virkemiddel,
                omlaegningsplan_status, percolation_by_kategori, org_n_topsoil, s_soil, banned
            FROM {STAGING_TABLE}
            WHERE area_ha IS NOT NULL AND area_ha > 0
            """
        )
        print(f"Inserted {cursor.rowcount:,} registry fields", flush=True)
        connection.commit()


def drop_staging(dsn: str) -> None:
    with psycopg.connect(dsn) as connection, connection.cursor() as cursor:
        cursor.execute(f"DROP TABLE IF EXISTS {STAGING_TABLE}")
        connection.commit()


def load_registry_from_merged_gpkg(*, keep_staging: bool = False) -> None:
    if not MERGED_GPKG.exists():
        raise FileNotFoundError(f"Expected {MERGED_GPKG}")
    load_dotenv(ROOT.parent / ".env")
    if DATABASE_URL is None:
        raise RuntimeError("DATABASE_URL is not configured")
    dsn = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")
    start = time.monotonic()
    load_staging(dsn)
    finalize_registry_field(dsn)
    if not keep_staging:
        drop_staging(dsn)
    print(f"Done in {format_duration(time.monotonic() - start)}", flush=True)


if __name__ == "__main__":
    load_registry_from_merged_gpkg()
