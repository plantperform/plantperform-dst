"""Sædskifte categories mapping every saedskiftevariant to one of four
categories (driftsform + gødning level), read directly from the "Sammenlagt
kategori" column in saedskifte_library (Ny_sædskifte_lookup_sammenlagt.csv,
2026-09-02). This replaces the former separate
saedskifte_kategorier_uden_E_F.csv with six categories, which is retired. The
source file consolidated its six old categories into four by removing N-norm%
variants (for example, "Økologiske sædskifter med kvæggylle (107 N)" and
"...(65 N)" are now both "Øko samlet") and grouping the two konventionelle
svinegylle levels (150 N/80 N) under "Konv. svin samlet".

saedskiftevariant="1" (pure brak) belongs to all four categories at once, as in
the old CSV, because brak requires no gødning regardless of category.

KATEGORI_GODNING maps each category to the gødning parameters required by
candidate_evaluator.compute_n_inputs() as PRESET defaults. They remain freely
adjustable in the UI, in line with Phase 13's complete decoupling of gødning
selection from sædskifte selection; see GodningSettings.

The two consolidated categories ("Konv. svin samlet", "Øko samlet") have lost
their previous level subdivision in the source data itself. The Husdyr-gødning
kg N/ha column is empty for every consolidated row (verified 2026-09-02), so no
source value remains to choose between. The previous HIGHEST level in each pair
is used as the preset default (150 for pigs, 107 for økologisk), because the lower
level is effectively available through the scenarie's own N-norm% selector.
For example, økologisk 65N ≈ 107N × 61%, close to the existing 60% N-norm% value.
This is an intentional simplification, not a new source value.

The svinegylle/kvæggylle utilization percentages for the konventionelle gylle
categories remain absent from every source file. The same official Danish
standard first-year utilization rates as before are reused (kvæggylle 70%,
svinegylle 75%), explicitly identified as an assumption.
"""
from __future__ import annotations

from functools import lru_cache

from app.services.rotations import saedskifte_library

KONVENTIONEL = "Konventionel"
OEKOLOGISK = "Økologisk"

# Category names as they appear in the source file's "Sammenlagt kategori" column.
PLANTE = "Plante"
KONV_SVIN_SAMLET = "Konv. svin samlet"
KONV_KVAEG = "Konv. kvæg"
OEKO_SAMLET = "Øko samlet"

# {kategori: {org_mineral_n, mineralsk_andel_pct, only_organic, dyrkningssystem}}
# org_mineral_n = kg utilized N/ha from organisk gødning (0 = pure kunstgødning).
# mineralsk_andel_pct = share of org_mineral_n considered immediately utilized
#   (the remainder enters the G0 pool).
# only_organic = True means no handelsgødning top-up (økologisk rule).
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
    """Map kategori to numerically sorted saedskiftevariant values."""
    reverse: dict[str, list[str]] = {k: [] for k in KATEGORI_GODNING}
    for nr in saedskifte_library.list_saedskifter():
        for kategori in saedskifte_library.get_kategori(nr):
            reverse.setdefault(kategori, []).append(nr)
    for nr_list in reverse.values():
        nr_list.sort(key=int)
    return reverse


def list_kategorier() -> list[str]:
    """Return the four category names."""
    return list(KATEGORI_GODNING.keys())


def kategorier_for_saedskifte(saedskiftevariant: str) -> list[str]:
    """Return the categories to which a saedskiftevariant belongs."""
    return saedskifte_library.get_kategori(saedskiftevariant)


def saedskifter_for_kategori(kategori: str) -> list[str]:
    """Return every saedskiftevariant value belonging to a kategori."""
    return _reverse().get(kategori, [])


def dyrkningssystem_for_kategori(kategori: str) -> str:
    return KATEGORI_GODNING[kategori]["dyrkningssystem"]
