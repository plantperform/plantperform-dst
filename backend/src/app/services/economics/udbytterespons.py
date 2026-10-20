"""Yield response to available N below the N-norm.

Konventionel source: ResponsTilKvotereduktion.xlsx (Kenneth Hansen, 2026-09-10), sheet
"Udbytterespons". The sheet gives yield at 100 % down to 50 % of the N-norm per
afgrøde and jordtype. Within each crop the curve is an exact quadratic in N, so
the relative yield loss is stored here as two coefficients:

    tab = a * r + b * r**2,   r = 1 - tilgængeligt N / N-norm

The fit reproduces the sheet to within 0.0002 percentage points. The relative
loss is applied on top of the master udbyttenorm; the sheet's own yields at
100 % match the master for every crop (Vinterhvede uses the sheet's second
Vinterhvede row, the one that matches the master udbyttenorm).

Økologisk source: the organic national field trials in ICOEL's OYUP WP2 data
(kg NH4-N, forfrugt korn), the NFTS organic rapeseed trials 2021-22 and the
decisions of 2026-10-13/19 (the WP2 udbyttekurver data basis and its
METODE.md). The form is the same, but a and b are relative to the temporary
organic N-norms in the master table. Vinterbyg and vinterhybridrug borrow
vinterhvede's and vinterrug's curves, and grass shares the konventionelle
curve per kg N. If the organic N-norms or udbyttenormer change, a and b must
be recalculated.

Only crops in the table for the driftsform may be fertilized below the norm.
Every other crop is fertilized at 100 % and keeps its full udbyttenorm.
"""
from __future__ import annotations

KONVENTIONEL = "Konventionel"
OEKOLOGISK = "Økologisk"

_JORDTYPER = (
    "grovsand", "finsand", "sandblandet_ler", "lerjord", "sandjord_vandet", "humusjord",
)

# Lowest N-norm share the curves are defined for. The model never fertilizes
# below it, so the curve is not extrapolated.
MIN_ANDEL = 0.5

# afgrødekode -> jordtype -> (a, b). Jordtype names follow the master CSV
# columns, see backend/database/scripts/load_afgroede_normer.py JORDTYPE.
_RESPONS: dict[int, dict[str, tuple[float, float]]] = {
    22: {  # Vinterraps
        "grovsand": (0.263595, 0.524593),
        "finsand": (0.22381, 0.475787),
        "sandblandet_ler": (0.206817, 0.458375),
        "lerjord": (0.200851, 0.451978),
        "sandjord_vandet": (0.22381, 0.475787),
        "humusjord": (0.152381, 0.220553),
    },
    11: {  # Vinterhvede
        "grovsand": (0.130053, 0.731017),
        "finsand": (0.108678, 0.635917),
        "sandblandet_ler": (0.0992226, 0.671905),
        "lerjord": (0.0999329, 0.719416),
        "sandjord_vandet": (0.115021, 0.752423),
        "humusjord": (0.0720431, 0.279469),
    },
    1: {  # Vårbyg
        "grovsand": (0.197907, 0.585606),
        "finsand": (0.167399, 0.481388),
        "sandblandet_ler": (0.144902, 0.44085),
        "lerjord": (0.142238, 0.450524),
        "sandjord_vandet": (0.177634, 0.592277),
        "humusjord": (0.124945, 0.268162),
    },
    10: {  # Vinterbyg
        "grovsand": (0.118033, 0.672397),
        "finsand": (0.101897, 0.545087),
        "sandblandet_ler": (0.0896467, 0.551152),
        "lerjord": (0.0896798, 0.58564),
        "sandjord_vandet": (0.107533, 0.64619),
        "humusjord": (0.0621968, 0.203084),
    },
    3: {  # Vårhavre
        "grovsand": (0.214302, 0.540517),
        "finsand": (0.176778, 0.426322),
        "sandblandet_ler": (0.156718, 0.37448),
        "lerjord": (0.1544, 0.382586),
        "sandjord_vandet": (0.193493, 0.560791),
        "humusjord": (0.120015, 0.196495),
    },
    15: {  # Vinterhybridrug
        "grovsand": (0.178016, 0.532019),
        "finsand": (0.14759, 0.452777),
        "sandblandet_ler": (0.138638, 0.460991),
        "lerjord": (0.140722, 0.50135),
        "sandjord_vandet": (0.161874, 0.544649),
        "humusjord": (0.0904591, 0.170083),
    },
    216: {  # Majshelsæd
        "grovsand": (0.149013, 0.430807),
        "finsand": (0.134211, 0.349468),
        "sandblandet_ler": (0.126939, 0.342686),
        "lerjord": (0.127643, 0.361692),
        "sandjord_vandet": (0.149039, 0.476538),
        "humusjord": (0.075, 0.109133),
    },
    260: {  # Græs med kløver/lucerne, under 50 % bælgplanter (omdrift)
        "grovsand": (0.396657, 0.165803),
        "finsand": (0.38892, 0.163705),
        "sandblandet_ler": (0.378048, 0.160787),
        "lerjord": (0.378048, 0.160787),
        "sandjord_vandet": (0.344386, 0.152007),
        "humusjord": (0.307895, 0.1026),
    },
    101: {  # Rajgræsfrø, alm.
        "grovsand": (0.224991, 0.934631),
        "finsand": (0.224991, 0.934631),
        "sandblandet_ler": (0.224991, 0.934631),
        "lerjord": (0.224991, 0.934631),
        "sandjord_vandet": (0.224991, 0.934631),
        "humusjord": (0.15, 0.415385),
    },
    151: {  # Kartofler, stivelses-
        "grovsand": (0.0891509, 0.611416),
        "finsand": (0.0789538, 0.531069),
        "sandblandet_ler": (0.0719715, 0.484104),
        "lerjord": (0.0719715, 0.484104),
        "sandjord_vandet": (0.0807916, 0.610028),
        "humusjord": (0.0557319, 0.264616),
    },
    160: {  # Sukkerroer til fabrik
        "grovsand": (0.120368, 0.768859),
        "finsand": (0.101082, 0.59819),
        "sandblandet_ler": (0.0845599, 0.512328),
        "lerjord": (0.0810777, 0.51408),
        "sandjord_vandet": (0.113116, 0.749094),
        "humusjord": (0.0529479, 0.164129),
    },
    263: {  # Græs uden kløvergræs (omdrift)
        "grovsand": (0.424638, 0.903878),
        "finsand": (0.411734, 0.902888),
        "sandblandet_ler": (0.400263, 0.903474),
        "lerjord": (0.400263, 0.903474),
        "sandjord_vandet": (0.379026, 0.90916),
        "humusjord": (0.339288, 0.613109),
    },
}
# Efterårssået vårbyg and vårhavre have the udbyttenorm of the spring-sown
# crop, so they follow its curve.
_RESPONS[70] = _RESPONS[1]
_RESPONS[72] = _RESPONS[3]


