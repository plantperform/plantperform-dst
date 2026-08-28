"""Load the historical (2025+2026 average) fertilizer distribution reference
(Bilag 3) into historisk_goedningsfordeling.

Source: database/data/raw/ANGJ-data/Historisk_goedningsfordeling_2025_og_2026_bilag3_lookup.csv
Columns: region, driftsform, afgroedekode, afgroede, jb_nr, n_type, vaerdi, kilde_side
  - n_type is 'mineralsk' (-> MNCS, the utilised/mineral N input) or
    'organisk' (-> G0, the organically bound N input).
  - region has 6 values (Øst- and Nordjylland combined as "Øst og Nordjylland"),
    one fewer than the 7-region goedningsregion column on registry_field —
    callers must collapse Østjylland/Nordjylland to that combined name when
    looking this table up.
"""

import csv
import time
from pathlib import Path

import psycopg
from dotenv import load_dotenv

from app.data.db import DATABASE_URL

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = (
    ROOT / "data" / "raw" / "ANGJ-data" / "Historisk_goedningsfordeling_2025_og_2026_bilag3_lookup.csv"
)


def format_duration(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    minutes, secs = divmod(total_seconds, 60)
    return f"{minutes}m{secs:02d}s" if minutes else f"{secs}s"


def load_historisk_goedningsfordeling() -> None:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"Expected {CSV_PATH}")

    load_dotenv(ROOT.parent / ".env")
    dsn = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    start = time.monotonic()
    print(f"Reading {CSV_PATH.name}...", flush=True)
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = [
            (
                row["region"],
                row["driftsform"],
                int(row["afgroedekode"]),
                int(row["jb_nr"]),
                row["n_type"],
                float(row["vaerdi"]),
            )
            for row in reader
        ]
    print(f"  {len(rows):,} rows", flush=True)

    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute("TRUNCATE historisk_goedningsfordeling RESTART IDENTITY")
            cursor.executemany(
                """
                INSERT INTO historisk_goedningsfordeling
                    (region, driftsform, afgroedekode, jb_nr, n_type, vaerdi)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                rows,
            )
        connection.commit()

    elapsed = time.monotonic() - start
    print(f"Loaded {len(rows):,} rows in {format_duration(elapsed)}", flush=True)


if __name__ == "__main__":
    load_historisk_goedningsfordeling()
