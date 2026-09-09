"""Afstrømningskategori per afgrødekode under Bilag 7, table 1 of the
bekendtgørelse on udledningsbaseret markregulering:

  English translation: "The afstrømningskategori is determined from the
  afstrømningsafgrøde, which is the mark's hovedafgrøde. The
  afstrømningskategori follows from Bilag 7, table 1."

Loads directly from the source CSV using the same load-once-from-file pattern
as historisk_goedning/afgroede_normer. Bilag_1_tabel_1_med_P_noegle.csv covers
all 323 afgrødekoder without gaps (verified), so there is no longer an
"estimated"/guessed fallback list. The only remaining "unknown" state is the
rare, effectively nonexistent case of an afgrødekode absent from the file,
such as a new code added after the file was created.

Each afgrødekode has a default afstrømningskategori (1-8). Some afgrøder also
have an alternative category that applies when the mark receives a
winter-cover-changing virkemiddel in the same year (EEA/efterafgrøde,
mellemafgrøde, early sowing), represented by
"P_afstrømningskategori_med_W" in the source. The category determines which of
the mark's eight P values is used.
"""
from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

_CSV_PATH = (
    Path(__file__).resolve().parents[4]
    / "database"
    / "data"
    / "raw"
    / "ANGJ-data"
    / "Bilag_1_tabel_1_med_P_noegle.csv"
)


@lru_cache(maxsize=1)
def _load() -> dict[int, tuple[int, int | None]]:
    lut: dict[int, tuple[int, int | None]] = {}
    with _CSV_PATH.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=";"):
            code = int(row["Afgrødekode"])
            base = int(float(row["P_afstrømningskategori"]))
            alt_raw = row["P_afstrømningskategori_med_W"].strip()
            alt = int(float(alt_raw)) if alt_raw else None
            lut[code] = (base, alt)
    return lut


def afstromningskategori(crop_code: int | None, eea_on: bool = False) -> int | None:
    """Return afstrømningskategori (1-8), or None if crop_code is absent.

    Absence should not occur in practice because all 323 codes are covered.
    Uses alt_kategori when `eea_on` is True (the mark has an efterafgrøde or
    another virkemiddel changing winter cover that year) and the afgrøde has an
    alt_kategori; otherwise uses standard_kategori.
    """
    entry = _load().get(crop_code) if crop_code is not None else None
    if entry is None:
        return None
    base, alt = entry
    if eea_on and alt is not None:
        return alt
    return base
