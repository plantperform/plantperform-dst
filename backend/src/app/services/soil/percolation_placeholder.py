"""Midlertidigt, globalt P/S/NT-placeholder-sæt til NLES5-motoren.

Rigtige per-mark P/S-værdier (perkolation, jf. Bilag 7 afstrømningskategori)
findes endnu ikke i DST2 — de kommer på markniveau senere. Indtil da bruges
ét fast sæt for alle marker/afgrøder, fodret ind via `engine.py`'s
eksisterende `P_override`/`S_override`-mekanisme (IKKE den AAa/AAb/APb-
afledte formel, som er `bridge.py`s forældede parameterisering).

Alle otte P-værdier (én pr. afstrømningskategori 1-8, jf. Bilag 7) ligger
tæt (~0,26-0,28), så valget af kategori er uden stor praktisk betydning i
denne omgang — der bruges kategori 1 som vilkårlig default.
"""
from __future__ import annotations

S = 0.9919
NT = 3.0
_P_BY_KATEGORI: dict[int, float] = {
    1: 0.275,
    2: 0.258,
    3: 0.278,
    4: 0.265,
    5: 0.277,
    6: 0.281,
    7: 0.271,
    8: 0.276,
}
_DEFAULT_KATEGORI = 1


def percolation_placeholder(afstromningskategori: int = _DEFAULT_KATEGORI) -> dict:
    """Return {"P_override", "S_override", "NT"} til brug i en NLES5 sample-dict."""
    return {
        "P_override": _P_BY_KATEGORI.get(afstromningskategori, _P_BY_KATEGORI[_DEFAULT_KATEGORI]),
        "S_override": S,
        "NT": NT,
    }
