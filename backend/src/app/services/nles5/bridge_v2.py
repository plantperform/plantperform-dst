"""Bridge mellem rigtige afgrødekoder og NLES5-motoren (engine.py).

Erstatter bridge.py's grove M-klasse-heuristikker (AUTO_W_BY_M, NEXT_M_TO_W,
WP-altid-1-stub) med rigtige per-afgrødekode M/W/MP/WP fra
services.rotations.afgroede_normer.lookup_crop_params(), samme kilde som
NUAR_koder-arket i Bilag 1-mastertabellen.

W-bestemmelsen er porteret fra c:\\plantperform-nles\\streamlit_app.py
(linje ~344-369): W for en given position afhænger af hvad der sås/pløjes
i efteråret — altså af NÆSTE positions afgrøde, ikke kun af afgrøden selv.
MP/WP for en given position er derimod FORRIGE positions egne MP/WP-felter
(forfrugtens forfrugtskategori/vinterdække).

P/S/NT kommer fra services.soil.percolation_placeholder (midlertidigt fladt
sæt, jf. planen — IKKE AAa/AAb/APb, som er bridge.py's forældede tilgang).
"""
from __future__ import annotations

from functools import lru_cache

from app.services.nles5.engine import calculate_leaching
from app.services.rotations import afgroede_normer
from app.services.soil.percolation_placeholder import percolation_placeholder

# next-year M-kode -> denne positions W (Bilag 2 tabel 6: "hvad sås/pløjes i
# efteråret afhænger af næste års M"). Samme mapping som bridge.py/streamlit_app.py.
_NEXT_M_TO_W: dict[int, int] = {1: 1, 9: 6, 10: 7, 11: 8, 12: 8}
_AUTUMNSOWN_M = frozenset({1, 9, 10})

# Udlægskode -> W, når udlægget selv bestemmer vinterdækket (fx efterafgrøde,
# mellemafgrøde, udlæg til frø). Porteret fra streamlit_app.py's UDL_W_MAPPING.
_UDL_W_MAPPING: dict[int, int | None] = {
    960: 4, 961: 4, 962: 4, 963: 4, 964: 4, 965: 4, 966: 4,
    968: 5,     # Efterafgrøde, pligtig
    9680: 4,    # Efterafgrøde e. frøgræs
    9682: 4,    # Mellemafgrøde
    9683: None, # Tidlig såning — W bestemmes af selve afgrøden
    9684: 4,    # Mellemafgrøde e. frøgræs
    970: 5,     # Øvrige udlæg og efterafgrøder
    2000: 4,    # Udlæg til frø
    3000: 3,    # Jordbearbejdning efterår
    0: None,    # Eksplicit ingen udlæg
}

# Udlægskode -> hvilket NUAR-virkemiddel positionen automatisk får. Porteret
# fra streamlit_app.py's UDL_VIRKEMIDDEL — i "vælg sædskifte fra lookup"-flowet
# (som candidate_evaluator.py bruger) er EEA/EMA/ETS IKKE et frit brugervalg,
# de er en direkte konsekvens af rotationens egen udlægskode. Forskellige
# `variant`-værdier for samme saedskiftevariant er netop forskellige
# virkemiddel-kombinationer på samme afgrødesekvens (bekræftet empirisk:
# saedskiftevariant 315, variant 1/2/4 har identisk afgrødesekvens, men
# udl_kode 3000/None/968 i position 4).
_UDL_VIRKEMIDDEL: dict[int, dict[str, bool]] = {
    968:  {"eea": True,  "ema": False, "ets": False},  # Efterafgrøde, pligtig
    9680: {"eea": True,  "ema": False, "ets": False},  # Efterafgrøde e. frøgræs
    9682: {"eea": False, "ema": True,  "ets": False},  # Mellemafgrøde
    9683: {"eea": False, "ema": False, "ets": True},   # Tidlig såning
    9684: {"eea": False, "ema": True,  "ets": False},  # Mellemafgrøde e. frøgræs
    960:  {"eea": False, "ema": False, "ets": False},
    961:  {"eea": False, "ema": False, "ets": False},
    962:  {"eea": False, "ema": False, "ets": False},
    963:  {"eea": False, "ema": False, "ets": False},
    964:  {"eea": False, "ema": False, "ets": False},
    965:  {"eea": False, "ema": False, "ets": False},
    966:  {"eea": False, "ema": False, "ets": False},
    970:  {"eea": True,  "ema": False, "ets": False},  # Øvrige udlæg og efterafgrøder
    2000: {"eea": False, "ema": False, "ets": False},  # Udlæg til frø
    3000: {"eea": False, "ema": False, "ets": False},  # Jordbearbejdning efterår
    0:    {"eea": False, "ema": False, "ets": False},
}
_NO_VIRKEMIDDEL: dict[str, bool] = {"eea": False, "ema": False, "ets": False}

