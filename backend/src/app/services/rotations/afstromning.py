"""Afstrømningskategori pr. afgrødekode, jf. Bilag 7 tabel 1 til
bekendtgørelse om udledningsbaseret markregulering:

  "Afstrømningskategorien fastsættes på grundlag af afstrømningsafgrøden,
  der er markens hovedafgrøde. Afstrømningskategorien følger af bilag 7,
  tabel 1."

Loader direkte fra kilde-CSV'en (samme load-once-fra-fil-mønster som
historisk_goedning/afgroede_normer) — Bilag_1_tabel_1_med_P_noegle.csv
dækker alle 323 afgrødekoder med ingen huller (verificeret), så der er
ingen "estimeret"/gættet fallback-liste længere — kun en (sjælden, i
praksis ikke-forekommende) "ukendt" tilstand for en afgrødekode filen
slet ikke indeholder, fx en helt ny kode tilføjet efter denne fil.

Hver afgrødekode har en standard-afstrømningskategori (1-8), og for en
del afgrøder også en alternativ kategori der gælder når marken samme år
får et vinterdække-ændrende virkemiddel (EEA/efterafgrøde, mellemafgrøde,
tidlig såning) — "P_afstrømningskategori_med_W" i kilden. Kategorien
bestemmer hvilken af de 8 P-værdier (jf. services.soil.percolation_
placeholder, midlertidigt ét fælles sæt for alle marker) der skal bruges.
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
    """Return afstrømningskategori (1-8) for crop_code, eller None hvis
    afgrødekoden ikke findes i kilden overhovedet (bør i praksis ikke ske,
    da alle 323 koder er dækket).

    Bruger alt_kategori når `eea_on` er True (marken har efterafgrøde/
    virkemiddel der ændrer vinterdækket det år) og en alt_kategori findes
    for afgrøden — ellers standard_kategori.
    """
    entry = _load().get(crop_code) if crop_code is not None else None
    if entry is None:
        return None
    base, alt = entry
    if eea_on and alt is not None:
        return alt
    return base
