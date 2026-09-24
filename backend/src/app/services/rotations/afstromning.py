"""Database-backed P-runoff categories per crop code.

``load_afgroeder.py`` imports Bilag 1's authoritative lookup;
the NLES5 runtime reads the consolidated crop table.
"""
from __future__ import annotations

from functools import lru_cache

from sqlalchemy import select

from app.data.db import SessionLocal, afgroede_table


@lru_cache(maxsize=1)
def _load() -> dict[int, tuple[int, int | None]]:
    with SessionLocal() as session:
        rows = session.execute(
            select(afgroede_table).where(
                afgroede_table.c.standard_kategori.is_not(None)
            ).order_by(afgroede_table.c.afgroedekode)
        ).all()
    if not rows:
        raise RuntimeError(
            "afgroede runoff categories are empty; run pixi run load-afgroeder",
        )
    return {
        row.afgroedekode: (row.standard_kategori, row.vinterdaekke_kategori)
        for row in rows
    }


def clear_lookup_cache() -> None:
    _load.cache_clear()


def afstromningskategori(crop_code: int | None, eea_on: bool = False) -> int | None:
    """Return the P-runoff category, accounting for winter-cover measures."""
    entry = _load().get(crop_code) if crop_code is not None else None
    if entry is None:
        return None
    base, alternate = entry
    if eea_on and alternate is not None:
        return alternate
    return base
