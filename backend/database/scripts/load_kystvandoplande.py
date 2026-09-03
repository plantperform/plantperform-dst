"""Load the national Kystvandoplande (coastal-water-catchment) polygon layer
into a staging table, then set each registry field's kystvand_id/kystvand_navn
to the catchment covering the LARGEST share of the field's area
(dominant-overlap — catchment boundaries don't meaningfully split a single
field the way the udledningsgraense/jordbundskort layers do, so a plain
lookup is enough here).

Source: Kystvandoplande_VP3_II_2025.shp (EPSG:25832, 545 polygons, columns
"KystvandID" and "KystvandNa" — the catchment's real name, e.g. "Sejerø
Bugt", used only to label the udledningskvote-per-kystvandopland breakdown;
never loaded before this).
"""

import csv
import time
from io import StringIO
from pathlib import Path

import geopandas as gpd
import psycopg
from dotenv import load_dotenv
from pyogrio import read_dataframe
from shapely.geometry import MultiPolygon, Polygon

from app.data.db import DATABASE_URL

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw" / "ANGJ-data" / "Marker 24-25-25" / "Kystvandoplande"
SHP_PATH = RAW_DIR / "Kystvandoplande_VP3_II_2025.shp"
STAGING_TABLE = "kystvandoplande_load"


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


def load_staging_table(dsn: str) -> None:
    frame = read_dataframe(str(SHP_PATH), columns=["KystvandID", "KystvandNa"])
    frame = gpd.GeoDataFrame(frame, geometry="geometry", crs=frame.crs).to_crs(4326)
    print(f"Loading {len(frame):,} Kystvandoplande polygons into staging", flush=True)

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {STAGING_TABLE}")
            cursor.execute(
                f"""
                CREATE TABLE {STAGING_TABLE} (
                    kystvand_id integer NOT NULL,
                    kystvand_navn text,
                    geom geometry(MULTIPOLYGON, 4326) NOT NULL
                )
                """
            )
            with cursor.copy(
                f"COPY {STAGING_TABLE} (kystvand_id, kystvand_navn, geom) "
                "FROM STDIN WITH (FORMAT CSV)"
            ) as copy:
                loaded = 0
                for row in frame.itertuples(index=False):
                    if row.geometry is None or row.KystvandID is None:
                        continue
                    copy.write(
                        csv_line(
                            (
                                int(row.KystvandID),
                                row.KystvandNa,
                                f"SRID=4326;{to_multipolygon_wkt(row.geometry)}",
                            )
                        )
                    )
                    loaded += 1
            print(f"Loaded {loaded:,} rows, repairing invalid geometries...", flush=True)
            cursor.execute(
                f"""UPDATE {STAGING_TABLE}
                    SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
                    WHERE NOT ST_IsValid(geom)"""
            )
            print(f"  repaired {cursor.rowcount:,} rows, building spatial index...", flush=True)
            cursor.execute(
                f"CREATE INDEX ix_{STAGING_TABLE}_geom ON {STAGING_TABLE} USING gist (geom)"
            )
            cursor.execute(f"ANALYZE {STAGING_TABLE}")
        connection.commit()


def compute_dominant_kystvand_id(dsn: str) -> None:
    print("Computing dominant-overlap kystvand_id/kystvand_navn onto registry_field...", flush=True)
    start = time.monotonic()

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                WITH overlap_candidates AS (
                    SELECT
                        rf.imk_id,
                        s.kystvand_id,
                        s.kystvand_navn,
                        ST_Area(ST_Intersection(rf.geom, s.geom)) AS overlap_area
                    FROM registry_field rf
                    JOIN {STAGING_TABLE} s ON ST_Intersects(rf.geom, s.geom)
                ),
                best AS (
                    SELECT DISTINCT ON (imk_id) imk_id, kystvand_id, kystvand_navn
                    FROM overlap_candidates
                    WHERE overlap_area > 0
                    ORDER BY imk_id, overlap_area DESC
                )
                UPDATE registry_field rf
                SET kystvand_id = best.kystvand_id, kystvand_navn = best.kystvand_navn
                FROM best
                WHERE rf.imk_id = best.imk_id
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


def load_kystvandoplande(*, keep_staging: bool = False) -> None:
    if not SHP_PATH.exists():
        raise FileNotFoundError(f"Expected {SHP_PATH}")

    load_dotenv(ROOT.parent / ".env")
    dsn = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    load_staging_table(dsn)
    compute_dominant_kystvand_id(dsn)
    if not keep_staging:
        drop_staging_table(dsn)


if __name__ == "__main__":
    load_kystvandoplande()
