"""Replace registry_field from the merged 2026 PlantPerform GeoPackage.

The merged source contains the production registry columns plus real per-field
P/S/Nt inputs. Kystvand data, gødningsregioner and MARS field annotations must
still be recomputed after this load by their existing loaders.
"""

import json
import math
import time
from pathlib import Path
from threading import Event, Thread

import geopandas as gpd
from pyogrio import read_dataframe, read_info
from shapely.geometry import MultiPolygon, Polygon

from database.scripts.registry_load_checkpoint import (
    DEFAULT_BATCH_SIZE,
    MERGED_COMMAND,
    MERGED_STEP,
    STAGING_TABLE,
    CheckpointError,
    LoadRun,
    open_load_run,
    run_cli,
)
from database.scripts.runtime_lookup_loader import database_dsn

ROOT = Path(__file__).resolve().parents[1]
MERGED_GPKG = ROOT / "data" / "raw" / "V1_1_IMK2026_n604144_gpkg_merged.gpkg"
LAYER = "PlantPerform"
ROUND_DIGITS = 3
# PUMR 2027 requirements spec, table A, field A22: retention is rounded to 2
# decimals, and that rounded value is the one the N load calculation uses.
RETENTION_ROUND_DIGITS = 2
STATUS_INTERVAL_SECONDS = 10.0
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
MISSING_STRINGS = frozenset({"nan", "<na>"})


def format_duration(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes:02d}:{seconds:02d}"


