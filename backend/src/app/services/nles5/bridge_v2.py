"""Bridge between real afgrødekoder and the NLES5 engine (engine.py).

Replaces bridge.py's coarse M-class heuristics (AUTO_W_BY_M, NEXT_M_TO_W, and
the WP-always-1 stub) with real per-afgrødekode M/W/MP/WP values from
services.rotations.afgroede_normer.lookup_crop_params(), the same source as the
NUAR_koder sheet in the Bilag 1 master table.

The W calculation is ported from c:\\plantperform-nles\\streamlit_app.py
(lines ~344-369). W for a position depends on what is sown/ploughed in autumn,
hence on the NEXT position's afgrøde rather than only the current afgrøde. MP
for a position is the PREVIOUS position's own MP field (the forfrugt's
category). WP uses the same "next year overrides" principle as W, shifted by
one year. If the CURRENT position's afgrøde is a vinterafgrøde, it occupies the
winter period between the forfrugt and the current year; otherwise WP falls
back to the previous position's static WP field (see _resolve_wp).

P/S/NT come from the mark's own registry_field values supplied by the caller.
The afgrøde determines which of the eight P values is used:
services.rotations.afstromning looks up the afgrødekode in Bilag 7, table 1
(Bilag_1_tabel_1_med_P_noegle.csv), and returns its afstrømningskategori
(1-8), with an alternative category when the position has a
winter-cover-changing virkemiddel (EEA/efterafgrøde) in the same year.

Historical crop_history can reference afgrødekoder that predate or fall
outside Bilag 1 (e.g. administrative codes like "slettet mark"). For those,
afstromningskategori() returns None; rather than blocking the mark from being
added, the position's leaching is reported as 0/ukendt (see
afstromningskategori_ukendt below).
"""
from __future__ import annotations

from functools import lru_cache

from app.domain.soil import MissingSoilDataError, PercolationByKategori
from app.services.nles5.engine import calculate_leaching
from app.services.rotations import afgroede_normer, afstromning
from app.services.virkemidler import KORN_OG_RAPS_KODER

# Next-year M code -> this position's W (Bilag 2, table 6: what is sown/ploughed
# in autumn depends on next year's M). Same mapping as bridge.py/streamlit_app.py.
_NEXT_M_TO_W: dict[int, int] = {1: 1, 9: 6, 10: 7, 11: 8, 12: 8}
_AUTUMNSOWN_M = frozenset({1, 9, 10})

# Udlægskode -> W when the udlæg itself determines the winter cover, such as
# efterafgrøde, mellemafgrøde, or udlæg til frø. Ported from UDL_W_MAPPING in
# streamlit_app.py.
_UDL_W_MAPPING: dict[int, int | None] = {
    960: 4, 961: 4, 962: 4, 963: 4, 964: 4, 965: 4, 966: 4,
    968: 5,     # "Efterafgrøde, pligtig"
    9680: 4,    # "Efterafgrøde e. frøgræs"
    9682: 4,    # Mellemafgrøde
    9683: None, # "Tidlig såning"; W is determined by the afgrøde itself
    9684: 4,    # "Mellemafgrøde e. frøgræs"
    970: 5,     # "Øvrige udlæg og efterafgrøder"
    2000: 4,    # "Udlæg til frø"
    3000: 3,    # "Jordbearbejdning efterår"
    0: None,    # Explicitly no udlæg
}

