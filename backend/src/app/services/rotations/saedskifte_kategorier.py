"""Sædskifte-kategorier — binder hver saedskiftevariant til én af 4
kategorier (driftsform + gødningsniveau), læst direkte fra
saedskifte_library's "Sammenlagt kategori"-kolonne (Ny_sædskifte_lookup_
sammenlagt.csv, 2026-09-02). Erstatter den tidligere separate
saedskifte_kategorier_uden_E_F.csv (6 kategorier), som er UDGÅET —
kildefilen selv har konsolideret dens gamle 6 kategorier ned til 4 ved at
fjerne N-norm%-varianter (fx "Økologiske sædskifter med kvæggylle (107 N)"
og "...(65 N)" er nu begge "Øko samlet") og gruppere de to konventionelle
svinegylle-niveauer (150 N/80 N) under ét "Konv. svin samlet".

saedskiftevariant="1" (ren brak) hører til alle 4 kategorier på én gang,
ligesom i den gamle CSV — brak kræver ingen gødning uanset kategori.

KATEGORI_GODNING binder hver kategori til de gødningsparametre
candidate_evaluator.compute_n_inputs() skal bruge, som PRESET-standardværdier
(altid frit justerbare bagefter i UI'en, jf. Fase 13's fulde afkobling af
gødningsvalg fra sædskiftevalg — se GodningSettings).

De to konsoliderede kategorier ("Konv. svin samlet", "Øko samlet") har
MISTET deres tidligere niveau-opdeling i selve kildedata (Husdyr-gødning
kg N/ha-kolonnen er tom for alle konsoliderede rækker, verificeret
2026-09-02) — der er derfor IKKE længere et kildetal at vælge mellem. Her
bruges det tidligere HØJESTE niveau i hvert par som preset-standard (150 for
svin, 107 for øko), med den begrundelse at det lavere niveau i praksis
allerede er nået via scenariets egen N-norm%-vælger (fx svarer økologisk
65N ≈ 107N × 61 %, tæt på den eksisterende 60 %-værdi i N-norm%-listen) —
IKKE en ny kildeværdi, en bevidst forenkling.

Svinegylle/kvæggylle-udnyttelsesprocenterne for de KONVENTIONELLE
gylle-kategorier er fortsat IKKE angivet i nogen kildefil — her genbruges
samme officielle danske standardsatser for førsteårs-udnyttelse som før
(kvæggylle 70 %, svinegylle 75 %), en tydeligt mærket antagelse.
"""
from __future__ import annotations

from functools import lru_cache

from app.services.rotations import saedskifte_library

KONVENTIONEL = "Konventionel"
OEKOLOGISK = "Økologisk"

# Kategorinavne, som de forekommer i kildefilens "Sammenlagt kategori"-kolonne.
PLANTE = "Plante"
KONV_SVIN_SAMLET = "Konv. svin samlet"
KONV_KVAEG = "Konv. kvæg"
OEKO_SAMLET = "Øko samlet"

# {kategori: {org_mineral_n, mineralsk_andel_pct, only_organic, dyrkningssystem}}
# org_mineral_n = kg udnyttet N/ha organisk gødning (0 = ren kunstgødning).
# mineralsk_andel_pct = andel af org_mineral_n der regnes som straks-udnyttet
#   (resten går i G0-puljen).
# only_organic = True betyder ingen handelsgødnings-optopning (økologisk regel).
KATEGORI_GODNING: dict[str, dict] = {
    PLANTE: {
        "org_mineral_n": 0.0, "mineralsk_andel_pct": None,
        "only_organic": False, "dyrkningssystem": KONVENTIONEL,
    },
    KONV_SVIN_SAMLET: {
        "org_mineral_n": 150.0, "mineralsk_andel_pct": 75.0,
        "only_organic": False, "dyrkningssystem": KONVENTIONEL,
    },
    KONV_KVAEG: {
        "org_mineral_n": 170.0, "mineralsk_andel_pct": 70.0,
        "only_organic": False, "dyrkningssystem": KONVENTIONEL,
    },
    OEKO_SAMLET: {
        "org_mineral_n": 107.0, "mineralsk_andel_pct": 107.0 / 139.0 * 100.0,
        "only_organic": True, "dyrkningssystem": OEKOLOGISK,
    },
}


@lru_cache(maxsize=1)
def _reverse() -> dict[str, list[str]]:
    """kategori -> liste af saedskiftevariant-værdier, sorteret numerisk."""
    reverse: dict[str, list[str]] = {k: [] for k in KATEGORI_GODNING}
    for nr in saedskifte_library.list_saedskifter():
        for kategori in saedskifte_library.get_kategori(nr):
            reverse.setdefault(kategori, []).append(nr)
    for nr_list in reverse.values():
        nr_list.sort(key=int)
    return reverse


def list_kategorier() -> list[str]:
    """De 4 kategorinavne."""
    return list(KATEGORI_GODNING.keys())


def kategorier_for_saedskifte(saedskiftevariant: str) -> list[str]:
    """Hvilke(n) kategori(er) en given saedskiftevariant hører til."""
    return saedskifte_library.get_kategori(saedskiftevariant)


def saedskifter_for_kategori(kategori: str) -> list[str]:
    """Alle saedskiftevariant-værdier der hører til en given kategori."""
    return _reverse().get(kategori, [])


def dyrkningssystem_for_kategori(kategori: str) -> str:
    return KATEGORI_GODNING[kategori]["dyrkningssystem"]