class StageReporter:
    """Report activity while PostgreSQL executes a long-running operation.

    PostgreSQL does not expose row-level progress for COPY, UPDATE, or INSERT.
    A heartbeat makes the active operation visible without polling the database
    or adding work to a database that is already busy loading data.
    """

    def __init__(self, description: str, *, interval: float = STATUS_INTERVAL_SECONDS) -> None:
        self.description = description
        self.interval = interval
        self.start_time = 0.0
        self.done = Event()
        self.thread: Thread | None = None

    def __enter__(self) -> "StageReporter":
        self.start_time = time.monotonic()
        print(f"{self.description}...", flush=True)
        self.thread = Thread(target=self._report_until_done, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
        self.done.set()
        if self.thread is not None:
            self.thread.join()
        outcome = "completed" if exc_type is None else "failed"
        print(
            f"  {self.description} {outcome} in "
            f"{format_duration(time.monotonic() - self.start_time)}",
            flush=True,
        )

    def _report_until_done(self) -> None:
        while not self.done.wait(self.interval):
            print(
                f"  still {self.description.lower()} "
                f"(elapsed {format_duration(time.monotonic() - self.start_time)})",
                flush=True,
            )


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


def clean_float_rounded(value: object, digits: int = ROUND_DIGITS) -> float | None:
    cleaned = clean_float(value)
    return round(cleaned, digits) if cleaned is not None else None


def clean_bool(value: object) -> bool:
    text_value = clean_str(value)
    return text_value is not None and text_value.casefold() in {"true", "1", "t", "yes"}


def merged_source_metadata() -> dict:
    if not MERGED_GPKG.exists():
        raise FileNotFoundError(f"Expected {MERGED_GPKG}")
    feature_count = int(read_info(str(MERGED_GPKG), layer=LAYER)["features"])
    if feature_count <= 0:
        raise ValueError("The merged GeoPackage contains no features")
    return {"layer": LAYER, "feature_count": feature_count}


def validate_staging(run: LoadRun) -> set[int]:
    state = run.state
    count = state["sources"]["feature_count"]
    counters = [
        state.get(key)
        for key in (
            "next_offset",
            "loaded",
            "skipped_no_geom",
            "skipped_dup_imk_id",
        )
    ]
    if (
        any(type(value) is not int or value < 0 for value in counters)
        or counters[0] != sum(counters[1:])
        or counters[0] > count
        or (state["phase"] != "copying" and counters[0] != count)
    ):
        raise CheckpointError("Inconsistent staging counters; use --restart.")
    exists = run.connection.execute("SELECT to_regclass(%s)", (STAGING_TABLE,)).fetchone()[0]
    if exists is None:
        raise CheckpointError("Staging table is missing; use --restart.")
    with run.connection.cursor() as cursor:
        cursor.execute(f"SELECT imk_id FROM {STAGING_TABLE}")
        seen = {imk_id for (imk_id,) in cursor}
    if len(seen) != state["loaded"]:
        raise CheckpointError("Staging row count differs from the checkpoint; use --restart.")
    return seen


def staging_values(row: object, imk_id: int) -> tuple:
    crop_history = {str(year): clean_int(getattr(row, f"Afg{year}")) for year in CROP_HISTORY_YEARS}
    area_ha = clean_float(row.IMK_areal)
    udledningsgraense = clean_float_rounded(row.UdledgrKgNPerHa) or 0.0
    percolation_values = tuple(
        clean_float_rounded(getattr(row, column)) for column in PERCOLATION_COLUMNS_BY_KATEGORI
    )
    percolation = {
        str(kategori): value for kategori, value in enumerate(percolation_values, start=1)
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
    return (
        imk_id,
        clean_str(row.Marknr),
        clean_str(row.markblok),
        clean_str(row.journalnr),
        str(cvr).zfill(8) if cvr is not None else None,
        area_ha,
        json.dumps(crop_history),
        clean_int(row.JB_Kode),
        clean_int(row.KystvandID),
        clean_str(row.kystvand_navn),
        clean_float_rounded(row.RetTot, RETENTION_ROUND_DIGITS),
        udledningsgraense,
        clean_bool(row.oeko),
        clean_bool(row.oestoette),
        clean_int(row.hoejeste_hnv),
        clean_bool(row.kvotegivende),
        virkemiddel,
        clean_str(row.omlaegningsplan_status),
        json.dumps(percolation),
        org_n_topsoil,
        s_soil,
        banned,
        f"SRID=4326;{to_multipolygon_wkt(row.geometry)}",
    )


def load_staging(run: LoadRun, *, batch_size: int = DEFAULT_BATCH_SIZE) -> None:
    connection = run.connection
    feature_count = run.state["sources"]["feature_count"]
    print(f"Loading {feature_count:,} fields from merged gpkg into staging", flush=True)
    columns = (
        [
            "IMK_ID",
            "Marknr",
            "IMK_areal",
            "CVR",
            "JB_Kode",
            "UdledgrKgNPerHa",
            "RetTot",
            "KystvandID",
            "markblok",
            "journalnr",
            "oeko",
            "oestoette",
            "hoejeste_hnv",
            "kvotegivende",
            "omlaegningsplan_virkemiddel",
            "omlaegningsplan_status",
            "kystvand_navn",
            "orgNtopsoil2024",
            "S_soil2024",
        ]
        + list(PERCOLATION_COLUMNS_BY_KATEGORI)
        + [f"Afg{year}" for year in CROP_HISTORY_YEARS]
    )

    if run.state["phase"] == "new":
        with connection.transaction(), connection.cursor() as cursor:
            cursor.execute(
                f"""
                CREATE TABLE {STAGING_TABLE} (
                    imk_id bigint PRIMARY KEY, marknr text, markblok text, journalnr text, cvr text,
                    area_ha double precision, crop_history jsonb, jbnr smallint,
                    kystvand_id integer, kystvand_navn text, retention double precision,
                    udledningsgraense_kgn_ha double precision, oeko boolean,
                    oestoette boolean, hoejeste_hnv smallint, kvotegivende boolean,
                    omlaegningsplan_virkemiddel text, omlaegningsplan_status text,
                    percolation_by_kategori jsonb, org_n_topsoil double precision,
                    s_soil double precision, banned boolean NOT NULL,
                    geom geometry(MULTIPOLYGON, 4326) NOT NULL
                )
                """
            )
            run.save(phase="copying")
    seen_imk_ids = validate_staging(run)
    start = time.monotonic()
    while run.state["next_offset"] < feature_count:
        run.check_sources()
        offset = run.state["next_offset"]
        expected = min(batch_size, feature_count - offset)
        with StageReporter(f"Reading source features {offset:,}–{offset + expected:,}"):
            frame = read_dataframe(
                str(MERGED_GPKG),
                layer=LAYER,
                columns=columns,
                skip_features=offset,
                max_features=expected,
            )
            if len(frame) != expected:
                raise CheckpointError(
                    f"Premature end of source at {offset:,}: expected {expected:,} features, "
                    f"read {len(frame):,}; use --restart."
                )
            frame = gpd.GeoDataFrame(frame, geometry="geometry", crs=frame.crs).to_crs(4326)
        loaded = run.state["loaded"]
        skipped_no_geom = run.state["skipped_no_geom"]
        skipped_dup_imk_id = run.state["skipped_dup_imk_id"]
        with StageReporter("Copying and committing staging batch"), connection.transaction():
            with (
                connection.cursor() as cursor,
                cursor.copy(
                    f"""COPY {STAGING_TABLE} (
                    imk_id, marknr, markblok, journalnr, cvr, area_ha, crop_history, jbnr,
                    kystvand_id, kystvand_navn, retention, udledningsgraense_kgn_ha,
                    oeko, oestoette, hoejeste_hnv, kvotegivende,
                    omlaegningsplan_virkemiddel, omlaegningsplan_status,
                    percolation_by_kategori, org_n_topsoil, s_soil, banned, geom
                ) FROM STDIN"""
                ) as copy,
            ):
                for row in frame.itertuples(index=False):
                    if row.geometry is None:
                        skipped_no_geom += 1
                        continue
                    imk_id = clean_int(row.IMK_ID)
                    # Restore committed IDs on resume, preserving the first source occurrence.
                    if imk_id is None or imk_id in seen_imk_ids:
                        skipped_dup_imk_id += 1
                        continue
                    seen_imk_ids.add(imk_id)
                    copy.write_row(staging_values(row, imk_id))
                    loaded += 1
            run.check_sources()
            run.save(
                next_offset=offset + len(frame),
                loaded=loaded,
                skipped_no_geom=skipped_no_geom,
                skipped_dup_imk_id=skipped_dup_imk_id,
            )
        print(
            f"  committed {run.state['next_offset']:,} / {feature_count:,} source features, "
            f"{loaded:,} staged rows, elapsed {format_duration(time.monotonic() - start)}",
            flush=True,
        )
    if run.state["phase"] == "copying":
        if run.state["loaded"] == 0:
            raise CheckpointError("No usable registry fields were staged; use --restart.")
        run.check_sources()
        with StageReporter("Repairing invalid staged geometries"), connection.transaction():
            result = connection.execute(
                f"""UPDATE {STAGING_TABLE}
                    SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
                    WHERE NOT ST_IsValid(geom)"""
            )
            print(f"  repaired {result.rowcount:,} rows", flush=True)
            run.save(phase="repaired")
    print(
        f"Loaded {run.state['loaded']:,} rows "
        f"({run.state['skipped_no_geom']:,} missing geometry, "
        f"{run.state['skipped_dup_imk_id']:,} duplicate/invalid IMK_ID)",
        flush=True,
    )


def finalize_registry_field(run: LoadRun) -> None:
    validate_staging(run)
    run.check_sources()
    if run.state["phase"] != "repaired":
        raise CheckpointError("Staging geometries have not been repaired; use --restart.")
    print("Replacing registry_field with merged-gpkg rows...", flush=True)
    connection = run.connection
    with connection.transaction(), connection.cursor() as cursor:
        with StageReporter("Waiting to truncate registry_field"):
            cursor.execute("TRUNCATE registry_field")
        with StageReporter("Inserting registry fields and updating indexes"):
            cursor.execute(
                f"""
                INSERT INTO registry_field (
                imk_id, cvr, marknr, markblok, journalnr, area_ha, crop_rotation, crop_history,
                geom, centroid, sample_bucket, in_takeout_plan, udledningsgraense_kgn_ha,
                udledningskvote_mark_kgn, jbnr, kystvand_id, kystvand_navn, retention,
                oeko, oestoette, hoejeste_hnv, kvotegivende,
                omlaegningsplan_virkemiddel, omlaegningsplan_status,
                percolation_by_kategori, org_n_topsoil, s_soil, banned
            )
            SELECT
                imk_id, cvr, marknr, markblok, journalnr, area_ha, '', crop_history,
                geom, ST_PointOnSurface(geom), (hashtext(imk_id::text) & 1023),
                COALESCE(omlaegningsplan_virkemiddel, 'nej'), udledningsgraense_kgn_ha,
                ROUND((udledningsgraense_kgn_ha * COALESCE(area_ha, 0))::numeric,
                      {ROUND_DIGITS})::float,
                jbnr, kystvand_id, kystvand_navn, retention, oeko, oestoette,
                hoejeste_hnv, kvotegivende, omlaegningsplan_virkemiddel,
                omlaegningsplan_status, percolation_by_kategori, org_n_topsoil, s_soil, banned
            FROM {STAGING_TABLE}
            WHERE area_ha IS NOT NULL AND area_ha > 0
                """
            )
        print(f"Inserted {cursor.rowcount:,} registry fields", flush=True)
        with StageReporter("Adding registry-only crop codes"):
            cursor.execute("""
                INSERT INTO afgroede (afgroedekode)
                SELECT DISTINCT value::integer
                FROM registry_field,
                     LATERAL json_each_text(crop_history) AS history(year, value)
                WHERE value ~ '^[0-9]+$' AND value::integer > 0
                ON CONFLICT (afgroedekode) DO NOTHING
            """)
        print(f"Inserted {cursor.rowcount:,} registry-only crop codes", flush=True)
        run.save(phase="finalized")


def drop_staging(run: LoadRun) -> None:
    with StageReporter("Dropping the staging table"), run.connection.transaction():
        run.connection.execute(f"DROP TABLE IF EXISTS {STAGING_TABLE}")
        run.save(phase="cleaned")


def load_merged_run(
    run: LoadRun,
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    keep_staging: bool = False,
) -> None:
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")
    if run.state["phase"] not in {"new", "copying", "repaired", "finalized", "cleaned"}:
        raise CheckpointError("Unknown GeoPackage phase; use --restart.")
    if run.state["phase"] in {"new", "copying", "repaired"}:
        load_staging(run, batch_size=batch_size)
        finalize_registry_field(run)
    if run.state["phase"] == "finalized" and not keep_staging:
        drop_staging(run)
    run.mark_step(MERGED_STEP)


def load_registry_from_merged_gpkg(
    *,
    keep_staging: bool = False,
    restart: bool = False,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> None:
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")
    metadata = merged_source_metadata()
    start = time.monotonic()
    with open_load_run(database_dsn(), MERGED_COMMAND) as run:
        run.start([MERGED_GPKG], metadata, restart=restart)
        if MERGED_STEP not in run.state["completed_steps"]:
            load_merged_run(run, batch_size=batch_size, keep_staging=keep_staging)
        run.finish()
    print(f"Done in {format_duration(time.monotonic() - start)}", flush=True)


if __name__ == "__main__":
    run_cli(MERGED_COMMAND, load_registry_from_merged_gpkg)
