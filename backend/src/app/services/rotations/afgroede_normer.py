"""Database-backed crop norms and per-code crop parameters."""

from __future__ import annotations

from functools import lru_cache

from sqlalchemy import select

from app.data.db import (
    SessionLocal,
    afgroede_nfix_lookup_table,
    afgroede_norm_lookup_table,
    afgroede_table,
)

# Potatoes use M2 (Vårsæd) in NLES5 per the NUAR AU recommendation applicable
# from the 2027 regulation. W is not changed (typically W3). The rule always
# applies and overrides any other M values.
KARTOFFEL_KODER: frozenset = frozenset({149, 150, 151, 152, 154, 155, 156})

_VANDING_PRIORITY = {
    True: ["Vandet", "Ikke særskilt vanding", "Uvandet"],
    False: ["Uvandet", "Ikke særskilt vanding", "Vandet"],
}

# Most afgrødekoder only have a "Konventionel" row (no separate økologisk norm
# published for them), so a request for the økologisk norm still needs to fall
# back to the conventional one rather than come back empty.
_DRIFTSFORM_PRIORITY = {
    True: ("Økologisk", "Konventionel"),
    False: ("Konventionel", "Økologisk"),
}


def _missing_lookup(table_name: str, task_name: str) -> RuntimeError:
    return RuntimeError(f"{table_name} is empty; run pixi run {task_name}")


def apply_kartoffel_regel(sample: dict) -> dict:
    """Return the sample with M=2 for potato codes and other fields unchanged."""
    if sample.get("crop_code") in KARTOFFEL_KODER:
        return {**sample, "M": 2}
    return sample


@lru_cache(maxsize=1)
def _load_afgroeder() -> dict[int, object]:
    with SessionLocal() as session:
        rows = session.execute(select(afgroede_table)).all()
    if not rows:
        raise _missing_lookup("afgroede", "load-afgroeder")
    return {row.afgroedekode: row for row in rows}


@lru_cache(maxsize=1)
def _load_lang_lookup() -> dict[tuple[int, int, str, str], dict]:
    """Return the historic source-order-resolved norm lookup from PostgreSQL."""
    with SessionLocal() as session:
        rows = session.execute(
            select(afgroede_norm_lookup_table).order_by(
                afgroede_norm_lookup_table.c.source_order,
                afgroede_norm_lookup_table.c.jb_nr,
            )
        ).all()
    if not rows:
        raise _missing_lookup("afgroede_norm_lookup", "load-afgroeder")

    lookup: dict[tuple[int, int, str, str], dict] = {}
    # driftsform is part of the key: konventionel and økologisk rows for the
    # same afgrøde/jb/vanding are genuinely different norms (previously they
    # silently overwrote each other in source order, so whichever driftsform
    # happened to load last "won" regardless of which one a simulation
    # actually asked for).
    crops = _load_afgroeder()
    for row in rows:
        crop = crops[row.afgroedekode]
        lookup[(row.afgroedekode, row.jb_nr, row.vanding, row.driftsform)] = {
            "afgroede": crop.norm_navn,
            "jb_gruppe": row.jb_gruppe,
            "vanding": row.vanding,
            "udbytteenhed": crop.udbytteenhed,
            "udbyttenorm": row.udbyttenorm,
            "udbyttenorm_alt": row.udbyttenorm_alt,
            "n_norm": row.n_norm,
            "p_norm": crop.p_norm,
            "forfrugtsvaerdi": crop.forfrugtsvaerdi,
            "indregn_ffv": crop.indregn_ffv,
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
        raise _missing_lookup("afgroede_nfix_lookup", "load-afgroeder")

    lookup: dict[tuple[int, int, str], float] = {}
    for row in rows:
        lookup[(row.afgroedekode, row.jb_nr, row.vanding)] = row.nfix_kgn_ha
    return lookup


@lru_cache(maxsize=1)
def _load_nuar_koder() -> dict[int, dict]:
    rows = _load_afgroeder().values()
    lookup = {
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
        if row.has_nuar
    }
    if not lookup:
        raise _missing_lookup("afgroede NUAR values", "load-afgroeder")
    return lookup


@lru_cache(maxsize=1)
def _load_permanente_afgrodekoder() -> frozenset[int]:
    with SessionLocal() as session:
        rows = session.execute(
            select(afgroede_table.c.afgroedekode).where(afgroede_table.c.permanent)
        ).scalars()
        return frozenset(rows)


def clear_lookup_cache() -> None:
    """Clear process-local lookup caches after an administrative reload."""
    _load_afgroeder.cache_clear()
    _load_lang_lookup.cache_clear()
    _load_nfix_lookup.cache_clear()
    _load_nuar_koder.cache_clear()
    _load_permanente_afgrodekoder.cache_clear()


def lookup_norm(crop_code, jb_nr, irrigated: bool = False, only_organic: bool = False):
    """Return norm data for a crop/JB/irrigation/driftsform combination, or ``None``.

    ``only_organic`` is the simulation's own gødning choice (GodningSettings),
    not the field's registered oeko flag — driftsform for a norm lookup is
    decided per simulation, not per mark.
    """
    if crop_code is None or jb_nr is None:
        return None
    lookup = _load_lang_lookup()
    for driftsform in _DRIFTSFORM_PRIORITY[bool(only_organic)]:
        for vanding in _VANDING_PRIORITY[bool(irrigated)]:
            result = lookup.get((crop_code, jb_nr, vanding, driftsform))
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


def is_permanent_afgrode(crop_code: int | None) -> bool:
    """Return whether ``crop_code`` is a permanent (ikke-omdrift) afgrøde."""
    if crop_code is None:
        return False
    return crop_code in _load_permanente_afgrodekoder()


def lookup_crop_params(crop_code):
    """Return NUAR parameters for ``crop_code``, or an empty mapping."""
    if crop_code is None:
        return {}
    return _load_nuar_koder().get(crop_code, {})


def crop_names_from_normer() -> dict[int, str]:
    """Return all NUAR crop names keyed by crop code."""
    return {code: info["navn"] for code, info in _load_nuar_koder().items()}
