"""Load the MARS (Miljø- og Arealprojekter) subsidy-project polygon layer
into the permanent mars_projekt table (served as its own map layer via
/api/v0/mars/tiles), then set each registry field's
omlaegningsplan_virkemiddel / omlaegningsplan_status from every MARS project
touching the field (whole or partial overlap) — a field touching several
projects gets all their distinct virkemiddel/status values comma-separated,
verbatim from the source (e.g. "Skovrejsning, Vådområdeprojekter"), not a
single dominant pick. Fields touching no MARS project keep NULL in both
columns.

Also mirrors the (comma-joined) virkemiddel string into the pre-existing
registry_field.in_takeout_plan slot ("omlægningsplan" in the UI, first-pass
repurposed from a plain ja/nej boolean to carry this text directly — see
migration 20260827_0005). Fields with no MARS project keep in_takeout_plan
at its "nej" default from load_dataimk2026.py.

Source: Mars_data.gpkg, layer "marsprojekter_samlet" (EPSG:25832, 1,666
polygons).
"""

import csv
import time
from io import StringIO
from pathlib import Path

import geopandas as gpd
import pandas as pd
import psycopg
from dotenv import load_dotenv
from pyogrio import read_dataframe
from shapely.geometry import MultiPolygon, Polygon

from app.data.db import DATABASE_URL

ROOT = Path(__file__).resolve().parents[1]
GPKG_PATH = ROOT / "data" / "raw" / "ANGJ-data" / "Marker 24-25-25" / "Mars_data.gpkg"
LAYER = "marsprojekter_samlet"
TABLE = "mars_projekt"

COLUMNS = [
    "mars_id",
    "titel",
    "sags_id",
    "areal_ha",
    "tilskudsordning",
    "status",
    "ansoeger",
    "ansoegningsrunde_aar",
    "kvaelstofeffekt_t",
    "udtagningseffekt_ha",
    "skovrejsningseffekt_ha",
    "virkemiddel",
    "bemaerkning",
]


def to_multipolygon_wkt(geometry: Polygon | MultiPolygon) -> str:
    if isinstance(geometry, Polygon):
        geometry = MultiPolygon([geometry])
    return geometry.wkt


def csv_line(row: tuple[object, ...]) -> str:
    output = StringIO()
    csv.writer(output).writerow(row)
    return output.getvalue()


def clean_str(value: object) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    return str(value)


def clean_float(value: object) -> float | None:
    if value is None or pd.isna(value):
        return None
    return float(value)


def format_duration(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def load_mars_table(dsn: str) -> None:
    frame = read_dataframe(str(GPKG_PATH), layer=LAYER, columns=COLUMNS)
    frame = gpd.GeoDataFrame(frame, geometry="geometry", crs=frame.crs).to_crs(4326)
    print(f"Loading {len(frame):,} MARS projects into {TABLE}", flush=True)

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"TRUNCATE {TABLE}")
            with cursor.copy(
                f"COPY {TABLE} ({', '.join(COLUMNS)}, geom) FROM STDIN WITH (FORMAT CSV)"
            ) as copy:
                loaded = 0
                for row in frame.itertuples(index=False):
                    if row.geometry is None:
                        continue
                    geom_wkt = f"SRID=4326;{to_multipolygon_wkt(row.geometry)}"
                    values = (
                        clean_str(row.mars_id),
                        clean_str(row.titel),
                        clean_str(row.sags_id),
                        clean_float(row.areal_ha),
                        clean_str(row.tilskudsordning),
                        clean_str(row.status),
                        clean_str(row.ansoeger),
                        int(row.ansoegningsrunde_aar),
                        clean_float(row.kvaelstofeffekt_t),
                        clean_float(row.udtagningseffekt_ha),
                        clean_float(row.skovrejsningseffekt_ha),
                        clean_str(row.virkemiddel),
                        clean_str(row.bemaerkning),
                    )
                    copy.write(csv_line((*values, geom_wkt)))
                    loaded += 1
            print(f"Loaded {loaded:,} rows, repairing invalid geometries...", flush=True)
            cursor.execute(
                f"""UPDATE {TABLE}
                    SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
                    WHERE NOT ST_IsValid(geom)"""
            )
            print(f"  repaired {cursor.rowcount:,} rows", flush=True)
            cursor.execute(f"ANALYZE {TABLE}")
        connection.commit()


def compute_mars_overlap(dsn: str) -> None:
    print("Computing MARS project overlap onto registry_field...", flush=True)
    start = time.monotonic()

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                WITH touching_pairs AS (
                    SELECT DISTINCT rf.imk_id, s.virkemiddel, s.status
                    FROM registry_field rf
                    JOIN {TABLE} s ON ST_Intersects(rf.geom, s.geom)
                    WHERE ST_Area(ST_Intersection(rf.geom, s.geom)) > 0
                ),
                aggregated AS (
                    SELECT
                        imk_id,
                        STRING_AGG(DISTINCT virkemiddel, ', ' ORDER BY virkemiddel) AS virkemiddel,
                        STRING_AGG(DISTINCT status, ', ' ORDER BY status) AS status
                    FROM touching_pairs
                    GROUP BY imk_id
                )
                UPDATE registry_field rf
                SET omlaegningsplan_virkemiddel = aggregated.virkemiddel,
                    omlaegningsplan_status = aggregated.status,
                    in_takeout_plan = aggregated.virkemiddel
                FROM aggregated
                WHERE rf.imk_id = aggregated.imk_id
                """
            )
            updated = cursor.rowcount
        connection.commit()

    elapsed = time.monotonic() - start
    print(f"Updated {updated:,} registry fields in {format_duration(elapsed)}", flush=True)


def load_mars_projekter() -> None:
    if not GPKG_PATH.exists():
        raise FileNotFoundError(f"Expected {GPKG_PATH}")

    load_dotenv(ROOT.parent / ".env")
    dsn = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    load_mars_table(dsn)
    compute_mars_overlap(dsn)


if __name__ == "__main__":
    load_mars_projekter()
