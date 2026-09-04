"""Load registry_field entirely from the merged geopackage
(V1_1_IMK2026_n604144_gpkg_merged.gpkg), replacing the 7-script
load_dataimk2026.py + load_jordbundskort.py + load_kystvandoplande.py +
load_retentionskort.py + load_udledningsgraenser.py + load_oekologi_hnv.py
+ load_mars_projekter.py's registry_field-side pipeline with one pass.

Why one pass is possible now: the merged file already carries jbnr,
kystvand_id, retention, udledningsgraense, oeko/oestoette/hoejeste_hnv,
kvotegivende, goedningsregion, kystvand_navn and the MARS omlaegningsplan
fields as columns (see merge_gpkg.py, run 2026-09-04) — they were joined in
from the *previous* registry_field by (cvr, marknr), the only key that
actually agrees between the two datasets (imk_id does not: confirmed by
spot-check, the old registry's imk_id includes ~14% freshly-invented ids
from load_dataimk2026.py's overlap-matching, not a stable external id).

imk_id: taken directly from the new file's own IMK_ID, unlike
load_dataimk2026.py's overlap-based reuse-or-fresh logic — explicit user
decision (2026-09-04): the new file's ids are the authoritative ones now,
existing farms' saved field references are not being preserved across this
swap.

crop_history: built from Afg2016..Afg2026 (11 years) — a superset of the
2017-2026 the current table already has and field_history_evaluator's
real-history lookback (REAL_HISTORY_END_YEAR=2026, looks back to 2019-2=2017)
needs. crop_rotation (the old Rot_vec-format column) stays "" — confirmed
unused by any running code path, same as load_dataimk2026.py.

udledningskvote_mark_kgn = udledningsgraense_kgn_ha * area_ha, same
convention as load_udledningsgraenser.py ("ganget med markens fulde area_ha
... for kvoten").

Boolean columns (oeko/oestoette/kvotegivende) round-tripped through the
GeoPackage as the literal text "True"/"False" (fiona/OGR has no native
boolean field type in this driver) — parsed back explicitly here.

Duplicate IMK_ID handling: the new source file has 577 IMK_ID values that
occur more than once (665 excess rows total out of 604,144). Checked all of
them (2026-09-04): every duplicate group is a byte-for-byte accidental
repeat — identical Marknr/CVR/IMK_areal/Afgroede, and for the highest-count
group (imk_id 535773, 32 rows) identical geometry too (single distinct WKT,
area matches IMK_areal exactly). None are a real field split across rows
under a shared id. Safe to keep the first occurrence per imk_id and drop the
rest, which load_staging does with a seen_imk_ids set.

"nan"-string enrichment columns: merge_gpkg.py builds the 10 enrichment
columns (markblok, journalnr, goedningsregion, oeko, oestoette, hoejeste_hnv,
kvotegivende, omlaegningsplan_virkemiddel, omlaegningsplan_status,
kystvand_navn) via pandas.read_sql from the old registry_field followed by a
left-merge — both steps represent a missing text value as a float NaN rather
than None, and GDAL's GPKG writer then stringifies that NaN to the literal
3-character text "nan" instead of a null field. Found on the first load
attempt (2026-09-04): 551,529 of 603,479 rows (91%) had
omlaegningsplan_virkemiddel/omlaegningsplan_status/in_takeout_plan set to the
text "nan", plus 17,493-32,289 rows for the other four affected text columns.
Left as-is — explicit user decision (2026-09-04) — rather than folding it to
None in clean_str(), so the loaded table matches what's actually live.

percolation_by_kategori/org_n_topsoil/s_soil: real per-field percolation/
soil-nitrogen data (see migration 20260904_0001) used by
services.nles5.bridge_v2's leaching calculation. The source's 8 P_-columns
(P_vaarbygudl, P_graes, P_vaarbyg, p_Vhvede, p_Vraps, P_majs, P_kart, P_roer)
are named after each afstrømningskategori's reference crop, not by category
number — the JSON key here is their COLUMN ORDER (1-8), matching the category
numbering services.rotations.afstromning already uses, not their column name.

banned: true for a field missing org_n_topsoil/s_soil/percolation_by_kategori
(see migration 20260904_0002) — confirmed 2026-09-04 to be almost entirely
non-arable land (permanent græs uden norm, brak, miljøtilsagn, natur/skov),
not real sædskiftemarker. A banned field is excluded from every read path in
registry_repository.py (map tiles, search, lookup) and from repository.py's
_registry_context_for_imk_id — explicit user decision to hide these
completely rather than let the leaching calculation silently return 0 for
them. Reversible (not a delete), and other ban criteria can reuse this same
column later.

kystvand_id/kystvand_navn caveat: this loader still passes through the new
file's native KystvandID attribute + the old table's kystvand_navn, which are
NOT mutually consistent (confirmed 2026-09-04 — see load_kystvandoplande.py's
module docstring). A full re-run of this script must be followed by
`pixi run load-kystvandoplande` (compute_dominant_kystvand_id) to get correct,
matching values — this script alone does not fix that.

ROUND_DIGITS: explicit user decision (2026-09-04) — the source file's real
per-field floats (percolation_by_kategori, org_n_topsoil, s_soil,
udledningsgraense_kgn_ha, retention) carry full float64 precision (16+
significant digits, e.g. udledningsgraense_kgn_ha=3.500928172206375), noise
no real measurement or model actually justifies. Rounded once here at load time
(also applied at read time in app.data.repository for percolation/org_n_
topsoil/s_soil's lru_cache key, see its _PERCOLATION_ROUND_DIGITS — kept in
sync, same value) rather than left at full precision in storage. 3 decimals
matches the user's own accepted tolerance for the udvaskningsberegning (L)
this feeds — see bridge_v2.evaluate_leaching_position's docstring.
"""

