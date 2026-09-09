"""Sædskifte rotation lookup from a consolidated, semicolon-separated CSV.

Source: Ny_sædskifte_lookup_sammenlagt.csv (2026-09-02), replacing
PlantPerform_saedskifte_lookup_v4_uden_normgruppe_dedup (1).xlsx. The new file
removed the N-norm% axis from the rotation lookup itself. Previously, for
example, "Økologisk 107N" and "Økologisk 65N" were separate rows for the same
afgrøde sequence. N allocation is now handled exclusively by the scenarie's
own N-norm% selector (rotation_candidates.py's /n-norm-procenter and the
n_norm_pct scaling in candidate_evaluator.compute_n_inputs), not as part of the
rotation lookup. Rotations are therefore keyed only by (saedskiftevariant,
variant), no longer by a three-part (saedskiftevariant, variant, n_norm) key.

The Driftsform/Husdyr-gødningstype/Husdyr-gødning kg N/ha columns describe how
the source data was originally calculated for THIS specific row. They do not
restrict access during sædskifte selection. Both konventionelle and økologiske
users can select any sædskifte, following the existing full decoupling of
driftsform from sædskifte selection in Phase 13's GodningSettings; see the
candidate_evaluator.py module docstring. The columns are used only to derive
"Sammenlagt kategori" (get_kategori/get_driftsform, consumed by
saedskifte_kategorier.py), a UI grouping label rather than a filter on the
available rotations.

Verified 2026-09-02: for the few (saedskiftevariant, variant) pairs with several
source rows (only pure brak, saedskiftevariant "1"), the afgrøde/udlæg sequence
is identical across all rows. Only the driftsform/category labeling varies, so
using the first match without further disambiguation is safe.

Column structure (41 semicolon-separated columns; the source file's first four
title/numbering/header/subheader rows are skipped):
  0  Ident
  1  Sædskifte nr.  (= saedskiftevariant)
  2  Variant
  3+4*(i-1)  afgr{i}_kode   (i = 1..8)
  4+4*(i-1)  afgr{i}_navn
  5+4*(i-1)  udl{i}_kode
  6+4*(i-1)  udl{i}_navn
  35 Driftsform
  36 Husdyr-gødningstype
  37 Husdyr-gødning kg N/ha
  38 Sammenlagt kategori
  39 Oprindelige N-kategorier   (traceability only, not used here)
  40 Oprindelige sædskifte nr.  (traceability only, not used here)

Forward-fill afgr_kode within the rotation's active length:
  blank afgr = repeat the previous year's afgrøde.
udl_kode is not forward-filled; blank = no udlæg that year.
The rotation length is determined from raw data before forward-filling.
"""
from __future__ import annotations

from functools import cache, lru_cache
from pathlib import Path

import pandas as pd

_ROOT = Path(__file__).resolve().parents[4]  # .../backend
_CSV_PATH = (
    _ROOT / "database" / "data" / "raw" / "ANGJ-data" / "Ny_sædskifte_lookup_sammenlagt.csv"
)
_HEADER_ROWS_TO_SKIP = 4

_BASE_COLS = ["ident", "saedskiftevariant", "variant"]
_YEAR_CLEAN: list[str] = []
for _i in range(1, 9):
    _YEAR_CLEAN += [f"afgr{_i}_kode", f"afgr{_i}_navn", f"udl{_i}_kode", f"udl{_i}_navn"]
_META_COLS = [
    "driftsform", "husdyr_type", "husdyr_kg_n_ha",
    "kategori", "_oprindelige_n_kategorier", "_oprindelige_saedskifte_nr",
]
_ALL_COLS = _BASE_COLS + _YEAR_CLEAN + _META_COLS


@lru_cache(maxsize=1)
def _df() -> pd.DataFrame:
    raw = pd.read_csv(
        _CSV_PATH, sep=";", skiprows=_HEADER_ROWS_TO_SKIP, header=None,
        dtype=str, encoding="utf-8-sig",
    )
    raw.columns = _ALL_COLS[: len(raw.columns)]
    raw = raw.where(raw.notna() & (raw != ""), other=None)
    raw = raw[raw["saedskiftevariant"].notna()]
    return raw


def _to_int(v) -> int | None:
    if v is None:
        return None
    try:
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return None


def _to_str(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, float) and v != v:  # NaN (slips through _df()'s cleanup on some cells)
        return None
    text = str(v).strip()
    return text or None