# NUAR-fast EEA-styrke når efterafgrøde/udlæg er til stede (streamlit_app.py:
# `EEA = 0.45 if eea_on else 0.0`).
_EEA_STRENGTH = 0.45


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


@lru_cache(maxsize=100_000)
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
    y: int = 2024,
    afstromningskategori: int = 1,
    irrigated: bool = False,
    fdato: str = "20/8",
    precision_dagsbasis: bool = False,
) -> dict:
    """Beregn udvaskning for én sædskifte-position (kalder calculate_leaching)."""
    this_params = afgroede_normer.lookup_crop_params(afgrode_kode)
    next_params = afgroede_normer.lookup_crop_params(next_afgrode_kode) if next_afgrode_kode else {}
    prev_params = afgroede_normer.lookup_crop_params(prev_afgrode_kode) if prev_afgrode_kode else {}

    m = this_params.get("M") or 1
    wc = this_params.get("WC") or 1
    mp = prev_params.get("MP") or 1
    wp = prev_params.get("WP") or 1
    w = _resolve_w(this_params, next_params, udlaeg_kode)

    perc = percolation_placeholder(afstromningskategori)

    vk = _UDL_VIRKEMIDDEL.get(udlaeg_kode, _NO_VIRKEMIDDEL) if udlaeg_kode is not None else _NO_VIRKEMIDDEL

    sample = {
        "crop_code": afgrode_kode,
        "crop_name": this_params.get("navn", ""),
        "Y": y,
        "M": m, "W": w, "MP": mp, "WP": wp, "WC": wc,
        "jbnr": jbnr,
        "NT_source": "manual", "NT": perc["NT"],
        "MNCS": mncs, "MNCA": mnca, "MNudb": 0.0,
        "M1": m1, "M2": m2,
        "F0": f0, "F1": f1, "F2": f2,
        "G0": g0, "G1": g1, "G2": g2,
        "P_override": perc["P_override"], "S_override": perc["S_override"],
        # EEA/EMA/ETS er afledt af rotationens udlægskode (se _UDL_VIRKEMIDDEL
        # ovenfor) — ikke et frit valg. Fdato/precision_dagsbasis er en
        # scenarie-niveau-indstilling (jf. plan Fase 8), gælder ens for alle
        # år med efterafgrøde. EPJ er fortsat en fast placeholder-værdi.
        "EEA": _EEA_STRENGTH if vk["eea"] else 0.0,
        "Fdato": fdato, "precision_dagsbasis": precision_dagsbasis,
        "EMA": 0.0, "ETS": 0.0, "EPJ": 0.0,
        "mellemafgroede": vk["ema"], "early_sowing": vk["ets"],
    }
    # Sample slås sammen med beregningsresultatet, så leaching_detail bærer
    # både rå input (M, W, MP, WP, MNCS, ...) og udledte værdier (L, Ntheta,
    # C, ...) — nødvendigt for at kunne vise en fuld beregningsgennemgang
    # pr. år i UI'en (jf. streamlit_app.py's "Beregningsdetaljer pr. år").
    return {**sample, **calculate_leaching(sample)}