def _same_on_every_jordtype(a: float, b: float) -> dict[str, tuple[float, float]]:
    """The trials cannot tell the norm classes apart, so one curve covers all."""
    return dict.fromkeys(_JORDTYPER, (a, b))


_RESPONS_OEKO: dict[int, dict[str, tuple[float, float]]] = {
    1: _same_on_every_jordtype(0.127514, 0.180305),  # Vårbyg
    2: _same_on_every_jordtype(0.137871, 0.145294),  # Vårhvede
    3: _same_on_every_jordtype(0.127698, 0.152238),  # Vårhavre
    11: _same_on_every_jordtype(0.147713, 0.229401),  # Vinterhvede
    14: _same_on_every_jordtype(0.228957, 0.172329),  # Vinterrug
    22: _same_on_every_jordtype(0.278182, 0.005883),  # Vinterraps
    260: {  # Græs med kløver/lucerne, under 50 % bælgplanter (omdrift)
        "grovsand": (0.166126, 0.023863),
        "finsand": (0.163146, 0.023766),
        "sandblandet_ler": (0.150474, 0.023632),
        "lerjord": (0.149497, 0.023629),
        "sandjord_vandet": (0.148088, 0.023271),
        "humusjord": (0.133425, 0.015895),
    },
    263: {  # Græs uden kløvergræs (omdrift)
        "grovsand": (0.270011, 0.205265),
        "finsand": (0.261683, 0.207313),
        "sandblandet_ler": (0.272696, 0.24071),
        "lerjord": (0.272696, 0.24071),
        "sandjord_vandet": (0.237384, 0.207984),
        "humusjord": (0.187126, 0.126273),
    },
}
# Crops without trials borrow a sister crop's curve; efterårssået vårsæd
# follows the spring-sown crop, as in the konventionelle table.
_RESPONS_OEKO[10] = _RESPONS_OEKO[11]  # Vinterbyg
_RESPONS_OEKO[15] = _RESPONS_OEKO[14]  # Vinterhybridrug
_RESPONS_OEKO[70] = _RESPONS_OEKO[1]
_RESPONS_OEKO[71] = _RESPONS_OEKO[2]
_RESPONS_OEKO[72] = _RESPONS_OEKO[3]

_RESPONS_BY_DRIFTSFORM = {KONVENTIONEL: _RESPONS, OEKOLOGISK: _RESPONS_OEKO}


def _jordtype(jbnr: int, irrigated: bool) -> str | None:
    """Map a JB-nr to the master CSV jordtype group used for the N-norms."""
    if irrigated and jbnr in (1, 2, 3, 4):
        return "sandjord_vandet"
    if jbnr in (1, 3):
        return "grovsand"
    if jbnr in (2, 4, 10, 12):
        return "finsand"
    if jbnr in (5, 6):
        return "sandblandet_ler"
    if jbnr in (7, 8, 9):
        return "lerjord"
    if jbnr == 11:
        return "humusjord"
    return None


def _kurver(afgrodekode: int | None, driftsform: str) -> dict[str, tuple[float, float]] | None:
    return _RESPONS_BY_DRIFTSFORM.get(driftsform, {}).get(afgrodekode)


def har_udbytterespons(afgrodekode: int | None, driftsform: str) -> bool:
    """Whether the crop may be fertilized below its N-norm."""
    return _kurver(afgrodekode, driftsform) is not None


def udbytte_faktor(
    afgrodekode: int,
    jbnr: int,
    irrigated: bool,
    tilgaengelig_n: float,
    n_norm: float | None,
    driftsform: str = KONVENTIONEL,
) -> float:
    """Return the share of the udbyttenorm reached with `tilgaengelig_n`.

    `tilgaengelig_n` is applied mineral N plus forfrugtsværdi. At or above the
    N-norm the factor is 1. Below `MIN_ANDEL` the curve is held at its 50 %
    value, since the model never fertilizes that low.
    """
    kurver = _kurver(afgrodekode, driftsform)
    jordtype = _jordtype(jbnr, irrigated)
    if kurver is None or jordtype is None or not n_norm:
        return 1.0
    a, b = kurver[jordtype]
    andel = min(1.0, max(MIN_ANDEL, tilgaengelig_n / n_norm))
    r = 1.0 - andel
    return 1.0 - (a * r + b * r * r)