# Udlægskode -> the NUAR virkemiddel automatically assigned to the position.
# Ported from streamlit_app.py's UDL_VIRKEMIDDEL. In the "select sædskifte from
# lookup" flow used by candidate_evaluator.py, EEA/EMA/ETS are not free user
# choices but direct consequences of the rotation's own udlægskode. Different
# `variant` values for one saedskiftevariant represent different virkemiddel
# combinations on the same afgrøde sequence (empirically confirmed:
# saedskiftevariant 315 variants 1/2/4 have identical afgrøde sequences but
# udl_kode 3000/None/968 in position 4).
_UDL_VIRKEMIDDEL: dict[int, dict[str, bool]] = {
    968:  {"eea": True,  "ema": False, "ets": False},  # "Efterafgrøde, pligtig"
    9680: {"eea": True,  "ema": False, "ets": False},  # "Efterafgrøde e. frøgræs"
    9682: {"eea": False, "ema": True,  "ets": False},  # Mellemafgrøde
    9683: {"eea": False, "ema": False, "ets": True},   # "Tidlig såning"
    9684: {"eea": False, "ema": True,  "ets": False},  # "Mellemafgrøde e. frøgræs"
    960:  {"eea": False, "ema": False, "ets": False},
    961:  {"eea": False, "ema": False, "ets": False},
    962:  {"eea": False, "ema": False, "ets": False},
    963:  {"eea": False, "ema": False, "ets": False},
    964:  {"eea": False, "ema": False, "ets": False},
    965:  {"eea": False, "ema": False, "ets": False},
    966:  {"eea": False, "ema": False, "ets": False},
    970:  {"eea": True,  "ema": False, "ets": False},  # "Øvrige udlæg og efterafgrøder"
    2000: {"eea": False, "ema": False, "ets": False},  # "Udlæg til frø"
    3000: {"eea": False, "ema": False, "ets": False},  # "Jordbearbejdning efterår"
    0:    {"eea": False, "ema": False, "ets": False},
}
_NO_VIRKEMIDDEL: dict[str, bool] = {"eea": False, "ema": False, "ets": False}

# Fixed NUAR EEA strength when efterafgrøde/udlæg is present (streamlit_app.py:
# `EEA = 0.45 if eea_on else 0.0`).
_EEA_STRENGTH = 0.45
_EEA_STRENGTH_MAJS = 0.10
_MAJSHELSAED_KODE = 216
_EMA_STRENGTH = 0.20
_ETS_STRENGTH = 0.20
_PRAECISIONSJORDBRUG_EPJ = 0.04


def _resolve_w(
    this_params: dict, next_params: dict, udlaeg_kode: int | None
) -> int:
    auto_w = this_params.get("W")
    next_m = next_params.get("M") if next_params else None
    next_w_from_m = _NEXT_M_TO_W.get(next_m) if next_m is not None else None
    has_lookup_w = auto_w is not None
    udl_w = _UDL_W_MAPPING.get(udlaeg_kode) if udlaeg_kode is not None else None
    next_is_spring = next_m is not None and next_m not in _AUTUMNSOWN_M

    if next_w_from_m is not None:
        return next_w_from_m
    if has_lookup_w:
        return auto_w
    if udl_w is not None:
        return udl_w
    if next_is_spring:
        return 5
    return auto_w if auto_w is not None else 5


# Next-year M code -> WP when this year's winter period is occupied by the NEXT
# year's winter afgrøde. This uses the same "next year overrides" principle as
# _NEXT_M_TO_W, but on WP's richer category scale. For example, WP has a
# separate Vinterraps category (8), unlike W's broader
# "græs/kløvergræs/vinterraps/roer" category (6). Only the two unambiguous cases
# are mapped (M=1 Vintersæd, M=9 Vinterraps). M=10/11/12 ("... after græs") have
# no unambiguous WP counterpart and therefore fall back to the static
# per-afgrødekode WP table rather than a guessed mapping.
_NEXT_M_TO_WP: dict[int, int] = {1: 1, 9: 8}


def _resolve_wp(prev_params: dict, this_params: dict) -> int:
    """Resolve WP as the winter cover between the previous and current afgrøde.

    If the CURRENT afgrøde's M is a vinterafgrøde, that afgrøde itself occupies
    the winter period because it was already sown in autumn. The previous
    afgrøde's static WP classification does not apply.
    """
    this_m = this_params.get("M")
    wp_from_next = _NEXT_M_TO_WP.get(this_m) if this_m is not None else None
    if wp_from_next is not None:
        return wp_from_next
    return prev_params.get("WP") or 1


