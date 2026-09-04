"""Sæt registry_field.kvotegivende ud fra markens 2026-afgrødekode og Bilag 1
tabel 1's "Kvotegivende areal" ja/nej-liste.

Source: database/data/raw/ANGJ-data/Bilag_1_tabel_1_Kvotegivende_areal_og_aktivitet.csv
Columns: Afgrødekode, Navn, Kvotegivende aktivitet, Kvotegivende areal

Bruger bevidst "Kvotegivende areal"-kolonnen, ikke "Kvotegivende aktivitet"
(de er identiske for 322 af 323 koder; afgrødekode 271 "Rekreative formål"
er den eneste forskel — areal=Ja, aktivitet=Nej).

Marker uden en 2026-afgrødekode (crop_history mangler nøglen, eller
lookuplisten ikke dækker koden) sættes til kvotegivende=false.

Nulstiller desuden udledningskvote_mark_kgn til 0 for alle ikke-kvotegivende
marker — et sådant areal bidrager intet til en bedrifts udledningskvote.
"""

import csv
import time
from pathlib import Path

import psycopg
from dotenv import load_dotenv

from app.data.db import DATABASE_URL

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = (
    ROOT / "data" / "raw" / "ANGJ-data" / "Bilag_1_tabel_1_Kvotegivende_areal_og_aktivitet.csv"
)


def format_duration(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    minutes, secs = divmod(total_seconds, 60)
    return f"{minutes}m{secs:02d}s" if minutes else f"{secs}s"


def load_kvotegivende_areal() -> None:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"Expected {CSV_PATH}")

    load_dotenv(ROOT.parent / ".env")
    dsn = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    print(f"Reading {CSV_PATH.name}...", flush=True)
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        kvotegivende_codes = [
            int(row["Afgrødekode"]) for row in reader if row["Kvotegivende areal"].strip() == "Ja"
        ]
    print(f"  {len(kvotegivende_codes):,} kvotegivende afgrødekoder", flush=True)

    start = time.monotonic()
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE registry_field
                SET kvotegivende = (crop_history->>'2026')::int = ANY(%s)
                WHERE (crop_history->>'2026') IS NOT NULL
                """,
                (kvotegivende_codes,),
            )
            matched = cursor.rowcount
            cursor.execute(
                """
                UPDATE registry_field
                SET kvotegivende = false
                WHERE (crop_history->>'2026') IS NULL
                """
            )
            unmatched = cursor.rowcount

            # Et ikke-kvotegivende areal bidrager intet til udledningskvoten —
            # nulstil den fysiske kvote for disse marker, så den ikke fejlagtigt
            # viser areal × udledningsgrænse for et areal der reelt ikke
            # tæller med (både i kortvisning og i farmens samlede kvote).
            cursor.execute(
                "UPDATE registry_field SET udledningskvote_mark_kgn = 0 WHERE kvotegivende = false"
            )
            zeroed = cursor.rowcount
        connection.commit()

    elapsed = time.monotonic() - start
    print(
        f"Set kvotegivende for {matched:,} fields with a 2026 crop, "
        f"{unmatched:,} without one defaulted to false, "
        f"{zeroed:,} non-kvotegivende fields' udledningskvote zeroed, "
        f"in {format_duration(elapsed)}",
        flush=True,
    )


if __name__ == "__main__":
    load_kvotegivende_areal()
