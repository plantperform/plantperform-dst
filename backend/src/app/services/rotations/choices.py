"""Shared crop and udlæg options for farm editors and rotation definitions."""

from app.domain.base import CamelModel
from app.services.nles5.bridge_v2 import _FMAJS_HOVEDAFGRODE_KODER
from app.services.rotations import afgroede_normer
from app.services.virkemidler import virkemiddel_tilladt


class AfgrodeKodeOption(CamelModel):
    code: int
    navn: str


# Real afgrødekoder valid as a sekundær afgrøde/udlæg (Afgrødetabellens egen
# "Efterafgr"-flag, minus 921 "Bar jord" and the "Efterafgrøde type" family
# (950-954/968) below - those two groups have their own PUMR eligibility
# rules (Tabel A, felt A32) applied separately in list_udlaeg_koder.
# Hardcoded here rather than a new DB flag, matching how the virkemiddel-
# markers below are already hardcoded in bridge_v2.py
# (_MELLEMAFGROEDE_UDLAEG_KODER m.fl.) - Del 4 flytter dette til datalaget.
_REAL_UDLAEG_KODER: frozenset[int] = frozenset({
    922, 943, 944, 945, 946, 960, 961, 962, 963, 964, 965, 966, 970,
})

# PUMR, Tabel A, felt A32 "Vinterplantedække": "Skemavalidering: Kun
# økologer må have lov til at vælge afgrødekoden for Bar jord kode 921."
_BAR_JORD_KODE = 921

# PUMR, felt A32's "Efterafgrøde type"-undertype, valgt når Virkemiddel
# (A77) = "Efterafgrøder" (0). Yderligere indsnævret af hovedafgrødens egen
# majs-status og Grund6Procent-flag (docs/nles5-kategorier.md's
# udlægskode-afsnit):
# - Majs som hovedafgrøde: kun 953/954 må vælges.
# - Grund6Procent=1: alle 6 må vælges.
# - Grund6Procent=0 (og ikke majs): kun 950/951/952/968 må vælges.
_EFTERAFGRODE_TYPE_KODER: frozenset[int] = frozenset({950, 951, 952, 968, 953, 954})
_MAJS_EFTERAFGRODE_KODER: frozenset[int] = frozenset({953, 954})
_GRUND6PROCENT_FALSE_EFTERAFGRODE_KODER: frozenset[int] = frozenset({950, 951, 952, 968})

# Virkemiddel-markører (ikke rigtige afgrødekoder) som stadig er gyldige
# sekundær-afgrøde-valg i dag, jf. bridge_v2.py's _MELLEMAFGROEDE_UDLAEG_KODER/
# _TIDLIG_SAANING_UDLAEG_KODER. Alle fem (ikke kun mellemafgrøde/tidlig
# såning) skal med her, ellers kan pickeren ikke vise/vælge en position der
# allerede bruger en af dem (docs/nles5-kategorier.md's udlægskode-afsnit).
_VIRKEMIDDEL_UDLAEG_OPTIONS: tuple[AfgrodeKodeOption, ...] = (
    AfgrodeKodeOption(code=9682, navn="Mellemafgrøde"),
    AfgrodeKodeOption(code=9684, navn="Mellemafgrøde e. frøgræs"),
    AfgrodeKodeOption(code=9683, navn="Tidlig såning"),
    AfgrodeKodeOption(code=9680, navn="Efterafgrøde e. frøgræs"),
    AfgrodeKodeOption(code=2000, navn="Udlæg til frø"),
)


def list_afgrode_koder() -> list[AfgrodeKodeOption]:
    """Return real afgrødekoder (Bilag 1/NUAR) usable as a hovedafgrøde.

    Filtered on Afgrødetabellens own "Hovedafgrøde" flag, sorted by name for
    the afgrøde dropdown in the live Phase 10 "Rediger manuelt" calculation.
    Administrative/efterafgrøde-only codes (fx "Bar jord", "Ugyldig
    afgrødekode") are excluded even though they carry a fallback NUAR M
    value, since that value alone doesn't mean the code is a legitimate
    hovedafgrøde choice.
    """
    names = afgroede_normer.crop_names_from_normer()
    options = [
        AfgrodeKodeOption(code=code, navn=navn)
        for code, navn in names.items()
        if afgroede_normer.lookup_crop_params(code).get("er_hovedafgrode")
    ]
    return sorted(options, key=lambda o: o.navn)


def list_udlaeg_koder(
    hovedafgrode_kode: int | None = None,
    driftsform: str | None = None,
    naeste_afgrode_kode: int | None = None,
) -> list[AfgrodeKodeOption]:
    """Return the valid sekundær afgrøde/udlæg choices for the "Rediger
    manuelt" picker: real efterafgrøde-type afgrødekoder plus the five
    virkemiddel-markers (mellemafgrøde/tidlig såning/…) still recognized by
    bridge_v2.py. Sorted by name, like /afgrode-koder.

    hovedafgrode_kode and driftsform apply the PUMR Tabel A, felt A32
    "Vinterplantedække" eligibility rules for the position currently being
    edited (docs/nles5-kategorier.md's udlægskode-afsnit): "Bar jord" (921)
    for økologiske marker and, for every driftsform, after græs in Bilag 2,
    table 8, where it marks the græs as ploughed after the harvest (W8 ved
    ompløjning, see bridge_v2._resolve_w), and the "Efterafgrøde type" family
    (950-954/968) narrowed by the hovedafgrøde's own majs-status and
    Grund6Procent-flag. Mellemafgrøde and tidlig såning are offered only where
    virkemidler.virkemiddel_tilladt allows them after the hovedafgrøde and
    before naeste_afgrode_kode (next year's afgrøde). Every parameter is
    optional - omitting one skips only the rule(s) that depend on it, for
    callers that don't yet know the position's hovedafgrøde/driftsform.
    """
    names = afgroede_normer.crop_names_from_normer()
    options = [
        AfgrodeKodeOption(code=code, navn=navn)
        for code, navn in names.items()
        if code in _REAL_UDLAEG_KODER
    ]

    after_ploughable_graes = hovedafgrode_kode is not None and bool(
        afgroede_normer.lookup_crop_params(hovedafgrode_kode).get("W_omploejning")
    )
    if hovedafgrode_kode is None or driftsform == "Økologisk" or after_ploughable_graes:
        bar_jord_navn = names.get(_BAR_JORD_KODE)
        if bar_jord_navn is not None:
            options.append(AfgrodeKodeOption(code=_BAR_JORD_KODE, navn=bar_jord_navn))

    if hovedafgrode_kode is None:
        allowed_efterafgrode_koder = _EFTERAFGRODE_TYPE_KODER
    elif hovedafgrode_kode in _FMAJS_HOVEDAFGRODE_KODER:
        allowed_efterafgrode_koder = _MAJS_EFTERAFGRODE_KODER
    elif afgroede_normer.lookup_crop_params(hovedafgrode_kode).get("grund6procent"):
        allowed_efterafgrode_koder = _EFTERAFGRODE_TYPE_KODER
    else:
        allowed_efterafgrode_koder = _GRUND6PROCENT_FALSE_EFTERAFGRODE_KODER
    options.extend(
        AfgrodeKodeOption(code=code, navn=names[code])
        for code in allowed_efterafgrode_koder
        if code in names
    )

    options.extend(
        option
        for option in _VIRKEMIDDEL_UDLAEG_OPTIONS
        if hovedafgrode_kode is None
        or virkemiddel_tilladt(option.code, hovedafgrode_kode, naeste_afgrode_kode)
    )
    return sorted(options, key=lambda o: o.navn)


