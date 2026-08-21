import csv
import json
import time
import zipfile
from collections.abc import Iterator
from pathlib import Path

import geopandas as gpd
import pandas as pd
import psycopg
from dotenv import load_dotenv
from pyogrio import read_dataframe, read_info
from shapely.geometry import MultiPolygon, Polygon

from app.data.db import DATABASE_URL

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
GPKG_ZIP_PATH = RAW_DIR / "DataIMK2023_DataPlantPerform_n609506_gpkg.zip"
GPKG_NAME = "DataIMK2023_DataPlantPerform_n609506_gpkg.gpkg"
GPKG_PATH = RAW_DIR / GPKG_NAME
GPKG_LAYER = "PlantPerform"
CVR_MAPPING_PATH = RAW_DIR / "CVR2023_AnomymKey.xlsx"
NLES_MAPPING_PATH = RAW_DIR / "Mark2023_AfgroedeAggEfterNless_n13Afgroeder_n609512marker.xlsx"
CROP_YEARS = list(range(2017, 2024))
BATCH_SIZE = 25_000
PROGRESS_INTERVAL_SECONDS = 5.0


def format_duration(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)

    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    return f"{minutes:02d}:{seconds:02d}"


class ProgressReporter:
    def __init__(self, total: int) -> None:
        self.total = total
        self.start_time = time.monotonic()
        self.last_print_time = self.start_time
        self.scanned = 0
        self.loaded = 0

    @property
    def elapsed_seconds(self) -> float:
        return time.monotonic() - self.start_time

    def tick(self, scanned: int, loaded: int, *, force: bool = False) -> None:
        self.scanned = scanned
        self.loaded = loaded

        now = time.monotonic()
        if not force and now - self.last_print_time < PROGRESS_INTERVAL_SECONDS:
            return

        self.last_print_time = now
        elapsed = now - self.start_time
        remaining = max(self.total - scanned, 0)
        percentage = (scanned / self.total) if self.total else 1
        rate = scanned / elapsed if elapsed > 0 else 0
        eta = format_duration(remaining / rate) if rate > 0 else "--:--"

        print(
            f"Scanned {scanned:,} / {self.total:,} ({percentage:.1%}), "
            f"loaded {loaded:,}, remaining {remaining:,}, "
            f"elapsed {format_duration(elapsed)}, ETA {eta}",
            flush=True,
        )


def clean_int(value: object) -> int | None:
    if pd.isna(value):
        return None

    text = str(value).strip()
    if not text or text.upper() == "NULL":
        return None

    return int(float(text))


def clean_float(value: object) -> float | None:
    if pd.isna(value):
        return None

    text = str(value).strip()
    if not text or text.upper() == "NULL":
        return None

    return float(text)


def clean_bool(value: object) -> bool:
    if pd.isna(value):
        return False

    if isinstance(value, bool):
        return value

    if isinstance(value, (int, float)):
        # numpy float64/int64 arrive here; NaN already handled above.
        return value != 0

    text = str(value).strip().lower()

    try:
        number = float(text)
    except ValueError:
        return text in {"1", "true", "t", "yes", "y", "ja"}

    return not pd.isna(number) and number != 0


def clean_cvr(value: object) -> str | None:
    cvr = clean_int(value)
    return f"{cvr:08d}" if cvr is not None else None


def clean_text(value: object) -> str | None:
    if pd.isna(value):
        return None

    text = str(value).strip()
    if not text or text.upper() == "NULL":
        return None

    return text


def to_multipolygon_wkt(geometry: Polygon | MultiPolygon) -> str:
    if isinstance(geometry, Polygon):
        geometry = MultiPolygon([geometry])

    return geometry.wkt


def geopackage_path() -> str:
    if GPKG_PATH.exists():
        return str(GPKG_PATH)

    if not GPKG_ZIP_PATH.exists():
        raise FileNotFoundError(f"Expected unzipped {GPKG_PATH} or zipped {GPKG_ZIP_PATH}")

    print(f"Extracting {GPKG_ZIP_PATH} -> {GPKG_PATH}", flush=True)
    with zipfile.ZipFile(GPKG_ZIP_PATH) as archive:
        archive.extract(GPKG_NAME, RAW_DIR)

    return str(GPKG_PATH)


