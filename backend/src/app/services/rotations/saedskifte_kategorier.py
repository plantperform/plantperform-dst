"""Sædskifte-kategorier — binder hver saedskiftevariant til én af 6 kategorier
(driftsform + gødningsniveau), porteret fra saedskifte_kategorier_uden_E_F.csv.

Kategori-nummereringen (`sædskifte_nr` i kildefilen) er BEKRÆFTET identisk med
`saedskiftevariant` i saedskifte_library.py (samme talintervaller: 1-36,
102-136, 201-247, 302-332, 402-432, 502-536) — ren join på talværdi, ingen
ID-oversættelse nødvendig.

`saedskiftevariant="1"` (ren brak) er pipe-separeret i kildefilen og hører
til alle 6 kategorier på én gang, da brak ikke kræver nogen gødning uanset
kategori.

KATEGORI_GODNING binder hver kategori til de gødningsparametre
candidate_evaluator.compute_n_inputs() skal bruge. Svinegylle/kvæggylle-
udnyttelsesprocenterne for de KONVENTIONELLE gylle-kategorier (150N/170N/80N)
er IKKE angivet i kildefilen (kun de to økologiske kategorier opgiver både
total og udnyttet N) — her bruges officielle danske standardsatser for
førsteårs-udnyttelse (kvæggylle 70%, svinegylle 75%), tilføjet som en
tydeligt mærket antagelse, ikke fra en kildefil.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import pandas as pd

_ROOT = Path(__file__).resolve().parents[4]  # .../backend
_CSV_PATH = _ROOT / "database" / "data" / "raw" / "ANGJ-data" / "saedskifte_kategorier_uden_E_F.csv"

KONVENTIONEL = "Konventionel"
OEKOLOGISK = "Økologisk"

# Kategorinavne, i kildefilens rækkefølge.
PLANTESAEDSKIFTER = "Plantesædskifter"
SVINEGYLLE_150 = "Sædskifter med svinegylle (150 N)"
KVAEGGYLLE_170 = "Sædskifter med kvæggylle (170 kg organisk N)"
OEKO_KVAEGGYLLE_107N = "Økologiske sædskifter med kvæggylle (107 N)"
OEKO_KVAEGGYLLE_65N = "Økologiske sædskifter med kvæggylle (65 N)"
SVINEGYLLE_80 = "Sædskifter med svinegylle (80 kg N)"

# {kategori: {org_mineral_n, mineralsk_andel_pct, only_organic, dyrkningssystem}}
# org_mineral_n = kg udnyttet N/ha organisk gødning (0 = ren kunstgødning).
# mineralsk_andel_pct = andel af org_mineral_n der regnes som straks-udnyttet
#   (resten går i G0-puljen). De to økologiske kategorier har eksakte tal fra
#   kildefilen (fx 107/139); de tre konventionelle gylle-kategorier bruger en
#   tilføjet standardantagelse (kvæggylle 70%, svinegylle 75%).
# only_organic = True betyder ingen handelsgødnings-optopning (økologisk regel).
KATEGORI_GODNING: dict[str, dict] = {
    PLANTESAEDSKIFTER: {
        "org_mineral_n": 0.0, "mineralsk_andel_pct": None,
        "only_organic": False, "dyrkningssystem": KONVENTIONEL,
    },
    SVINEGYLLE_150: {
        "org_mineral_n": 150.0, "mineralsk_andel_pct": 75.0,
        "only_organic": False, "dyrkningssystem": KONVENTIONEL,
    },
    KVAEGGYLLE_170: {
        "org_mineral_n": 170.0, "mineralsk_andel_pct": 70.0,
        "only_organic": False, "dyrkningssystem": KONVENTIONEL,
    },
    OEKO_KVAEGGYLLE_107N: {
        "org_mineral_n": 107.0, "mineralsk_andel_pct": 107.0 / 139.0 * 100.0,
        "only_organic": True, "dyrkningssystem": OEKOLOGISK,
    },
    OEKO_KVAEGGYLLE_65N: {
        "org_mineral_n": 65.0, "mineralsk_andel_pct": 65.0 / 80.0 * 100.0,
        "only_organic": True, "dyrkningssystem": OEKOLOGISK,
    },
    SVINEGYLLE_80: {
        "org_mineral_n": 80.0, "mineralsk_andel_pct": 75.0,
        "only_organic": False, "dyrkningssystem": KONVENTIONEL,
    },
}


@lru_cache(maxsize=1)
def _load() -> dict[str, list[str]]:
    """saedskiftevariant (str) -> liste af kategorinavne (normalt 1, "1" har alle 6)."""
    df = pd.read_csv(_CSV_PATH, dtype=str)
    result: dict[str, list[str]] = {}
    for _, row in df.iterrows():
        nr = str(row["sædskifte_nr"]).strip()
        kategorier = [k.strip() for k in str(row["kategori"]).split("|")]
        result[nr] = kategorier
    return result


@lru_cache(maxsize=1)
def _reverse() -> dict[str, list[str]]:
    """kategori -> liste af saedskiftevariant-værdier."""
    reverse: dict[str, list[str]] = {k: [] for k in KATEGORI_GODNING}
    for nr, kategorier in _load().items():
        for kategori in kategorier:
            reverse.setdefault(kategori, []).append(nr)
    return reverse


def list_kategorier() -> list[str]:
    """De 6 kategorinavne, i kildefilens rækkefølge."""
    return list(KATEGORI_GODNING.keys())


def kategorier_for_saedskifte(saedskiftevariant: str) -> list[str]:
    """Hvilke(n) kategori(er) en given saedskiftevariant hører til."""
    return _load().get(str(saedskiftevariant), [])


def saedskifter_for_kategori(kategori: str) -> list[str]:
    """Alle saedskiftevariant-værdier der hører til en given kategori."""
    return _reverse().get(kategori, [])


def dyrkningssystem_for_kategori(kategori: str) -> str:
    return KATEGORI_GODNING[kategori]["dyrkningssystem"]