def list_saedskifter() -> list[str]:
    """Return a sorted list of unique saedskiftevariant values (str)."""
    return sorted(_df()["saedskiftevariant"].dropna().unique(), key=lambda x: int(x))


def list_variants(saedskifte: str) -> list[str]:
    """Return sorted variant values for a saedskiftevariant."""
    sub = _df()[_df()["saedskiftevariant"] == str(saedskifte)]
    return sorted(sub["variant"].dropna().unique(), key=lambda x: int(x))


def list_all_saedskifte_refs() -> list[tuple[str, str]]:
    """Return all (saedskiftevariant, variant) combinations in the dataset."""
    df = _df()
    sub = df[["saedskiftevariant", "variant"]].dropna(how="any")
    pairs = {tuple(row) for row in sub.itertuples(index=False, name=None)}
    return sorted(pairs, key=lambda t: (int(t[0]), int(t[1])))


def get_kategori(saedskifte: str) -> list[str]:
    """Return "Sammenlagt kategori" values for a saedskiftevariant.

    Normally there is exactly one, but saedskiftevariant "1" (pure brak)
    belongs to all four categories at once, as in the old category CSV.
    """
    sub = _df()[_df()["saedskiftevariant"] == str(saedskifte)]
    return sorted(v for v in sub["kategori"].dropna().unique())


def get_driftsform(saedskifte: str) -> str | None:
    """Return the source data's own driftsform label for a saedskiftevariant.

    It is used only to derive the category, not to restrict access during
    sædskifte selection; see the module docstring.
    """
    sub = _df()[_df()["saedskiftevariant"] == str(saedskifte)]
    values = sub["driftsform"].dropna().unique()
    return values[0] if len(values) else None


@cache
def get_raw_rotation(
    saedskifte: str, variant: str,
) -> list[tuple[int | None, int | None, str | None]]:
    """Return an eight-item list of (afgr_code, udl_code, udl_navn).

    afgr_code is forward-filled within the rotation's active length:
      blank = repeat the previous year's afgrøde.
    udl_code/udl_navn are never forward-filled; blank = no udlæg that year.
    The active rotation length is calculated from raw data before
    forward-filling so generate_rotation cycles correctly.

    Cached because it is called repeatedly for the same (saedskifte, variant),
    once per N-norm% in generate_candidates_for_field and again by its dedup
    check (_strip_disabled_virkemidler signature). Without caching, each call
    performs a full pandas Boolean-mask filter over the dataset (~3 ms). The
    key space is trivially small (number of sædskifte variants × variants, a
    few hundred combinations total), so maxsize=None is safe.
    """
    df = _df()
    mask = (df["saedskiftevariant"] == str(saedskifte)) & (df["variant"] == str(variant))
    rows = df[mask]
    if rows.empty:
        return [(None, None, None)] * 8
    row = rows.iloc[0]

    triples = [
        (
            _to_int(row.get(f"afgr{i}_kode")),
            _to_int(row.get(f"udl{i}_kode")),
            _to_str(row.get(f"udl{i}_navn")),
        )
        for i in range(1, 9)
    ]

    # Calculate active length from raw data before forward-filling
    raw_act_len = 0
    for i in range(7, -1, -1):
        if triples[i][0] is not None or triples[i][1] is not None:
            raw_act_len = i + 1
            break

    # Forward-fill afgr only within the active length; do not fill udl
    last_afgr = None
    result = []
    for i, (afgr, udl, udl_navn) in enumerate(triples):
        if i < raw_act_len:
            if afgr is not None:
                last_afgr = afgr
            elif last_afgr is not None:
                afgr = last_afgr
        result.append((afgr, udl, udl_navn))

    return result


def rotation_active_len(rotation: list[tuple[int | None, int | None, str | None]]) -> int:
    """Return the one-based index of the last non-None position, or 0 if empty."""
    for i in range(7, -1, -1):
        if rotation[i][0] is not None or rotation[i][1] is not None:
            return i + 1
    return 0


def generate_rotation(
    saedskifte: str, variant: str, start_year: int = 1
) -> list[tuple[int | None, int | None, str | None]]:
    """Generate an eight-year rotation from one-based start_year, cycling as needed.

    Example:
        rotation = [A, B, C, D, E]  (active_len=5), start_year=3
        result    = [C, D, E, A, B, C, D, E]
    """
    base = get_raw_rotation(saedskifte, variant)
    act = rotation_active_len(base)
    if act == 0:
        return [(None, None, None)] * 8
    s = (start_year - 1) % act
    return [base[(s + i) % act] for i in range(8)]
