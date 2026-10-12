"""Bridge between real afgrødekoder and the NLES5 engine (engine.py).

Replaces bridge.py's coarse M-class heuristics (AUTO_W_BY_M, NEXT_M_TO_W, and
the WP-always-1 stub) with real per-afgrødekode M/W/MP/WP values from
services.rotations.afgroede_normer.lookup_crop_params(), the same source as the
NUAR_koder sheet in the Bilag 1 master table.

The W calculation is ported from c:\\plantperform-nles\\streamlit_app.py
(lines ~344-369). W for a position depends on what is sown/ploughed in autumn,
hence on the NEXT position's afgrøde rather than only the current afgrøde. MP
for a position is the PREVIOUS position's own MP field (the forfrugt's
category). WP is the winter cover between the forfrugt and the current
afgrøde: the forfrugt's sekundær afgrøde, an autumn-sown current afgrøde, an
overwintering forfrugt, or else bare soil (see _resolve_wp).

M, W and MP all shift around a langvarig afgrøde (græs, kløvergræs, frøgræs or
brak - see _LANGVARIG_FORFRUGT_KODER), but in three different years:
- M shifts the year AFTER it, when the forfrugt was langvarig: the afgrøde gets
  an afgrøde-specific category (M10/M11/M12, see _FORFRUGT_M_OVERRIDE and
  _resolve_m).
- W shifts the langvarig year itself, decided by what is sown after it: W7
  before vintersæd (Bilag 2, table 7's W7 column) and, for the græs codes of
  table 8, W8 when "Bar jord" (921) shows it is ploughed after the harvest
  (see _resolve_w).
- MP shifts two years after it, when the FORFORFRUGT was langvarig: the fixed
  MP4, but only for the 161 forfrugt-afgrøder in _MP4_BERETTIGET_KODER (see
  _resolve_mp).
Source: Afgrøde beslutningstræ_pr_11_06_27.xlsx, ark M/W/MP, and PUMR 2027
kravspec, Tabel A, felt A59-A61 (docs/nles5-kategorier.md).

Two further additive corrections are applied directly in
evaluate_leaching_position rather than via a _resolve_* helper, since neither
depends on the afgrøde's own static M/W/MP/WP lookup: FOx adds a flat 35 kg
N/ha to F0 when the udlægskode is a kvælstoffikserende efterafgrøde (952/953),
and Fmajs (engine.py's majs_m11_korrektionsfaktor) is only triggered for the
specific maize/forfrugt combination in _FMAJS_HOVEDAFGRODE_KODER /
_FMAJS_FORFRUGT_KODER - not for every afgrøde whose M happens to resolve to
11.

P/S/NT come from the mark's own registry_field values supplied by the caller.
The afgrøde determines which of the eight P values is used:
services.rotations.afstromning looks up the afgrødekode in Bilag 7, table 1
(loaded from Afgroedetabel2027_master.csv), and returns its
afstrømningskategori (1-8). An afgrøde marked in "NUAR ekstrakolonne 2" uses
its alternative category instead when a vinterplantedække other than bar jord
or stub follows it (PUMR, Tabel A, felt A64; see _har_vinterplantedaekke).

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
from app.services.virkemidler import praecisionsgoedskning_tilladt

# Forfrugtskoder (last year's afgrøde) that trigger the "efter græs, kløvergræs,
# frøgræs eller brak" M/MP override below. Bilag 2, table M/MP's "Afgrødekoder
# som forfrugt der udløser en ændring i kategorien" column - the same 69 codes
# for both M and MP (Afgrøde beslutningstræ_pr_11_06_27.xlsx, ark M/MP).
_LANGVARIG_FORFRUGT_KODER: frozenset[int] = frozenset({
    101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115,
    116, 117, 118, 126, 170, 171, 172, 173, 174, 236, 237, 247, 250, 251, 252,
    254, 255, 256, 257, 259, 260, 261, 262, 263, 264, 266, 267, 268, 271, 272,
    273, 274, 276, 277, 278, 279, 284, 285, 286, 305, 306, 310, 312, 316, 326,
    327, 328, 345, 361, 362, 363, 596, 597, 598,
})

# This afgrødekode's own M -> the M to use instead when the forfrugt is one of
# _LANGVARIG_FORFRUGT_KODER (same source ark as above). MP has no per-afgrøde
# variant: every afgrøde with an MP override always overrides to MP4 (see
# _resolve_mp), so no equivalent dict is needed for MP. Kartofler 149-156 have
# no override: the supplerende høring of October 2026 struck their M10 from
# Bilag 2, table 4, so they keep M7 after græs too.
_FORFRUGT_M_OVERRIDE: dict[int, int] = {
    1: 12, 2: 12, 3: 12, 4: 12, 5: 11, 6: 12, 8: 12, 9: 10, 10: 10, 11: 10,
    13: 10, 14: 10, 15: 10, 16: 10, 17: 10, 19: 11, 24: 11, 40: 12, 41: 12,
    52: 12, 53: 12, 55: 12, 56: 12, 57: 10, 58: 11, 122: 12, 123: 12, 124: 12,
    157: 11, 210: 12, 211: 12, 212: 12, 213: 12, 214: 12, 216: 11, 218: 11, 220: 10,
    221: 10, 222: 10, 223: 10, 224: 10, 230: 12, 235: 10, 402: 11, 403: 11,
    404: 11, 409: 11, 410: 11, 420: 11, 422: 11, 423: 11, 425: 11, 428: 11,
    430: 11, 431: 11, 432: 11, 434: 11, 450: 11, 497: 11, 502: 11, 540: 11,
    541: 11, 542: 11, 543: 11, 544: 11, 579: 12, 583: 12, 650: 12, 651: 12,
    652: 12, 653: 12, 654: 12, 655: 12, 661: 12, 668: 12, 701: 12, 702: 12,
    703: 12, 704: 12, 705: 12, 706: 10, 707: 10, 708: 10, 709: 10, 710: 10,
    711: 10, 921: 12,
}

# Afgrødekoder where the MP4 override (see _resolve_mp) actually applies.
# Unlike M, MP4 is NOT universal across every afgrøde whenever the forfrugt is
# in _LANGVARIG_FORFRUGT_KODER - only these 160 codes are eligible (source:
# Afgrødetabel2027_07092026_Udkast_3_pr_10_9_2026.xlsx, column "Udv.kat.
# Forfrugt Undt. (MP)" - codes with a value there, always MP4 in practice).
# 127 Lucernefrø is not eligible: the supplerende høring of October 2026 lists
# it in Bilag 2, table 12 as MP2 without an MP4 exception.
_MP4_BERETTIGET_KODER: frozenset[int] = frozenset({
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 21, 22,
    23, 24, 25, 26, 27, 30, 31, 32, 35, 36, 40, 41, 42, 51, 52, 53, 54, 55,
    56, 57, 58, 70, 71, 72, 120, 121, 122, 123, 124, 125, 149, 150,
    151, 152, 154, 155, 156, 157, 160, 161, 162, 182, 210, 211, 212, 213,
    214, 215, 216, 217, 218, 220, 221, 222, 223, 224, 225, 230, 234, 235,
    280, 281, 282, 283, 310, 324, 328, 342, 400, 401, 402, 403, 404, 405,
    406, 407, 408, 409, 410, 411, 412, 413, 415, 416, 417, 418, 420, 421,
    422, 423, 424, 425, 426, 427, 428, 429, 430, 431, 432, 434, 435, 440,
    448, 449, 450, 497, 501, 502, 510, 512, 513, 540, 541, 542, 543, 544,
    547, 548, 551, 552, 553, 579, 650, 651, 652, 653, 654, 655, 661, 701,
    702, 703, 704, 705, 706, 707, 708, 709, 710, 711,
})

# Fmajs (see engine.py's majs_m11_korrektionsfaktor) only applies when the
# CURRENT afgrøde is one of these six maize codes AND the forfrugt is one of
# these fourteen græs/kløvergræs codes (PUMR 2027 kravspec, Tabel A, felt
# A66) - NOT for every afgrøde whose M resolves to 11 via _FORFRUGT_M_OVERRIDE
# (that set also includes unrelated vegetable codes, e.g. Bladselleri).
_FMAJS_HOVEDAFGRODE_KODER: frozenset[int] = frozenset({5, 19, 216, 218, 423, 425})
_FMAJS_FORFRUGT_KODER: frozenset[int] = frozenset({
    173, 174, 236, 237, 256, 261, 277, 279, 285, 286, 943, 944, 945, 946,
})

# Udlægskode -> W when the udlæg itself determines the winter cover, such as
# efterafgrøde or udlæg til frø. Ported from UDL_W_MAPPING in streamlit_app.py;
# only used for codes without a table 7 W (the lookup's own markers 2000/968x).
# Mellemafgrøde and tidlig såning give no W: the vintersæd sown after them is the
# vinterplantedække (Afgrøde beslutningstræ, ark W), so next year's afgrøde decides.
# Neither does frøgræs that continues after harvest (9680): it is the frøgræs
# itself, so its own W applies (table 8, agreed with Anders 2026-10-09).
_BAR_JORD_KODE = 921
_STUB_KODE = 922

_UDL_W_MAPPING: dict[int, int | None] = {
    960: 4, 961: 4, 962: 4, 963: 4, 964: 4, 965: 4, 966: 4,
    968: 5,     # "Efterafgrøde, pligtig"
    950: 5, 951: 5, 952: 5, 953: 5, 954: 5,  # "Efterafgrøde" renbestand/udlæg varianter
    9680: None, # "Efterafgrøde e. frøgræs": the frøgræs itself
    9682: None, # Mellemafgrøde
    9683: None, # "Tidlig såning"
    9684: None, # "Mellemafgrøde e. frøgræs"
    970: 5,     # "Øvrige udlæg og efterafgrøder"
    2000: 4,    # "Udlæg til frø"
    # 921 "Bar jord" is the real afgrødekode the source data now uses for what
    # used to be the pseudo-code 3000 "Jordbearbejdning efterår" (converted in
    # Ny_sædskifte_lookup_sammenlagt.csv - see docs/nles5-kategorier.md's
    # udlægskode discussion). Keeps the same W3 "Autumn cultivation" outcome.
    921: 3,
    0: None,    # Explicitly no udlæg
}

# Udlægskode -> WP when the PREVIOUS position's own udlæg determines what
# covered the winter between the forfrugt and the current afgrøde (WP trin 1,
# docs/nles5-kategorier.md). Same source codes as _UDL_W_MAPPING above, mapped
# onto WP's 10-category scale (DCA rapport nr. 163, s. 24-25) instead of W's 8.
# Only used when the afgrøde table has no WP category for the code: the
# lookup's own markers (2000, 968x) are not afgrødekoder, and 960-966 still
# carry the table's WP11 placeholder. Mellemafgrøde and tidlig såning are
# virkemidler, not vinterplantedække: the efterårssået afgrøde after them
# covers the winter (§ 55, stk. 1, nr. 2), so it decides WP, as it decides W.
_UDL_WP_MAPPING: dict[int, int | None] = {
    960: 3, 961: 3, 962: 3, 963: 3, 964: 3, 965: 3, 966: 3,  # græs/kløvergræs udlæg -> WP3
    968: 4,     # "Efterafgrøde, pligtig" -> WP4
    950: 4, 951: 4, 952: 4, 953: 4, 954: 4,  # "Efterafgrøde" renbestand/udlæg varianter -> WP4
    9680: None, # "Efterafgrøde e. frøgræs": the frøgræs itself (its own WP5)
    9682: None, # Mellemafgrøde
    9683: None, # "Tidlig såning"
    9684: None, # "Mellemafgrøde e. frøgræs"
    970: 4,     # "Øvrige udlæg og efterafgrøder" -> WP4
    2000: 5,    # "Udlæg til frø" -> WP5 (Frøgræs og brak)
    # 921 "Bar jord" replaces the old pseudo-code 3000 in the source data (see
    # _UDL_W_MAPPING above); WP has no separate "autumn cultivation" category
    # distinct from plain bare soil (DCA rapport nr. 163's WP2 definition
    # already covers "no information on soil cultivation"), so this maps to
    # WP2 either way.
    921: 2,
    0: None,    # Explicitly no udlæg
}

# Udlægskode -> the NUAR virkemiddel automatically assigned to the position.
# Ported from streamlit_app.py's UDL_VIRKEMIDDEL. In the "select sædskifte from
# lookup" flow used by candidate_evaluator.py, EEA/EMA/ETS are not free user
# choices but direct consequences of the rotation's own udlægskode. Different
# `variant` values for one saedskiftevariant represent different virkemiddel
# combinations on the same afgrøde sequence (empirically confirmed:
# saedskiftevariant 315 variants 1/2/4 have identical afgrøde sequences but
# udl_kode 921/None/968 in position 4).
_UDL_VIRKEMIDDEL: dict[int, dict[str, bool]] = {
    968:  {"eea": True,  "ema": False, "ets": False},  # "Efterafgrøde, pligtig"
    950:  {"eea": True,  "ema": False, "ets": False},  # "Efterafgrøde" renbestand/udlæg varianter
    951:  {"eea": True,  "ema": False, "ets": False},
    952:  {"eea": True,  "ema": False, "ets": False},
    953:  {"eea": True,  "ema": False, "ets": False},
    954:  {"eea": True,  "ema": False, "ets": False},
    # "Efterafgrøde e. frøgræs" is the frøgræs continuing after harvest; it is
    # counted as the NLES5 afgrøde it is, not as a NUAR efterafgrøde (agreed
    # with Anders 2026-10-09, although § 39, nr. 9 allows it as one).
    9680: {"eea": False, "ema": False, "ets": False},
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
    # 921 "Bar jord" (the old pseudo-code 3000 "Jordbearbejdning efterår",
    # converted in the source data) is deliberately absent here: it has no
    # virkemiddel, same as the default _NO_VIRKEMIDDEL below.
    0:    {"eea": False, "ema": False, "ets": False},
}
_NO_VIRKEMIDDEL: dict[str, bool] = {"eea": False, "ema": False, "ets": False}

# Fixed NUAR EEA strength when efterafgrøde/udlæg is present (streamlit_app.py:
# `EEA = 0.45 if eea_on else 0.0`). The lower majs rate applies to the same 6
# majs-hovedafgrødekoder as Fmajs (PUMR, Tabel A: "Majs" er her defineret ved
# værdien 3 i Afgrødetabel 2027's kolonne "Praec.goedsk.eff.", som er
# nøjagtig samme 6 koder). It is the bekendtgørelse's 10 % (§ 44, stk. 2 in the
# supplerende høring), not the 0.15 "EffektUdlaegMajs" in SGAV's Parametre og
# konstanter.
_EEA_STRENGTH = 0.45
_EEA_STRENGTH_MAJS = 0.10
_EMA_STRENGTH = 0.20
_ETS_STRENGTH = 0.20
_PRAECISIONSJORDBRUG_EPJ = 0.04


def _resolve_w(
    afgrode_kode: int,
    this_params: dict,
    next_afgrode_kode: int | None,
    next_params: dict,
    udlaeg_kode: int | None,
) -> int:
    """Resolve W, the winter cover after this position's afgrøde.

    A landmand reports the vinterplantedække himself; here it is inferred from
    the rotation, in PUMR's order (Tabel A, felt A60; Bilag 2, tables 5-8),
    as agreed with Anders 2026-10-09:
    1. Græs, brak or frøgræs followed by vintersæd: table 7's W7 column.
    2. Græs ploughed after the harvest: a table 8 code (græs, kløvergræs and
       frøgræs) with "Bar jord" (921, the former "Jordbearbejdning efterår")
       as sekundær afgrøde gets its table 8 W ved ompløjning (W8). Without it
       the græs is assumed to stand through the winter (agreed with Anders
       2026-10-09), so it keeps its fixed W uden ompløjning in step 3.
    3. The afgrøde's fixed W (table 6). It beats any vinterplantedække after
       the afgrøde, so e.g. kartofler keep W6 before vintersæd and majs keeps
       W3 with an efterafgrøde.
    4. A sekundær afgrøde (udlæg or efterafgrøde) on this position: its table 7
       W, or _UDL_W_MAPPING for the lookup's own markers. Mellemafgrøde and
       frøgræs continuing after harvest give none.
    5. Next year's afgrøde has a table 7 W: that W, e.g. W1 for vintersæd, W6
       for vinterraps or a græsudlæg. An afgrøde in table 7 is assumed to be
       established in autumn (agreed with Anders 2026-10-09).
    6. Otherwise W5 (ukrudt og spildkornsplanter, as for 922 Stub).
    """
    langvarig = afgrode_kode in _LANGVARIG_FORFRUGT_KODER
    if langvarig and next_params.get("W_efter_graes"):
        return next_params["W_efter_graes"]
    if this_params.get("W_omploejning") and udlaeg_kode == _BAR_JORD_KODE:
        return this_params["W_omploejning"]
    if this_params.get("W") is not None:
        return this_params["W"]
    if udlaeg_kode is not None:
        udlaeg_w = afgroede_normer.lookup_crop_params(udlaeg_kode).get("W_efteraar")
        if udlaeg_w is None:
            udlaeg_w = _UDL_W_MAPPING.get(udlaeg_kode)
        if udlaeg_w is not None:
            return udlaeg_w
    if next_params.get("W_efteraar"):
        return next_params["W_efteraar"]
    return 5


def _har_vinterplantedaekke(
    afgrode_kode: int,
    this_params: dict,
    next_afgrode_kode: int | None,
    next_params: dict,
    udlaeg_kode: int | None,
) -> bool:
    """Whether a vinterplantedække other than bar jord or stub follows the afgrøde.

    PUMR, Tabel A, felt A64 gives an afgrøde marked in "NUAR ekstrakolonne 2"
    afstrømningskategori 1 when the reported vinterplantedække (felt A32) is
    not 921 Bar jord or 922 Stub. Inferred as in steps 4 and 5 of _resolve_w:
    a sekundær afgrøde on the position, or next year's afgrøde in table 7,
    which is assumed to be established in autumn - unless the same afgrøde
    with a fixed W simply continues, as nothing new is established then.
    """
    if udlaeg_kode not in (None, 0):
        return udlaeg_kode not in (_BAR_JORD_KODE, _STUB_KODE)
    continues = next_afgrode_kode == afgrode_kode and this_params.get("W") is not None
    return bool(next_params.get("W_efteraar")) and not continues


def _resolve_m(afgrode_kode: int, this_params: dict, prev_afgrode_kode: int | None) -> int:
    """Resolve M, overridden when the forfrugt was a langvarig afgrøde.

    Bilag 2, table M: this position's M is normally the afgrøde's own static
    M category, but shifts to a afgrøde-specific override (M10/M11/M12) when
    last year's afgrøde (forfrugt) was græs, kløvergræs, frøgræs or brak.
    """
    if prev_afgrode_kode in _LANGVARIG_FORFRUGT_KODER:
        override = _FORFRUGT_M_OVERRIDE.get(afgrode_kode)
        if override is not None:
            return override
    return this_params.get("M") or 1


def _resolve_mp(
    prev_params: dict,
    prev_afgrode_kode: int | None,
    prev_prev_afgrode_kode: int | None,
) -> int:
    """Resolve MP, the forfrugt effect, overridden to MP4 after a langvarig afgrøde.

    PUMR 2027 kravspec, Tabel A, felt A61: this position's MP is normally the
    forfrugt's own static MP category. It becomes MP4 (fixed, no per-afgrøde
    variant) when the FORFORFRUGT was græs, kløvergræs, frøgræs or brak AND the
    forfrugt is one of the 161 codes eligible for the override
    (_MP4_BERETTIGET_KODER). Unlike M, the trigger therefore looks two years
    back: græs -> vinterhvede -> vårbyg gives the vinterhvede MP3 (græs) and
    the vårbyg MP4.
    """
    if (
        prev_afgrode_kode in _MP4_BERETTIGET_KODER
        and prev_prev_afgrode_kode in _LANGVARIG_FORFRUGT_KODER
    ):
        return 4
    return prev_params.get("MP") or 1


# The afgrøde table's WP column (Bilag 2, table 10) classifies what an afgrøde
# represents when it stands in the WP window (the winter between the forfrugt
# and the current afgrøde). WP1/WP8 describe an autumn-sown CURRENT afgrøde
# occupying that winter; WP3/WP5/WP6 are afgrøder that stand through the
# winter after their own year, so they describe the FORFRUGT.
_WP_CATEGORIES = range(1, 11)
_AUTUMN_SOWN_WP = frozenset({1, 8})
_OVERWINTERING_WP = frozenset({3, 5, 6})

# M1 Vintersæd / M9 Vinterraps -> WP1/WP8 for an afgrøde without a WP
# category in the table (WP11 or missing). Any other M rules out autumn
# sowing even where table 10 gives WP1/WP8: it does so for spring-sown codes
# such as 180 Gul sennep (M13), describing them as a reported
# vinterplantedække rather than an afgrøde occupying the WP window.
_AUTUMN_SOWN_M_TO_WP: dict[int, int] = {1: 1, 9: 8}

# Forfrugter after which a bare winter is WP7 ("Bar jord efter majs eller
# kartofler", DCA rapport nr. 163, s. 24-25) rather than WP2.
_MAJS_KARTOFFEL_KODER: frozenset[int] = frozenset({
    5, 19, 216, 218, 423, 425,  # majs
    149, 150, 151, 152, 153, 154, 155, 156, 157,  # kartofler
})

# WP for a forfrugt that is not in the afgrøde table at all. Outside
# WP1-10, so engine.py's C_func applies its fixed WP_FALLBACK value.
_WP_UKENDT = 11


def _wp_category(params: dict) -> int | None:
    wp = params.get("WP")
    return wp if wp in _WP_CATEGORIES else None


def _resolve_wp(
    prev_afgrode_kode: int | None,
    prev_params: dict,
    this_params: dict,
    prev_udlaeg_kode: int | None,
) -> int:
    """Resolve WP as the winter cover between the previous and current afgrøde.

    In order (docs/nles5-kategorier.md):
    1. The forfrugt's sekundær afgrøde (prev_udlaeg_kode) stood in the WP
       window: its own WP from the afgrøde table, or _UDL_WP_MAPPING for the
       udlægskoder the table has no WP category for.
    2. The current afgrøde is autumn-sown (WP1/WP8) and occupies the window.
       Without a WP category in the table, its M (M1/M9) decides instead; a
       spring-sown M overrules a WP1/WP8 in the table.
    3. The forfrugt stood through the winter (WP3/WP5/WP6): its own WP.
    4. Otherwise the soil was bare: WP7 after a WP7 forfrugt (majs, kartofler,
       planteskole, blomsterløg) or after majs/kartofler, else WP2.
    """
    if prev_udlaeg_kode is not None:
        udlaeg_wp = _wp_category(afgroede_normer.lookup_crop_params(prev_udlaeg_kode))
        if udlaeg_wp is None:
            udlaeg_wp = _UDL_WP_MAPPING.get(prev_udlaeg_kode)
        if udlaeg_wp is not None:
            return udlaeg_wp
    this_wp = _wp_category(this_params)
    this_m = this_params.get("M")
    if this_wp is None:
        this_wp = _AUTUMN_SOWN_M_TO_WP.get(this_m)
    if this_wp in _AUTUMN_SOWN_WP and this_m in (None, *_AUTUMN_SOWN_M_TO_WP):
        return this_wp
    if prev_afgrode_kode is None:
        return _WP_UKENDT
    prev_wp = _wp_category(prev_params)
    if prev_wp in _OVERWINTERING_WP:
        return prev_wp
    return 7 if prev_wp == 7 or prev_afgrode_kode in _MAJS_KARTOFFEL_KODER else 2


@lru_cache(maxsize=20_000)
def evaluate_leaching_position(
    afgrode_kode: int,
    next_afgrode_kode: int | None,
    prev_afgrode_kode: int | None,
    prev_prev_afgrode_kode: int | None,
    udlaeg_kode: int | None,
    prev_udlaeg_kode: int | None,
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

    m = _resolve_m(afgrode_kode, this_params, prev_afgrode_kode)
    wc = this_params.get("WC") or 1
    mp = _resolve_mp(prev_params, prev_afgrode_kode, prev_prev_afgrode_kode)
    wp = _resolve_wp(prev_afgrode_kode, prev_params, this_params, prev_udlaeg_kode)
    w = _resolve_w(afgrode_kode, this_params, next_afgrode_kode, next_params, udlaeg_kode)

    # §24(7-9): N-fixing efterafgrøde (kvælstoffikserende renbestand/udlæg)
    # adds a flat 35 kg N/ha bonus, folded into F0 before the beta_f0 weighting
    # (PUMR 2027 kravspec, Tabel A, felt A57 + A82).
    fox = 35.0 if udlaeg_kode in (952, 953) else 0.0

    # Fmajs (majs_m11_korrektionsfaktor in engine.py) only applies to this
    # specific maize/forfrugt combination, not every afgrøde whose M happens
    # to resolve to 11 (PUMR 2027 kravspec, Tabel A, felt A66).
    fmajs_anvendt = (
        afgrode_kode in _FMAJS_HOVEDAFGRODE_KODER
        and prev_afgrode_kode in _FMAJS_FORFRUGT_KODER
    )

    vk = (
        _UDL_VIRKEMIDDEL.get(udlaeg_kode, _NO_VIRKEMIDDEL)
        if udlaeg_kode is not None
        else _NO_VIRKEMIDDEL
    )

    # The afgrøde and the vinterplantedække after it determine which of the
    # eight P values is used; see afstromning.py. Not every historical
    # afgrødekode is in Bilag 1
    # (e.g. administrative codes such as "slettet mark"); for those,
    # afstromningskategori() returns None and the position falls back to
    # leaching 0/ukendt below instead of blocking the whole mark on a missing
    # crop code. A genuinely missing P/S/Nt soil measurement still raises.
    vinterdaekke = _har_vinterplantedaekke(
        afgrode_kode, this_params, next_afgrode_kode, next_params, udlaeg_kode,
    )
    kategori = afstromning.afstromningskategori(afgrode_kode, vinterdaekke=vinterdaekke)
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
        "F0": f0 + fox, "F1": f1, "F2": f2,
        "FOx": fox,
        "G0": g0, "G1": g1, "G2": g2,
        "P_override": p_value, "S_override": s_soil,
        "afstromningskategori": kategori,
        "afstromningskategori_ukendt": kategori_ukendt,
        # Whether the vinterplantedække moved the afgrøde to its alternative
        # afstrømningskategori.
        "afstromning_vinterdaekke": (
            vinterdaekke and kategori != afstromning.afstromningskategori(afgrode_kode)
        ),
        "Fmajs_anvendt": fmajs_anvendt,
        # EEA/EMA/ETS are derived from the rotation's udlægskode (see
        # _UDL_VIRKEMIDDEL above), not freely selected. Fdato/precision_dagsbasis
        # is a scenarie-level Phase 8 setting applied equally to every year with
        # efterafgrøde. Efterafgrøde in maize has the lower statutory
        # 10 % effect (see _EEA_STRENGTH_MAJS); EMA and ETS each have a flat
        # 20 % effect.
        "EEA": (
            (_EEA_STRENGTH_MAJS if afgrode_kode in _FMAJS_HOVEDAFGRODE_KODER else _EEA_STRENGTH)
            if vk["eea"]
            else 0.0
        ),
        "Fdato": fdato, "precision_dagsbasis": precision_dagsbasis,
        "EMA": _EMA_STRENGTH if vk["ema"] else 0.0,
        "ETS": _ETS_STRENGTH if vk["ets"] else 0.0,
        "EPJ": (
            _PRAECISIONSJORDBRUG_EPJ
            if praecisionsjordbrug and praecisionsgoedskning_tilladt(afgrode_kode)
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
