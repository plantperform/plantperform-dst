"""Database-backed historical fertilizer allocation lookup.

The authorized Bilag 3 CSV is loaded into historisk_goedningsfordeling during
administration. Runtime calculations intentionally have no dependency on the
raw source file.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any

from sqlalchemy import select

from app.data.db import SessionLocal, historisk_goedningsfordeling_table

# The source has six regions, while registry_field distinguishes these two.
_REGION_ALIASES = {
    "Østjylland": "Øst og Nordjylland",
    "Nordjylland": "Øst og Nordjylland",
}


def _fetch_historical_rows() -> list[Any]:
    with SessionLocal() as session:
        return session.execute(
            select(
                historisk_goedningsfordeling_table.c.region,
                historisk_goedningsfordeling_table.c.driftsform,
                historisk_goedningsfordeling_table.c.afgroedekode,
                historisk_goedningsfordeling_table.c.jb_nr,
                historisk_goedningsfordeling_table.c.n_type,
                historisk_goedningsfordeling_table.c.vaerdi,
            )
        ).all()


@lru_cache(maxsize=1)
def _load() -> dict[tuple[str, str, int, int], dict[str, float]]:
    rows = _fetch_historical_rows()
    if not rows:
        raise RuntimeError(
            "Historical fertilizer lookup is empty; "
            "run pixi run load-historisk-goedningsfordeling"
        )

    lookup: dict[tuple[str, str, int, int], dict[str, float]] = {}
    for row in rows:
        key = (row.region, row.driftsform, int(row.afgroedekode), int(row.jb_nr))
        entry = lookup.setdefault(key, {"mncs": 0.0, "g0": 0.0})
        if row.n_type == "mineralsk":
            entry["mncs"] = float(row.vaerdi)
        elif row.n_type == "organisk":
            entry["g0"] = float(row.vaerdi)
    return lookup


def clear_historisk_goedning_cache() -> None:
    """Clear the process-local lookup cache after an administrative reload."""
    _load.cache_clear()


def lookup_historisk_n_input(
    afgrode_kode: int | None,
    jbnr: int | None,
    goedningsregion: str | None,
    oeko: bool,
) -> dict[str, float]:
    """Return historical average ``{"mncs": ..., "g0": ...}`` for a field."""
    if afgrode_kode is None or jbnr is None or goedningsregion is None:
        return {"mncs": 0.0, "g0": 0.0}

    region = _REGION_ALIASES.get(goedningsregion, goedningsregion)
    driftsform = "Økologisk" if oeko else "Konventionel"
    return dict(_load().get((region, driftsform, afgrode_kode, jbnr), {"mncs": 0.0, "g0": 0.0}))


def real_history_lookback(
    crop_history: dict[str, int | None],
    jbnr: int | None,
    goedningsregion: str | None,
    oeko: bool,
) -> dict[str, dict]:
    """Return actual 2025/26 crop codes and historical N inputs for a field."""
    result: dict[str, dict] = {}
    for year in (2025, 2026):
        value = crop_history.get(str(year))
        code = int(value) if value is not None else None
        n_input = lookup_historisk_n_input(code, jbnr, goedningsregion, oeko)
        result[str(year)] = {
            "code": code,
            "mncs": n_input["mncs"],
            "mnca": 0.0,
            "g0": n_input["g0"],
        }
    return result
