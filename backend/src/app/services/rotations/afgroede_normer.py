"""Database-backed crop norms and NUAR parameters.

The authoritative workbook is parsed by ``load_afgroede_normer.py`` during
administration. Runtime callers use only the expanded lookup tables here.
"""
from __future__ import annotations

from functools import lru_cache

from sqlalchemy import select

from app.data.db import (
    SessionLocal,
    afgroede_nfix_lookup_table,
    afgroede_norm_lookup_table,
    nuar_kode_table,
)

# Potatoes use M2 (Vårsæd) in NLES5 per the NUAR AU recommendation applicable
# from the 2027 regulation. W is not changed (typically W3). The rule always
# applies and overrides any other M values.
KARTOFFEL_KODER: frozenset = frozenset({149, 150, 151, 152, 154, 155, 156})

_VANDING_PRIORITY = {
    True: ["Vandet", "Ikke særskilt vanding", "Uvandet"],
    False: ["Uvandet", "Ikke særskilt vanding", "Vandet"],
}


def _missing_lookup(table_name: str, task_name: str) -> RuntimeError:
    return RuntimeError(f"{table_name} is empty; run pixi run {task_name}")


def apply_kartoffel_regel(sample: dict) -> dict:
    """Return the sample with M=2 for potato codes and other fields unchanged."""
    if sample.get("crop_code") in KARTOFFEL_KODER:
        return {**sample, "M": 2}
    return sample


@lru_cache(maxsize=1)
def _load_lang_lookup() -> dict[tuple[int, int, str], dict]:
    """Return the historic source-order-resolved norm lookup from PostgreSQL."""
    with SessionLocal() as session:
        rows = session.execute(
            select(afgroede_norm_lookup_table).order_by(
                afgroede_norm_lookup_table.c.source_order,
                afgroede_norm_lookup_table.c.jb_nr,
            )
        ).all()
    if not rows:
        raise _missing_lookup("afgroede_norm_lookup", "load-afgroede-normer")

    lookup: dict[tuple[int, int, str], dict] = {}
    # Assignment in source order deliberately preserves the previous workbook
    # behavior when conventional and organic rows share a lookup key.
    for row in rows:
        lookup[(row.afgroedekode, row.jb_nr, row.vanding)] = {
            "afgroede": row.afgroede,
            "jb_gruppe": row.jb_gruppe,
            "vanding": row.vanding,
            "udbytteenhed": row.udbytteenhed,
            "udbyttenorm": row.udbyttenorm,
            "udbyttenorm_alt": row.udbyttenorm_alt,
            "n_norm": row.n_norm,
            "p_norm": row.p_norm,
            "forfrugtsvaerdi": row.forfrugtsvaerdi,
            "indregn_ffv": row.indregn_ffv,
        }
    return lookup


@lru_cache(maxsize=1)
def _load_nfix_lookup() -> dict[tuple[int, int, str], float]:
    with SessionLocal() as session:
        rows = session.execute(
            select(afgroede_nfix_lookup_table).order_by(
                afgroede_nfix_lookup_table.c.source_order,
                afgroede_nfix_lookup_table.c.jb_nr,
            )
        ).all()
    if not rows:
        raise _missing_lookup("afgroede_nfix_lookup", "load-afgroede-normer")

    lookup: dict[tuple[int, int, str], float] = {}
    for row in rows:
        lookup[(row.afgroedekode, row.jb_nr, row.vanding)] = row.nfix_kgn_ha
    return lookup


@lru_cache(maxsize=1)
def _load_nuar_koder() -> dict[int, dict]:
    with SessionLocal() as session:
        rows = session.execute(
            select(nuar_kode_table).order_by(nuar_kode_table.c.afgroedekode),
        ).all()
    if not rows:
        raise _missing_lookup("nuar_kode", "load-afgroede-normer")
    return {
        row.afgroedekode: {
            "navn": row.navn,
            "M": row.m,
            "W": row.w,
            "WC": row.wc,
            "MP": row.mp,
            "WP": row.wp,
            "M_ambig": row.m_ambig,
            "W_ambig": row.w_ambig,
            "WC_ambig": row.wc_ambig,
            "MP_ambig": row.mp_ambig,
            "WP_ambig": row.wp_ambig,
        }
        for row in rows
    }


def clear_lookup_cache() -> None:
    """Clear process-local lookup caches after an administrative reload."""
    _load_lang_lookup.cache_clear()
    _load_nfix_lookup.cache_clear()
    _load_nuar_koder.cache_clear()


def lookup_norm(crop_code, jb_nr, irrigated: bool = False):
    """Return norm data for a crop/JB/irrigation combination, or ``None``."""
    if crop_code is None or jb_nr is None:
        return None
    lookup = _load_lang_lookup()
    for vanding in _VANDING_PRIORITY[bool(irrigated)]:
        result = lookup.get((crop_code, jb_nr, vanding))
        if result is not None:
            return result
    return None


def lookup_nfix(crop_code, jb_nr, irrigated: bool = False) -> float:
    """Return biological N fixation for a crop/JB/irrigation combination."""
    if crop_code is None or jb_nr is None:
        return 0.0
    lookup = _load_nfix_lookup()
    for vanding in _VANDING_PRIORITY[bool(irrigated)]:
        result = lookup.get((crop_code, jb_nr, vanding))
        if result is not None:
            return result
    return 0.0


def lookup_crop_params(crop_code):
    """Return NUAR parameters for ``crop_code``, or an empty mapping."""
    if crop_code is None:
        return {}
    return _load_nuar_koder().get(crop_code, {})


def crop_names_from_normer() -> dict[int, str]:
    """Return all NUAR crop names keyed by crop code."""
    return {code: info["navn"] for code, info in _load_nuar_koder().items()}