import json
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

CROP_HISTORY_YEARS = range(2016, 2027)

# Se modul-docstringens ROUND_DIGITS-afsnit.
ROUND_DIGITS = 3

# Kolonnerækkefølge = afstrømningskategori 1-8 (jf. modul-docstring) — IKKE
# kolonnenavnet, som er en reference-afgrøde, ikke et kategorinummer.
PERCOLATION_COLUMNS_BY_KATEGORI = [
    "P_vaarbygudl", "P_graes", "P_vaarbyg", "p_Vhvede",
    "p_Vraps", "P_majs", "P_kart", "P_roer",
]

STG = "registry_merged_load"


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


def clean_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


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


def clean_float_rounded(value: object) -> float | None:
    cleaned = clean_float(value)
    return round(cleaned, ROUND_DIGITS) if cleaned is not None else None


def clean_bool(value: object) -> bool:
    if value is None:
        return False
    text = str(value).strip().lower()
    return text in ("true", "1", "t", "yes")


def load_staging(dsn: str) -> None:
    info = read_info(str(MERGED_GPKG), layer=LAYER)
    feature_count = info["features"]
    print(f"Loading {feature_count:,} fields from merged gpkg into staging", flush=True)

    columns = (
        ["IMK_ID", "Marknr", "IMK_areal", "CVR", "JB_Kode", "UdledgrKgNPerHa", "RetTot",
         "KystvandID", "markblok", "journalnr", "goedningsregion", "oeko", "oestoette",
         "hoejeste_hnv", "kvotegivende", "omlaegningsplan_virkemiddel",
         "omlaegningsplan_status", "kystvand_navn", "orgNtopsoil2024", "S_soil2024"]
        + PERCOLATION_COLUMNS_BY_KATEGORI
        + [f"Afg{year}" for year in CROP_HISTORY_YEARS]
    )

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {STG}")
            cursor.execute(
                f"""
                CREATE TABLE {STG} (
                    imk_id bigint PRIMARY KEY,
                    marknr text,
                    markblok text,
                    journalnr text,
                    cvr text,
                    area_ha double precision,
                    crop_history jsonb,
                    jbnr smallint,
                    kystvand_id integer,
                    kystvand_navn text,
                    retention double precision,
                    udledningsgraense_kgn_ha double precision,
                    goedningsregion text,
                    oeko boolean,
                    oestoette boolean,
                    hoejeste_hnv smallint,
                    kvotegivende boolean,
                    omlaegningsplan_virkemiddel text,
                    omlaegningsplan_status text,
                    percolation_by_kategori jsonb,
                    org_n_topsoil double precision,
                    s_soil double precision,
                    geom geometry(MULTIPOLYGON, 4326) NOT NULL
                )
                """
            )
            with cursor.copy(
                f"""COPY {STG} (
                    imk_id, marknr, markblok, journalnr, cvr, area_ha, crop_history,
                    jbnr, kystvand_id, kystvand_navn, retention, udledningsgraense_kgn_ha,
                    goedningsregion, oeko, oestoette, hoejeste_hnv, kvotegivende,
                    omlaegningsplan_virkemiddel, omlaegningsplan_status,
                    percolation_by_kategori, org_n_topsoil, s_soil, geom
                ) FROM STDIN"""
            ) as copy:
                loaded = 0
                skipped_no_geom = 0
                skipped_dup_imk_id = 0
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
                        if imk_id is None or imk_id in seen_imk_ids:
                            skipped_dup_imk_id += 1
                            continue
                        seen_imk_ids.add(imk_id)
                        crop_history = {
                            str(year): clean_int(getattr(row, f"Afg{year}"))
                            for year in CROP_HISTORY_YEARS
                        }
                        area_ha = clean_float(row.IMK_areal)
                        udledningsgraense_raw = clean_float(row.UdledgrKgNPerHa) or 0.0
                        udledningsgraense = round(udledningsgraense_raw, ROUND_DIGITS)
                        virkemiddel = clean_str(row.omlaegningsplan_virkemiddel)
                        percolation_by_kategori = {
                            str(kategori): clean_float_rounded(getattr(row, col))
                            for kategori, col in enumerate(PERCOLATION_COLUMNS_BY_KATEGORI, start=1)
                        }
                        copy.write_row(
                            (
                                imk_id,
                                clean_str(row.Marknr),
                                clean_str(row.markblok),
                                clean_str(row.journalnr),
                                (
                                    str(int(row.CVR)).zfill(8)
                                    if row.CVR is not None and row.CVR == row.CVR
                                    else None
                                ),
                                area_ha,
                                json.dumps(crop_history),
                                clean_int(row.JB_Kode),
                                clean_int(row.KystvandID),
                                clean_str(row.kystvand_navn),
                                clean_float_rounded(row.RetTot),
                                udledningsgraense,
                                clean_str(row.goedningsregion),
                                clean_bool(row.oeko),
                                clean_bool(row.oestoette),
                                clean_int(row.hoejeste_hnv),
                                clean_bool(row.kvotegivende),
                                virkemiddel,
                                clean_str(row.omlaegningsplan_status),
                                json.dumps(percolation_by_kategori),
                                clean_float_rounded(row.orgNtopsoil2024),
                                clean_float_rounded(row.S_soil2024),
                                f"SRID=4326;{to_multipolygon_wkt(row.geometry)}",
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
            print(
                f"Loaded {loaded:,} rows ({skipped_no_geom:,} skipped for missing geometry, "
                f"{skipped_dup_imk_id:,} skipped for duplicate imk_id), "
                "repairing invalid geometries...",
                flush=True,
            )
            cursor.execute(
                f"""UPDATE {STG}
                    SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
                    WHERE NOT ST_IsValid(geom)"""
            )
            print(f"  repaired {cursor.rowcount:,} rows", flush=True)
        connection.commit()


def finalize_registry_field(dsn: str) -> None:
    print("Replacing registry_field with the merged-gpkg rows...", flush=True)
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute("TRUNCATE registry_field")
            cursor.execute(
                f"""
                INSERT INTO registry_field (
                    imk_id, cvr, marknr, markblok, journalnr, area_ha,
                    crop_rotation, crop_history,
                    geom, centroid, sample_bucket, in_takeout_plan,
                    udledningsgraense_kgn_ha, udledningskvote_mark_kgn,
                    jbnr, kystvand_id, kystvand_navn, retention,
                    goedningsregion, oeko, oestoette, hoejeste_hnv, kvotegivende,
                    omlaegningsplan_virkemiddel, omlaegningsplan_status,
                    percolation_by_kategori, org_n_topsoil, s_soil, banned
                )
                SELECT
                    imk_id, cvr, marknr, markblok, journalnr, area_ha,
                    '', crop_history,
                    geom, ST_PointOnSurface(geom), (hashtext(imk_id::text) & 1023),
                    COALESCE(omlaegningsplan_virkemiddel, 'nej'),
                    udledningsgraense_kgn_ha,
                    ROUND(
                        (udledningsgraense_kgn_ha * COALESCE(area_ha, 0))::numeric, {ROUND_DIGITS}
                    )::float,
                    jbnr, kystvand_id, kystvand_navn, retention,
                    goedningsregion, oeko, oestoette, hoejeste_hnv, kvotegivende,
                    omlaegningsplan_virkemiddel, omlaegningsplan_status,
                    percolation_by_kategori, org_n_topsoil, s_soil,
                    (org_n_topsoil IS NULL OR s_soil IS NULL
                        OR (percolation_by_kategori->>'1') IS NULL)
                FROM {STG}
                WHERE area_ha IS NOT NULL AND area_ha > 0
                """
            )
            print(f"Inserted {cursor.rowcount:,} registry fields", flush=True)
        connection.commit()


def drop_staging(dsn: str) -> None:
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {STG}")
        connection.commit()


def load_registry_from_merged_gpkg(*, keep_staging: bool = False) -> None:
    if not MERGED_GPKG.exists():
        raise FileNotFoundError(f"Expected {MERGED_GPKG}")

    load_dotenv(ROOT.parent / ".env")
    dsn = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    start = time.monotonic()
    load_staging(dsn)
    finalize_registry_field(dsn)
    if not keep_staging:
        drop_staging(dsn)

    print(f"Done in {format_duration(time.monotonic() - start)}", flush=True)


if __name__ == "__main__":
    load_registry_from_merged_gpkg()
