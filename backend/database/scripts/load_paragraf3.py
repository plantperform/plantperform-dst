"""Load the national Paragraf3 (protected-nature) polygon layer from
geodata.fvm.dk's public WFS into the permanent paragraf3_omraade table (so it
can be served as its own map layer via /api/v0/paragraf3/tiles — same
pattern as mars_projekt/load_mars_projekter.py), then set each registry
field's paragraf3_natyp from every §3-area touching the field — a field
touching several nature types gets all their distinct names comma-separated
(e.g. "Eng, Mose"), verbatim from the source, mirroring the
omlaegningsplan_virkemiddel pattern in load_mars_projekter.py. Fields
touching no §3-area keep NULL.

This is the first WFS-sourced loader (proof of concept for auto-refreshing
overlay layers instead of manually delivered files, see wfs_source.py) and
only ever writes to paragraf3_omraade and registry_field.paragraf3_natyp —
it never touches geometry, imk_id, crop history, or any other core identity
field, so a bad run here cannot corrupt the rest of the registry.

Source: geodata.fvm.dk WFS, workspace "Paragraf3", layer
"Paragraf3_i_IMK_<year>" (EPSG:25832, ~121,000 polygons as of 2026, column
"NATYP_NAVN", e.g. "Eng", "Mose", "Overdrev"). The year is resolved to the
newest one available at run time, not hardcoded.
"""

import csv
import time
from io import StringIO
from pathlib import Path

import geopandas as gpd
import httpx
import psycopg
from dotenv import load_dotenv
from shapely.geometry import MultiPolygon, Polygon

from app.data.db import DATABASE_URL
from database.scripts.wfs_source import fetch_wfs_features, resolve_latest_typename

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = "Paragraf3"
NAME_PREFIX = "Paragraf3_i_IMK_"
TABLE = "paragraf3_omraade"


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


def load_paragraf3_table(dsn: str) -> str:
    with httpx.Client() as client:
        typename = resolve_latest_typename(client, WORKSPACE, NAME_PREFIX)
        print(f"Fetching {typename} from geodata.fvm.dk WFS...", flush=True)
        start = time.monotonic()
        rows = fetch_wfs_features(client, typename, ["NATYP_NAVN"])
    elapsed = format_duration(time.monotonic() - start)
    print(f"Fetched {len(rows):,} features in {elapsed}", flush=True)

    frame = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:25832").to_crs(4326)

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"TRUNCATE {TABLE}")
            with cursor.copy(
                f"COPY {TABLE} (fid, natyp_navn, geom) FROM STDIN WITH (FORMAT CSV)"
            ) as copy:
                loaded = 0
                for row in frame.itertuples(index=False):
                    if row.geometry is None:
                        continue
                    copy.write(
                        csv_line(
                            (
                                row.fid,
                                row.NATYP_NAVN,
                                f"SRID=4326;{to_multipolygon_wkt(row.geometry)}",
                            )
                        )
                    )
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
    return typename


def set_paragraf3_natyp(dsn: str) -> None:
    print("Setting paragraf3_natyp on fields touching a §3-area...", flush=True)
    start = time.monotonic()
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                WITH touching_pairs AS (
                    SELECT DISTINCT rf.imk_id, s.natyp_navn
                    FROM registry_field rf
                    JOIN {TABLE} s ON ST_Intersects(rf.geom, s.geom)
                    WHERE ST_Area(ST_Intersection(rf.geom, s.geom)) > 0
                ),
                aggregated AS (
                    SELECT imk_id,
                        STRING_AGG(DISTINCT natyp_navn, ', ' ORDER BY natyp_navn) AS natyp
                    FROM touching_pairs
                    GROUP BY imk_id
                )
                UPDATE registry_field rf
                SET paragraf3_natyp = aggregated.natyp
                FROM aggregated
                WHERE rf.imk_id = aggregated.imk_id
                """
            )
            updated = cursor.rowcount
        connection.commit()
    elapsed = format_duration(time.monotonic() - start)
    print(f"Updated {updated:,} registry fields in {elapsed}", flush=True)


def load_paragraf3() -> None:
    load_dotenv(ROOT.parent / ".env")
    dsn = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    typename = load_paragraf3_table(dsn)
    set_paragraf3_natyp(dsn)
    print(f"Done ({typename}).", flush=True)


if __name__ == "__main__":
    load_paragraf3()
