"""Sædskifte rotation lookup fra Excel (v4).

Porteret fra c:\\plantperform-nles\\src\\saedskifte_lookup.py — samme logik,
sti tilpasset DST2's database/data/raw/ANGJ-data/.

Kolonnestruktur (v4, 37 kolonner):
  0  lookup_id
  1  saedskifte_id
  2  saedskiftevariant
  3  variant
  4  N-norm %
  5+4*(i-1)   afgrøde{i}_kode  (i = 1..8)
  6+4*(i-1)   afgrøde{i}_navn
  7+4*(i-1)   udl{i}_kode
  8+4*(i-1)   udl{i}_navn

Forward-fill på afgr_kode inden for rotationens aktive længde:
  blank afgr = gentag foregående års afgrøde.
udl_kode fyldes IKKE forward — blank = ingen udlæg det år.
Rotationslængden bestemmes fra rådata FØR forward-fill.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import pandas as pd

_ROOT = Path(__file__).resolve().parents[4]  # .../backend
_XLSX_PATH = (
    _ROOT / "database" / "data" / "raw" / "ANGJ-data"
    / "PlantPerform_saedskifte_lookup_v4_uden_normgruppe_dedup (1).xlsx"
)

_BASE_COLS = ["lookup_id", "saedskifte_id", "saedskiftevariant", "variant", "N-norm %"]
_YEAR_CLEAN: list[str] = []
for _i in range(1, 9):
    _YEAR_CLEAN += [f"afgr{_i}_kode", f"afgr{_i}_navn", f"udl{_i}_kode", f"udl{_i}_navn"]
_ALL_COLS = _BASE_COLS + _YEAR_CLEAN


@lru_cache(maxsize=1)
def _df() -> pd.DataFrame:
    raw = pd.read_excel(_XLSX_PATH, dtype=str)
    raw.columns = _ALL_COLS[: len(raw.columns)]
    raw = raw.where(raw.notna() & (raw != ""), other=None)
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
    """Sorteret liste af unikke saedskiftevariant-værdier (str)."""
    return sorted(_df()["saedskiftevariant"].dropna().unique(), key=lambda x: int(x))


def list_variants(saedskifte: str) -> list[str]:
    """Sorterede variant-værdier for et givet saedskiftevariant."""
    sub = _df()[_df()["saedskiftevariant"] == str(saedskifte)]
    return sorted(sub["variant"].dropna().unique(), key=lambda x: int(x))


def list_n_norms(saedskifte: str, variant: str) -> list[str]:
    """Sorterede N-norm %-værdier for (saedskifte, variant)."""
    df = _df()
    mask = (df["saedskiftevariant"] == str(saedskifte)) & (df["variant"] == str(variant))
    return sorted(df[mask]["N-norm %"].dropna().unique(), key=lambda x: int(x))


def list_all_candidate_refs() -> list[tuple[str, str, str]]:
    """Alle (saedskiftevariant, variant, N-norm %)-kombinationer i datasættet."""
    df = _df()
    sub = df[["saedskiftevariant", "variant", "N-norm %"]].dropna(how="any")
    triples = {tuple(row) for row in sub.itertuples(index=False, name=None)}
    return sorted(triples, key=lambda t: (int(t[0]), int(t[1]), int(t[2])))


def get_raw_rotation(
    saedskifte: str, variant: str, n_norm: str,
) -> list[tuple[int | None, int | None, str | None]]:
    """8-element liste af (afgr_code, udl_code, udl_navn).

    afgr_code forward-fyldes inden for rotationens aktive længde:
      blank = gentag foregående års afgrøde.
    udl_code/udl_navn fyldes ALDRIG forward — blank = ingen udlæg det pågældende år.
    Rotationens aktive længde beregnes fra rådata FØR forward-fill, så
    cyklingen i generate_rotation fungerer korrekt.
    """
    df = _df()
    mask = (
        (df["saedskiftevariant"] == str(saedskifte))
        & (df["variant"] == str(variant))
        & (df["N-norm %"] == str(n_norm))
    )
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

    # Beregn aktiv længde fra rådata FØR forward-fill
    raw_act_len = 0
    for i in range(7, -1, -1):
        if triples[i][0] is not None or triples[i][1] is not None:
            raw_act_len = i + 1
            break

    # Forward-fill afgr KUN inden for aktiv længde; udl fyldes ikke
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
    """1-baseret indeks for sidste ikke-None position; 0 hvis alt er tomt."""
    for i in range(7, -1, -1):
        if rotation[i][0] is not None or rotation[i][1] is not None:
            return i + 1
    return 0


def generate_rotation(
    saedskifte: str, variant: str, n_norm: str, start_year: int = 1
) -> list[tuple[int | None, int | None, str | None]]:
    """Generer 8-årig rotation fra start_year (1-baseret), cyklisk hvis nødvendigt.

    Eksempel:
        rotation = [A, B, C, D, E]  (active_len=5), start_year=3
        resultat  = [C, D, E, A, B, C, D, E]
    """
    base = get_raw_rotation(saedskifte, variant, n_norm)
    act = rotation_active_len(base)
    if act == 0:
        return [(None, None, None)] * 8
    s = (start_year - 1) % act
    return [base[(s + i) % act] for i in range(8)]
