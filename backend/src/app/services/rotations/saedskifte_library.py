"""Sædskifte rotation lookup fra CSV (sammenlagt, semikolon-separeret).

Kilde: Ny_sædskifte_lookup_sammenlagt.csv (2026-09-02) — erstatter
PlantPerform_saedskifte_lookup_v4_uden_normgruppe_dedup (1).xlsx. Den nye
fil har fjernet N-norm%-aksen fra selve rotationsopslaget (tidligere fandtes
fx "Økologisk 107N" og "Økologisk 65N" som separate rækker for samme
afgrødesekvens); N-tildeling håndteres nu udelukkende via scenariets egen
N-norm%-vælger (rotation_candidates.py's /n-norm-procenter,
candidate_evaluator.compute_n_inputs' n_norm_pct-skalering), IKKE længere som
en del af selve rotationsopslaget. Rotation er derfor nøglet på
(saedskiftevariant, variant) alene — ikke længere en tredelt
(saedskiftevariant, variant, n_norm)-nøgle.

Driftsform/Husdyr-gødningstype/Husdyr-gødning kg N/ha-kolonnerne beskriver
hvordan kildedata oprindelig blev beregnet for DENNE specifikke række — de er
IKKE en adgangsbegrænsning ved sædskiftevalg. Både konventionelle og
økologiske brugere kan vælge ethvert sædskifte (jf. den eksisterende, fulde
afkobling af driftsform fra sædskiftevalg, Fase 13's GodningSettings — se
candidate_evaluator.py's modul-docstring). Kolonnerne bruges her kun til at
udlede "Sammenlagt kategori" (get_kategori/get_driftsform, forbrugt af
saedskifte_kategorier.py) — en ren UI-grupperingsetiket, ikke en filtrering
af hvilke rotationer der kan vælges.

Verificeret 2026-09-02: for de få (saedskiftevariant, variant)-par hvor
kildefilen har flere rækker (kun ren brak, saedskiftevariant "1"), er
afgrøde-/udlægssekvensen identisk på tværs af alle rækker — kun
driftsform-/kategori-mærkningen varierer. Det er derfor sikkert at bruge
første match uden yderligere disambiguering.

Kolonnestruktur (41 kolonner, semikolon-separeret; kildefilens 4 indledende
titel-/nummererings-/header-/underheader-rækker springes over):
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
  39 Oprindelige N-kategorier   (kun sporbarhed, ikke brugt her)
  40 Oprindelige sædskifte nr.  (kun sporbarhed, ikke brugt her)

Forward-fill på afgr_kode inden for rotationens aktive længde:
  blank afgr = gentag foregående års afgrøde.
udl_kode fyldes IKKE forward — blank = ingen udlæg det år.
Rotationslængden bestemmes fra rådata FØR forward-fill.
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
    """Sorteret liste af unikke saedskiftevariant-værdier (str)."""
    return sorted(_df()["saedskiftevariant"].dropna().unique(), key=lambda x: int(x))


def list_variants(saedskifte: str) -> list[str]:
    """Sorterede variant-værdier for et givet saedskiftevariant."""
    sub = _df()[_df()["saedskiftevariant"] == str(saedskifte)]
    return sorted(sub["variant"].dropna().unique(), key=lambda x: int(x))


def list_all_saedskifte_refs() -> list[tuple[str, str]]:
    """Alle (saedskiftevariant, variant)-kombinationer i datasættet."""
    df = _df()
    sub = df[["saedskiftevariant", "variant"]].dropna(how="any")
    pairs = {tuple(row) for row in sub.itertuples(index=False, name=None)}
    return sorted(pairs, key=lambda t: (int(t[0]), int(t[1])))


def get_kategori(saedskifte: str) -> list[str]:
    """"Sammenlagt kategori"-værdi(er) for et givet saedskiftevariant —
    normalt netop én, men saedskiftevariant "1" (ren brak) hører til alle 4
    kategorier på én gang, ligesom i den gamle kategori-CSV."""
    sub = _df()[_df()["saedskiftevariant"] == str(saedskifte)]
    return sorted(v for v in sub["kategori"].dropna().unique())


def get_driftsform(saedskifte: str) -> str | None:
    """Kildedataets EGEN driftsform-mærkning for dette saedskiftevariant —
    bruges kun til kategori-udledning, IKKE som adgangsbegrænsning ved
    sædskiftevalg (se moduldocstring)."""
    sub = _df()[_df()["saedskiftevariant"] == str(saedskifte)]
    values = sub["driftsform"].dropna().unique()
    return values[0] if len(values) else None


@cache
def get_raw_rotation(
    saedskifte: str, variant: str,
) -> list[tuple[int | None, int | None, str | None]]:
    """8-element liste af (afgr_code, udl_code, udl_navn).

    afgr_code forward-fyldes inden for rotationens aktive længde:
      blank = gentag foregående års afgrøde.
    udl_code/udl_navn fyldes ALDRIG forward — blank = ingen udlæg det pågældende år.
    Rotationens aktive længde beregnes fra rådata FØR forward-fill, så
    cyklingen i generate_rotation fungerer korrekt.

    Cachet: kaldes gentagne gange for samme (saedskifte, variant) — pr.
    N-norm% i generate_candidates_for_field, og igen af dens dedup-tjek
    (_strip_disabled_virkemidler-signaturen) — hver gang med en fuld,
    ucachet pandas boolean-mask-filtrering over hele datasættet (~3ms).
    Nøglerummet er trivielt lille (antal sædskiftevarianter × varianter,
    et par hundrede kombinationer i alt), maxsize=None er derfor sikkert."""
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
    saedskifte: str, variant: str, start_year: int = 1
) -> list[tuple[int | None, int | None, str | None]]:
    """Generer 8-årig rotation fra start_year (1-baseret), cyklisk hvis nødvendigt.

    Eksempel:
        rotation = [A, B, C, D, E]  (active_len=5), start_year=3
        resultat  = [C, D, E, A, B, C, D, E]
    """
    base = get_raw_rotation(saedskifte, variant)
    act = rotation_active_len(base)
    if act == 0:
        return [(None, None, None)] * 8
    s = (start_year - 1) % act
    return [base[(s + i) % act] for i in range(8)]