def read_cvr_mapping() -> dict[int, str]:
    frame = pd.read_excel(CVR_MAPPING_PATH)
    anonym_column = "CVR_Anomyn"
    cvr_column = "CVR"

    if anonym_column is None or cvr_column is None:
        if len(frame.columns) < 2:
            raise ValueError("CVR mapping spreadsheet must contain at least two columns")
        anonym_column = str(frame.columns[0])
        cvr_column = str(frame.columns[1])

    cvr_by_anonym: dict[int, str] = {}
    for row in frame[[anonym_column, cvr_column]].itertuples(index=False):
        anonym_id = clean_int(row[0])
        cvr = clean_cvr(row[1])
        if anonym_id is None or cvr is None:
            continue
        cvr_by_anonym[anonym_id] = cvr

    return cvr_by_anonym


def read_nles_mapping() -> dict[int, tuple[str, dict[str, int | None]]]:
    """Map IMK_ID -> (Rot_vec string, crop_history of NLES-aggregated codes)."""
    columns = ["IMK_ID_2023", "Rot_vec", *(f"AgCropNr{str(year)[2:]}" for year in CROP_YEARS)]
    frame = pd.read_excel(NLES_MAPPING_PATH, usecols=columns)

    nles_by_imk: dict[int, tuple[str, dict[str, int | None]]] = {}
    for row in frame.itertuples(index=False):
        imk_id = clean_int(row.IMK_ID_2023)
        if imk_id is None:
            continue

        rot_vec = row.Rot_vec
        if pd.isna(rot_vec):
            rot_vec = ""

        crop_history = {
            str(year): clean_int(getattr(row, f"AgCropNr{str(year)[2:]}")) for year in CROP_YEARS
        }
        nles_by_imk[imk_id] = (str(rot_vec), crop_history)

    return nles_by_imk


def soil_id_from_flags(sand: object, clay: object) -> int | None:
    if clean_int(sand) == 10:
        return 10
    if clean_int(clay) == 20:
        return 20

    return None


def crop_history_from_row(row: object) -> dict[str, int | None]:
    return {str(year): clean_int(getattr(row, f"AgCropNr{str(year)[2:]}")) for year in CROP_YEARS}


def iter_registry_rows(
    cvr_by_anonym: dict[int, str],
    nles_by_imk: dict[int, tuple[str, dict[str, int | None]]],
    path: str,
    feature_count: int,
    reporter: ProgressReporter,
) -> Iterator[tuple[object, ...]]:
    columns = [
        "imk_id",
        "marknr",
        "imk_areal",
        "RedTot_pct",
        "Sand",
        "Clay",
        "JB_Kode",
        "CVR_Anonym",
        "InSkitse_1",
        "KystvandID",
    ]

    offset = 0
    scanned_count = 0
    loaded_count = 0
    while offset < feature_count:
        frame = read_dataframe(
            path,
            layer=GPKG_LAYER,
            columns=columns,
            skip_features=offset,
            max_features=BATCH_SIZE,
        )
        if frame.empty:
            break

        frame = gpd.GeoDataFrame(frame, geometry="geometry", crs=frame.crs).to_crs(4326)

        for row in frame.itertuples(index=False):
            scanned_count += 1
            imk_id = clean_int(row.imk_id)
            area_ha = clean_float(row.imk_areal)
            if imk_id is None or area_ha is None or area_ha <= 0 or row.geometry is None:
                reporter.tick(scanned_count, loaded_count)
                continue

            nles = nles_by_imk.get(imk_id)
            if nles is None:
                # GPKG row has no NLES mapping; drop it.
                reporter.tick(scanned_count, loaded_count)
                continue

            crop_rotation, crop_history = nles
            anonym_cvr = clean_int(row.CVR_Anonym)
            loaded_count += 1
            reporter.tick(scanned_count, loaded_count)

            yield (
                imk_id,
                cvr_by_anonym.get(anonym_cvr) if anonym_cvr is not None else None,
                clean_text(row.marknr),
                clean_int(row.KystvandID),
                clean_float(row.RedTot_pct),
                soil_id_from_flags(row.Sand, row.Clay),
                clean_int(row.JB_Kode),
                area_ha,
                crop_rotation,
                json.dumps(crop_history),
                clean_bool(row.InSkitse_1),
                to_multipolygon_wkt(row.geometry),
            )

        offset += BATCH_SIZE