@lru_cache(maxsize=20_000)
def evaluate_leaching_position(
    afgrode_kode: int,
    next_afgrode_kode: int | None,
    prev_afgrode_kode: int | None,
    udlaeg_kode: int | None,
    jbnr: int,
    mncs: float,
    mnca: float = 0.0,
    g0: float = 0.0,
    m1: float = 0.0,
    m2: float = 0.0,
    f0: float = 0.0,
    f1: float = 0.0,
    f2: float = 0.0,
    g1: float = 0.0,
    g2: float = 0.0,
    y: int = 2027,
    irrigated: bool = False,
    fdato: str = "20/8",
    precision_dagsbasis: bool = False,
    praecisionsjordbrug: bool = False,
    percolation_by_kategori: PercolationByKategori | None = None,
    org_n_topsoil: float | None = None,
    s_soil: float | None = None,
) -> dict:
    """Calculate udvaskning for one sædskifte position via calculate_leaching."""
    this_params = afgroede_normer.lookup_crop_params(afgrode_kode)
    next_params = afgroede_normer.lookup_crop_params(next_afgrode_kode) if next_afgrode_kode else {}
    prev_params = afgroede_normer.lookup_crop_params(prev_afgrode_kode) if prev_afgrode_kode else {}

    m = this_params.get("M") or 1
    wc = this_params.get("WC") or 1
    mp = prev_params.get("MP") or 1
    wp = _resolve_wp(prev_params, this_params)
    w = _resolve_w(this_params, next_params, udlaeg_kode)

    vk = (
        _UDL_VIRKEMIDDEL.get(udlaeg_kode, _NO_VIRKEMIDDEL)
        if udlaeg_kode is not None
        else _NO_VIRKEMIDDEL
    )

    # The afgrøde determines which of the eight P values is used, including
    # whether the position has a winter-cover-changing virkemiddel that year;
    # see afstromning.py. Not every historical afgrødekode is in Bilag 1
    # (e.g. administrative codes such as "slettet mark"); for those,
    # afstromningskategori() returns None and the position falls back to
    # leaching 0/ukendt below instead of blocking the whole mark on a missing
    # crop code. A genuinely missing P/S/Nt soil measurement still raises.
    kategori = afstromning.afstromningskategori(afgrode_kode, eea_on=vk["eea"])
    kategori_ukendt = kategori is None
    p_value = (
        percolation_by_kategori[kategori - 1]
        if percolation_by_kategori is not None and kategori is not None
        else (0.0 if kategori_ukendt else None)
    )
    if p_value is None or org_n_topsoil is None or s_soil is None:
        raise MissingSoilDataError(
            f"Missing P/S/Nt data for crop {afgrode_kode} (kategori={kategori})"
        )

    sample = {
        "crop_code": afgrode_kode,
        "crop_name": this_params.get("navn", ""),
        "Y": y,
        "M": m, "W": w, "MP": mp, "WP": wp, "WC": wc,
        "jbnr": jbnr,
        "NT_source": "manual", "NT": org_n_topsoil,
        "MNCS": mncs, "MNCA": mnca, "MNudb": 0.0,
        "M1": m1, "M2": m2,
        "F0": f0, "F1": f1, "F2": f2,
        "G0": g0, "G1": g1, "G2": g2,
        "P_override": p_value, "S_override": s_soil,
        "afstromningskategori": kategori,
        "afstromningskategori_ukendt": kategori_ukendt,
        # EEA/EMA/ETS are derived from the rotation's udlægskode (see
        # _UDL_VIRKEMIDDEL above), not freely selected. Fdato/precision_dagsbasis
        # is a scenarie-level Phase 8 setting applied equally to every year with
        # efterafgrøde. Efterafgrøde in maize has the lower statutory
        # 10 % effect; EMA and ETS each have a flat 20 % effect.
        "EEA": (
            (_EEA_STRENGTH_MAJS if afgrode_kode == _MAJSHELSAED_KODE else _EEA_STRENGTH)
            if vk["eea"]
            else 0.0
        ),
        "Fdato": fdato, "precision_dagsbasis": precision_dagsbasis,
        "EMA": _EMA_STRENGTH if vk["ema"] else 0.0,
        "ETS": _ETS_STRENGTH if vk["ets"] else 0.0,
        "EPJ": (
            _PRAECISIONSJORDBRUG_EPJ
            if praecisionsjordbrug and afgrode_kode in KORN_OG_RAPS_KODER
            else 0.0
        ),
        "mellemafgroede": vk["ema"], "early_sowing": vk["ets"],
    }
    # Merge the sample with the result so leaching_detail carries both raw
    # inputs (M, W, MP, WP, MNCS, ...) and derived values (L, Ntheta, C, ...).
    # This is required for a full annual calculation walkthrough in the UI (see
    # streamlit_app.py's "Beregningsdetaljer pr. år").
    result = {**sample, **calculate_leaching(sample)}
    if kategori_ukendt:
        # No afstrømningskategori to base a real percolation figure on:
        # report the position as 0/ukendt rather than a number computed from
        # a guessed category.
        result.update({"L": 0.0, "L_nuar": 0.0, "leaching_kgN_ha": 0.0, "L_nuar_kgN_ha": 0.0})
    return result
