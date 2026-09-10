"""Database-backed crop-rotation lookup.

The authorized CSV is parsed by database/scripts/load_saedskifte_lookup.py
during administration. Production backend artifacts contain neither that raw
file nor the database directory; they read the resulting lookup tables.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import cache, lru_cache
from typing import Any

from sqlalchemy import select

from app.data.db import (
    SessionLocal,
    saedskifte_category_table,
    saedskifte_rotation_table,
)

RawPosition = tuple[int | None, int | None, str | None]
RawRotation = tuple[RawPosition, ...]


@dataclass(frozen=True)
class _LookupData:
    rotations: dict[tuple[str, str], RawRotation]
    categories: dict[str, tuple[str, ...]]
    driftsforms: dict[str, str]


def _to_int(value: object) -> int | None:
    if value is None:
        return None
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else None


def _to_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _deserialize_rotation(value: object, key: tuple[str, str]) -> RawRotation:
    if not isinstance(value, list) or len(value) != 8:
        raise RuntimeError(f"Invalid rotation data for {key[0]}/{key[1]} in the database")

    positions: list[RawPosition] = []
    for position in value:
        if not isinstance(position, dict):
            raise RuntimeError(f"Invalid rotation data for {key[0]}/{key[1]} in the database")
        positions.append(
            (
                _to_int(position.get("afgrode_kode")),
                _to_int(position.get("udlaeg_kode")),
                _to_str(position.get("udlaeg_navn")),
            )
        )
    return tuple(positions)


def _fetch_lookup_rows() -> tuple[list[Any], list[Any]]:
    with SessionLocal() as session:
        rotations = session.execute(
            select(
                saedskifte_rotation_table.c.saedskiftevariant,
                saedskifte_rotation_table.c.variant,
                saedskifte_rotation_table.c.rotation,
                saedskifte_rotation_table.c.driftsform,
            ).order_by(
                saedskifte_rotation_table.c.saedskiftevariant,
                saedskifte_rotation_table.c.variant,
            )
        ).all()
        categories = session.execute(
            select(
                saedskifte_category_table.c.saedskiftevariant,
                saedskifte_category_table.c.kategori,
            ).order_by(
                saedskifte_category_table.c.saedskiftevariant,
                saedskifte_category_table.c.kategori,
            )
        ).all()
    return rotations, categories


@lru_cache(maxsize=1)
def _lookup_data() -> _LookupData:
    rotation_rows, category_rows = _fetch_lookup_rows()
    if not rotation_rows:
        raise RuntimeError("Sædskifte lookup is empty; run pixi run load-saedskifte-lookup")

    rotations: dict[tuple[str, str], RawRotation] = {}
    driftsforms: dict[str, str] = {}
    for row in rotation_rows:
        saedskiftevariant = str(row.saedskiftevariant)
        variant = str(row.variant)
        key = (saedskiftevariant, variant)
        rotations[key] = _deserialize_rotation(row.rotation, key)
        if (driftsform := _to_str(row.driftsform)) is not None:
            driftsforms.setdefault(saedskiftevariant, driftsform)

    categories: dict[str, list[str]] = {}
    for row in category_rows:
        category = _to_str(row.kategori)
        if category is not None:
            categories.setdefault(str(row.saedskiftevariant), []).append(category)

    return _LookupData(
        rotations=rotations,
        categories={key: tuple(sorted(set(values))) for key, values in categories.items()},
        driftsforms=driftsforms,
    )


def clear_lookup_cache() -> None:
    """Clear process-local lookup caches after an administrative reload."""
    _lookup_data.cache_clear()
    get_raw_rotation.cache_clear()


def list_saedskifter() -> list[str]:
    """Return a numerically sorted list of saedskiftevariant values."""
    values = {saedskiftevariant for saedskiftevariant, _ in _lookup_data().rotations}
    return sorted(values, key=int)


def list_variants(saedskifte: str) -> list[str]:
    """Return numerically sorted variants for a saedskiftevariant."""
    values = {
        variant
        for saedskiftevariant, variant in _lookup_data().rotations
        if saedskiftevariant == str(saedskifte)
    }
    return sorted(values, key=int)


def list_all_saedskifte_refs() -> list[tuple[str, str]]:
    """Return all (saedskiftevariant, variant) combinations in the lookup."""
    return sorted(_lookup_data().rotations, key=lambda item: (int(item[0]), int(item[1])))


def get_kategori(saedskifte: str) -> list[str]:
    """Return the source categories for a saedskiftevariant."""
    return list(_lookup_data().categories.get(str(saedskifte), ()))


def get_driftsform(saedskifte: str) -> str | None:
    """Return the source driftsform label for a saedskiftevariant, if present."""
    return _lookup_data().driftsforms.get(str(saedskifte))


@cache
def get_raw_rotation(saedskifte: str, variant: str) -> list[RawPosition]:
    """Return the eight raw positions, forward-filling crop codes as before."""
    triples = list(_lookup_data().rotations.get((str(saedskifte), str(variant)), ()))
    if not triples:
        return [(None, None, None)] * 8

    raw_active_length = rotation_active_len(triples)
    last_afgrode: int | None = None
    result: list[RawPosition] = []
    for index, (afgrode, udlaeg, udlaeg_navn) in enumerate(triples):
        if index < raw_active_length:
            if afgrode is not None:
                last_afgrode = afgrode
            elif last_afgrode is not None:
                afgrode = last_afgrode
        result.append((afgrode, udlaeg, udlaeg_navn))
    return result


def rotation_active_len(rotation: list[RawPosition] | tuple[RawPosition, ...]) -> int:
    """Return the one-based index of the last non-empty position, or zero."""
    for index in range(len(rotation) - 1, -1, -1):
        if rotation[index][0] is not None or rotation[index][1] is not None:
            return index + 1
    return 0


def generate_rotation(
    saedskifte: str, variant: str, start_year: int = 1,
) -> list[RawPosition]:
    """Generate an eight-year rotation, cycling from the requested start year."""
    base = get_raw_rotation(saedskifte, variant)
    active_length = rotation_active_len(base)
    if active_length == 0:
        return [(None, None, None)] * 8
    start = (start_year - 1) % active_length
    return [base[(start + index) % active_length] for index in range(8)]