def load_registry() -> None:
    if not CVR_MAPPING_PATH.exists():
        raise FileNotFoundError(f"Expected {CVR_MAPPING_PATH}")

    if not GPKG_PATH.exists() and not GPKG_ZIP_PATH.exists():
        raise FileNotFoundError(f"Expected unzipped {GPKG_PATH} or zipped {GPKG_ZIP_PATH}")

    if not NLES_MAPPING_PATH.exists():
        raise FileNotFoundError(f"Expected {NLES_MAPPING_PATH}")

    load_dotenv(ROOT.parent / ".env")
    print("Read svr mapping")
    cvr_by_anonym = read_cvr_mapping()
    print("Read nless mapping")
    nles_by_imk = read_nles_mapping()
    path = geopackage_path()
    feature_count = read_info(path, layer=GPKG_LAYER)["features"]
    reporter = ProgressReporter(feature_count)
    print(f"Reading registry from {path}", flush=True)
    dsn = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")
    loaded_count = 0

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute("TRUNCATE registry_field")
            cursor.execute(
                """
                CREATE TEMP TABLE registry_field_load (
                    imk_id bigint,
                    cvr text,
                    marknr text,
                    kystvand_id integer,
                    retention double precision,
                    soil_id integer,
                    jbnr smallint,
                    area_ha double precision,
                    crop_rotation text,
                    crop_history jsonb,
                    in_takeout_plan boolean,
                    geom_wkt text
                ) ON COMMIT DROP
                """
            )
            with cursor.copy(
                """
                COPY registry_field_load (
                    imk_id, cvr, marknr, kystvand_id, retention, soil_id, jbnr, area_ha,
                    crop_rotation, crop_history, in_takeout_plan, geom_wkt
                ) FROM STDIN WITH (FORMAT CSV)
                """
            ) as copy:
                for row in iter_registry_rows(
                    cvr_by_anonym,
                    nles_by_imk,
                    path,
                    feature_count,
                    reporter,
                ):
                    copy.write(csv_line(row))
                    loaded_count += 1

            reporter.tick(reporter.scanned, reporter.loaded, force=True)
            print("Inserting into registry_field...", flush=True)
            # udledningsgraense_kgn_ha/udledningskvote_mark_kgn are left at their
            # DB default (0) here — they come from a separate national layer, not
            # the IMK GeoPackage. Run load_udledningsgraenser.py after this to
            # (re)compute them.
            cursor.execute(
                """
                INSERT INTO registry_field (
                    imk_id, cvr, marknr, kystvand_id, retention, soil_id, jbnr, area_ha,
                    crop_rotation, crop_history, in_takeout_plan, geom,
                    centroid, sample_bucket
                )
                SELECT
                    imk_id,
                    cvr,
                    marknr,
                    kystvand_id,
                    retention,
                    soil_id,
                    jbnr,
                    area_ha,
                    crop_rotation,
                    crop_history,
                    in_takeout_plan,
                    ST_Multi(ST_GeomFromText(geom_wkt, 4326)),
                    ST_PointOnSurface(ST_GeomFromText(geom_wkt, 4326)),
                    (hashtext(imk_id::text) & 1023)
                FROM registry_field_load
                """
            )
        connection.commit()

    print(
        f"Loaded {loaded_count:,} registry fields in {format_duration(reporter.elapsed_seconds)}",
        flush=True,
    )


def csv_line(row: tuple[object, ...]) -> str:
    from io import StringIO

    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(row)
    return output.getvalue()


if __name__ == "__main__":
    load_registry()
