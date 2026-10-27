"""Dækningsbidrag from the real SEGES 2026 data under ANGJ-data.

Crop work costs are quantity multiplied by a shared or crop-specific rate.
Yield is JB-, irrigation-, and driftsform-aware; prices are driftsform-aware.
Dynamic fertilizer costs replace the static fertilizer rows from source data.
"""

from __future__ import annotations

import json
from collections import defaultdict
from functools import lru_cache

from sqlalchemy import select

from app.data.db import (
    SessionLocal,
    afgroede_norm_lookup_table,
    afgroede_table,
    arbejdsmaengde_table,
    arbejdssats_table,
    dyrkningsomkostning_table,
    halmudbytte_table,
    prisliste_table,
    salgspris_table,
)
from app.services.economics.overrides import identifier, post_label, price_unit, quantity_id
from app.services.economics.udbytterespons import har_udbytterespons, udbytte_faktor
from app.services.rotations import saedskifte_library
from app.services.virkemidler import praecisionsgoedskning_tilladt

KONVENTIONEL = "Konventionel"
OEKOLOGISK = "Økologisk"

_VANDING_PRIORITY = {
    True: ["Vandet", "Ikke særskilt vanding", "Uvandet"],
    False: ["Uvandet", "Ikke særskilt vanding", "Vandet"],
}


def _jordbonitet_kandidater(jbnr: int, irrigated: bool) -> list[str]:
    if jbnr <= 4:
        return ["JB1-4", "JB1-3", "JB5-6"] if irrigated else ["JB1-3", "JB1-4", "JB5-6"]
    return ["JB5-6", "JB1-4", "JB1-3"]


# Subsidies automatically included in DB (DKK/ha). The remaining subsidies in
# the price list are optional schemes; see the module docstring.
_GRUNDBETALING_POST = "Grundbetaling (estimat)"
_OEKO_AREALSTOETTE_POST = "Grundbeløb (basis)"
_STIVELSESKARTOFLER_POST = "Stivelseskartofler"
_STIVELSESKARTOFLER_KODE = 151

# Husdyrgødning is spread per tonne: the price list's trailing-hose rate times
# the tonnes applied (utilized N / the gødning's utilized N per tonne). Buying
# it is priced the same way, at a standard of 0 kr/tonne.
_GYLLE_UDBRINGNING_POST = "Gylleudbringning, slæbeslanger"
_GYLLE_UDBRINGNING_LABEL = "Udbringning, husdyrgødning"
_GYLLE_KOEB_POST = "Husdyrgødning, køb"
_GYLLE_KOEB_LABEL = "Husdyrgødning, køb"

# The Halmpresning quantity is the kg of straw the budget presses.
_HALMPRESNING = "Halmpresning"
# Besides drying and storage, these are priced per kg of the harvest.
_PER_KG_HARVESTED = frozenset({"Rensning", "Sortering af kartofler", "Fragt"})
_KG_PER_HKG = 100
# The irrigation rows are SEGES' "vandet" sheet. Some crops, such as potatoes,
# have it as their only JB1-4 sheet, so an unirrigated field would pick it up.
_VANDING = "Vanding"

# Potatoes are sorted before they are sold, and the culls (frasorterede
# kartofler) sell at a fraction of the sorted price, which is its own
# salgspris row. SEGES culls 6.600 of 43.700 kg konventionelle spisekartofler,
# 5.700 of 37.800 kg læggekartofler and, økologisk, 3.500 of 23.500 kg
# læggekartofler; the økologiske spisekartofler calculation sells no culls.
_FRASORTERET_KVALITET = "Frasorterede"
_FRASORTERET_ANDEL = {
    (149, KONVENTIONEL): 0.151,
    (152, KONVENTIONEL): 0.151,
    (149, OEKOLOGISK): 0.149,
}
_SORTEREDE_KARTOFLER = "Sorterede kartofler"
_FRASORTEREDE_KARTOFLER = "Frasorterede kartofler"

# Fallback only when the master table has no organic row for a crop/JB pair.
_OEKO_UDBYTTE_REDUKTION = 0.32

# Efterårssået vårsæd is grown and sold as the spring-sown crop, which is the
# one the budgetkalkuler price; the codes have no economics rows of their own.
_KALKULE_KODE: dict[int, int] = {70: 1, 71: 2, 72: 3}

# Udlægskode -> the price-list category covering seed/establishment for this
# udlæg. This uses the same code family as bridge_v2.py's _UDL_VIRKEMIDDEL but
# groups by the PHYSICAL afgrøde being sown, not NUAR virkemiddel eligibility.
# For example, 960-966 ("udlæg/eftersslæt" clover grass) and 2000 ("udlæg til
# frø") are not NUAR virkemidler but still incur actual seed costs. Code 921
# ("Bar jord", replaces the old pseudo-code 3000 "Jordbearbejdning efterår"
# in the source data - see docs/nles5-kategorier.md) is not a sown afgrøde
# and has no entry here.
_UDL_KOSTKATEGORI: dict[int, str] = {
    968: "Efterafgrøde",
    970: "Efterafgrøde",
    9680: "Efterafgrøde, frøgræs",
    9682: "Mellemafgrøde",
    9684: "Mellemafgrøde, frøgræs",
    9683: "Tidlig såning",
    960: "Udlæg",
    961: "Udlæg",
    962: "Udlæg",
    963: "Udlæg",
    964: "Udlæg",
    965: "Udlæg",
    966: "Udlæg",
    2000: "Udlæg",
}


def _fetch_rows(table, task_name: str):
    with SessionLocal() as session:
        rows = session.execute(select(table).order_by(table.c.source_order)).all()
    if not rows:
        raise RuntimeError(f"{table.name} is empty; run pixi run {task_name}")
    return rows


def clear_lookup_cache() -> None:
    """Reload imported reference data before preparing fresh stored history."""
    for cached in (
        _load_udbyttenormer,
        _load_salgspriser,
        _load_halmudbytte,
        _load_arbejdssatser,
        _load_arbejdsmaengder,
        _migrerede_budgetter,
        _afgroeder_i_saedskifter,
        _load_dyrkningsomkostninger,
        _load_prisliste,
        soil_variants,
        calculate_db,
    ):
        cached.cache_clear()


@lru_cache(maxsize=1)
def _load_udbyttenormer() -> dict[tuple[int, int, str, str], dict]:
    """Index database-loaded crop norms by crop, JB, irrigation, and system."""
    rows = _fetch_rows(afgroede_norm_lookup_table, "load-afgroeder")
    with SessionLocal() as session:
        units = dict(
            session.execute(
                select(
                    afgroede_table.c.afgroedekode,
                    afgroede_table.c.udbytteenhed,
                )
            ).all()
        )
    lookup: dict[tuple[int, int, str, str], dict] = {}
    for row in rows:
        data = {
            "udbytteenhed": units[row.afgroedekode],
            "udbyttenorm": row.udbyttenorm,
            "n_norm": row.n_norm,
        }
        lookup[(row.afgroedekode, row.jb_nr, row.vanding, row.driftsform)] = data
    return lookup


def _lookup_udbyttenorm(
    afgrodekode: int,
    jb_nr: int,
    irrigated: bool = False,
    driftsform: str = KONVENTIONEL,
) -> tuple[dict | None, bool]:
    lut = _load_udbyttenormer()
    if driftsform == OEKOLOGISK:
        for vanding in _VANDING_PRIORITY[bool(irrigated)]:
            key = (afgrodekode, jb_nr, vanding, OEKOLOGISK)
            if key in lut:
                return lut[key], True
    for vanding in _VANDING_PRIORITY[bool(irrigated)]:
        key = (afgrodekode, jb_nr, vanding, KONVENTIONEL)
        if key in lut:
            return lut[key], False
    return None, False


@lru_cache(maxsize=1)
def _load_salgspriser() -> dict[tuple[int, str, str], dict]:
    rows = _fetch_rows(salgspris_table, "load-oekonomital-afgroedebundet")
    lookup: dict[tuple[int, str, str], dict] = {}
    for row in rows:
        lookup[(row.afgroedekode, row.driftsform, row.kvalitet)] = {
            "sale_id": identifier("sale", row.afgroedekode, row.driftsform, row.kvalitet),
            "straw_id": identifier("straw", row.afgroedekode, row.driftsform, row.kvalitet),
            "salgspris": row.salgspris,
            "enhed": row.enhed,
            "halm_pris_kr_kg": row.halm_pris_kr_kg,
            "kilde": row.kilde,
            "halm_kilde": row.halm_kilde,
        }
    return lookup


def _lookup_salgspris(afgrodekode: int, driftsform: str, kvalitet: str = "") -> dict | None:
    lut = _load_salgspriser()
    for candidate_driftsform in (driftsform, "—"):
        hit = lut.get((afgrodekode, candidate_driftsform, kvalitet))
        if hit is not None:
            return hit
    if driftsform == OEKOLOGISK:
        return lut.get((afgrodekode, KONVENTIONEL, kvalitet))
    return None


@lru_cache(maxsize=1)
def _load_halmudbytte() -> dict[tuple[int, str], float]:
    rows = _fetch_rows(halmudbytte_table, "load-oekonomital-afgroedebundet")
    lookup: dict[tuple[int, str], float] = {}
    for row in rows:
        lookup[(row.afgroedekode, row.jordbonitet)] = row.halm_udbytte_kg_ha
    return lookup


def _lookup_halm_udbytte(
    afgrodekode: int,
    jbnr: int,
    irrigated: bool,
    driftsform: str = KONVENTIONEL,
    kvalitet: str = "",
) -> float:
    """Kg straw per ha that is sold, which is also the straw the budget presses.

    The budget's Halmpresning quantity is that straw, so the sale and the
    pressing share one amount. It matters for økologisk, whose straw is below
    the konventionel halmudbytte. Without a pressing line the halmudbytte applies.
    """
    maengder = _load_arbejdsmaengder()
    for jordbonitet in _jordbonitet_kandidater(jbnr, irrigated):
        rows = maengder.get((afgrodekode, driftsform, jordbonitet, kvalitet))
        if rows is None:
            continue
        pressing = next((row for row in rows if row["behandling"] == _HALMPRESNING), None)
        if pressing is not None:
            return pressing["antal"]
        break
    lookup = _load_halmudbytte()
    for jordbonitet in _jordbonitet_kandidater(jbnr, irrigated):
        hit = lookup.get((afgrodekode, jordbonitet))
        if hit is not None:
            return hit
    return 0.0


@lru_cache(maxsize=1)
def _load_arbejdssatser() -> dict[tuple[str, str], list[dict]]:
    rows = _fetch_rows(arbejdssats_table, "load-oekonomital-generelle-satser")
    lookup: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        key = (row.behandling, row.jordbonitet)
        lookup.setdefault(key, []).append(
            {
                "afgrodekode": row.afgroedekode,
                "driftsform": row.driftsform,
                "id": identifier(
                    "rate", row.behandling, row.jordbonitet, row.afgroedekode, row.driftsform
                ),
                "pris": row.pris_kr_per_enhed,
                "enhed": row.enhed,
                "kilde": row.kilde,
            }
        )
    return lookup


def _select_arbejdssats(
    behandling: str,
    jordbonitet: str,
    afgrodekode: int,
    driftsform: str,
) -> dict | None:
    rates = _load_arbejdssatser()
    for candidate_jordbonitet in (jordbonitet, ""):
        universal = None
        for rate in rates.get((behandling, candidate_jordbonitet), []):
            if rate["afgrodekode"] == afgrodekode and rate["driftsform"] in (
                driftsform,
                "",
            ):
                return rate
            if rate["afgrodekode"] is None:
                universal = rate
        if universal is not None:
            return universal
    return None


@lru_cache(maxsize=1)
def _load_arbejdsmaengder() -> dict[tuple[int, str, str, str], list[dict]]:
    rows = _fetch_rows(arbejdsmaengde_table, "load-oekonomital-afgroedebundet")
    lookup: dict[tuple[int, str, str, str], list[dict]] = {}
    for row in rows:
        key = (row.afgroedekode, row.driftsform, row.jordbonitet, row.kvalitet)
        lookup.setdefault(key, []).append(
            {
                "kategori": row.kategori,
                "behandling": row.behandling,
                "antal": row.antal,
            }
        )
    return lookup


@lru_cache(maxsize=1)
def soil_variants() -> dict[str, tuple[tuple[str, float], ...]]:
    groups: dict[tuple, dict[str, float]] = defaultdict(dict)
    for (behandling, _), rates in _load_arbejdssatser().items():
        for rate in rates:
            groups["rate", behandling, rate["afgrodekode"], rate["driftsform"]][rate["id"]] = rate[
                "pris"
            ]
    for (afgrodekode, driftsform, jordbonitet, kvalitet), rows in _load_arbejdsmaengder().items():
        for row in rows:
            key = ("work", afgrodekode, driftsform, kvalitet, row["kategori"], row["behandling"])
            groups[key][
                quantity_id(
                    afgrodekode,
                    "work",
                    driftsform,
                    jordbonitet,
                    kvalitet,
                    row["kategori"],
                    row["behandling"],
                )
            ] = row["antal"]
    return {
        variant: tuple(sorted(group.items()))
        for group in groups.values()
        if len(group) > 1
        for variant in group
    }


@lru_cache(maxsize=1)
def _migrerede_budgetter() -> frozenset[tuple[int, str]]:
    """The (afgrødekode, driftsform) pairs priced from arbejdsmængder.

    A driftsform without arbejdsmængder for the afgrøde falls back to the flat
    dyrkningsomkostninger of that driftsform, whatever the other one has.
    """
    return frozenset((code, driftsform) for code, driftsform, _, _ in _load_arbejdsmaengder())


@lru_cache(maxsize=1)
def _load_dyrkningsomkostninger() -> dict[tuple[int, str], list[dict]]:
    """Map (afgrodekode, driftsform) to rows excluding dynamically recalculated Gødning."""
    rows = _fetch_rows(dyrkningsomkostning_table, "load-oekonomital-afgroedebundet")
    lookup: dict[tuple[int, str], list[dict]] = {}
    for row in rows:
        if row.kategori == "Gødning":
            continue
        key = (row.afgroedekode, row.driftsform)
        lookup.setdefault(key, []).append(
            {
                "kategori": row.kategori,
                "behandling": row.behandling,
                "udgift_kr_ha": row.udgift_kr_ha,
                "kilde": row.kilde,
            }
        )
    return lookup


def _linje(
    kategori: str,
    behandling: str,
    maengde: float,
    pris: float,
    *,
    pris_id: str | None,
    maengde_id: str | None,
    enhed: str | None,
    kilde: str | None,
    navn: str | None = None,
    foelger_udbytte: bool = False,
) -> dict:
    return {
        "kategori": kategori,
        "behandling": behandling,
        "navn": navn or behandling,
        "udgift_kr_ha": maengde * pris,
        "maengde": maengde,
        "pris": pris,
        "pris_id": pris_id,
        "maengde_id": maengde_id,
        "enhed": enhed,
        "kilde": kilde,
        "foelger_udbytte": foelger_udbytte,
    }


def _lookup_omkostningslinjer(
    afgrodekode: int,
    driftsform: str,
    jbnr: int,
    irrigated: bool,
    kvalitet: str = "",
    economics: dict | None = None,
) -> list[dict]:
    prices = (economics or {}).get("prices", {})
    quantities = (economics or {}).get("quantities", {})
    if (afgrodekode, driftsform) not in _migrerede_budgetter():
        lines = []
        for row in _load_dyrkningsomkostninger().get((afgrodekode, driftsform), []):
            pris_id = identifier(
                "cost", afgrodekode, driftsform, row["kategori"], row["behandling"]
            )
            maengde_id = quantity_id(
                afgrodekode, "cost", driftsform, row["kategori"], row["behandling"]
            )
            lines.append(
                _linje(
                    row["kategori"],
                    row["behandling"],
                    quantities.get(maengde_id, 1.0),
                    prices.get(pris_id, row["udgift_kr_ha"]),
                    pris_id=pris_id,
                    maengde_id=maengde_id,
                    enhed="kr/ha",
                    kilde=row["kilde"],
                )
            )
        return lines

    maengder = _load_arbejdsmaengder()
    for jordbonitet in _jordbonitet_kandidater(jbnr, irrigated):
        rows = maengder.get((afgrodekode, driftsform, jordbonitet, kvalitet))
        if rows is None:
            continue
        lines = []
        for row in rows:
            if not irrigated and row["behandling"].startswith(_VANDING):
                continue
            maengde_id = quantity_id(
                afgrodekode,
                "work",
                driftsform,
                jordbonitet,
                kvalitet,
                row["kategori"],
                row["behandling"],
            )
            rate = _select_arbejdssats(row["behandling"], jordbonitet, afgrodekode, driftsform)
            lines.append(
                _linje(
                    row["kategori"],
                    row["behandling"],
                    quantities.get(maengde_id, row["antal"]),
                    prices.get(rate["id"], rate["pris"]) if rate else 0.0,
                    pris_id=rate["id"] if rate else None,
                    maengde_id=maengde_id,
                    enhed=rate["enhed"] if rate else None,
                    kilde=rate["kilde"] if rate else None,
                )
            )
        return lines
    return []


def har_omkostningsbudget(afgrodekode: int, driftsform: str) -> bool:
    """Whether the økonomital hold a cost budget for the afgrøde and driftsform."""
    kode = _KALKULE_KODE.get(afgrodekode, afgrodekode)
    return (kode, driftsform) in _migrerede_budgetter() or bool(
        _load_dyrkningsomkostninger().get((kode, driftsform))
    )


@lru_cache(maxsize=1)
def _afgroeder_i_saedskifter() -> frozenset[int]:
    """The afgrøder some sædskifte grows, which the simulations choose between."""
    return frozenset(
        int(position[0])
        for saedskifte, variant in saedskifte_library.list_all_saedskifte_refs()
        for position in saedskifte_library.get_raw_rotation(saedskifte, variant)
        if position[0]
    )


def mangler_oekonomi(afgrodekode: int, driftsform: str) -> bool:
    """Whether an afgrøde has no real economics, so no dækningsbidrag.

    Without a cost budget an afgrøde would get a dækningsbidrag made of the
    grundbetaling and a price that nothing was subtracted from. The afgrøder a
    sædskifte grows are kept, budget or not: the simulations compare their
    dækningsbidrag, and a figure of 0 would only steer the optimization away
    from them.
    """
    if har_omkostningsbudget(afgrodekode, driftsform):
        return False
    return afgrodekode not in _afgroeder_i_saedskifter()


def manure_prices() -> dict[str, dict | None]:
    """The two husdyrgødning prices per tonne a profile can set.

    They are listed whether or not a budget row uses them: the standard budget
    spreads no husdyrgødning, but a simulation that does uses the prices, on
    both driftsformer. A price missing from an older price list is None.
    """
    prisliste = _load_prisliste()

    def price(post: str, label: str) -> dict | None:
        entry = prisliste.get(post)
        if entry is None:
            return None
        return dict(
            id=identifier("list", post),
            label=label,
            unit=price_unit(entry["enhed"]),
            value=entry["pris"],
            source=entry["kilde"],
        )

    return {
        "spreading": price(_GYLLE_UDBRINGNING_POST, _GYLLE_UDBRINGNING_LABEL),
        "purchase": price(_GYLLE_KOEB_POST, _GYLLE_KOEB_LABEL),
    }


@lru_cache(maxsize=1)
def _load_prisliste() -> dict[str, dict]:
    """Map post to price-list data for both Omkostning and Tilskud."""
    rows = _fetch_rows(prisliste_table, "load-oekonomital-generelle-satser")
    lookup: dict[str, dict] = {}
    for row in rows:
        lookup[row.post] = {
            "kategori": row.kategori,
            "type": row.type,
            "pris": row.pris,
            "enhed": row.enhed,
            "kilde": row.kilde,
        }
    return lookup


_STORED_LINE_KEYS = ("kategori", "behandling", "udgift_kr_ha")
_N_POST = "Handelsgødning, kvælstof (N)"
_N_UDBRINGNING_POST = "Handelsgødning, udbringning"
_MAJSHELSAED_KODE = 216


def _udlaeg_kategori(udlaeg_kode: int | None, afgrodekode: int) -> str | None:
    """The price-list category for the position's udlæg seed and establishment.

    Covers efterafgrøde, mellemafgrøde, and other udlæg. None when there is no
    udlæg or its code has no priced category, such as 921 for bar jord.
    """
    kategori = _UDL_KOSTKATEGORI.get(udlaeg_kode) if udlaeg_kode is not None else None
    if kategori == "Efterafgrøde" and afgrodekode == _MAJSHELSAED_KODE:
        return "Efterafgrøde, majshelsæd"
    return kategori


def _tilskud_poster(afgrodekode: int, driftsform: str) -> list[str]:
    posts = [_GRUNDBETALING_POST]
    if driftsform == OEKOLOGISK:
        posts.append(_OEKO_AREALSTOETTE_POST)
    if afgrodekode == _STIVELSESKARTOFLER_KODE:
        posts.append(_STIVELSESKARTOFLER_POST)
    return posts


@lru_cache(maxsize=100_000)
def calculate_db(
    afgrodekode: int,
    driftsform: str,
    jbnr: int,
    mncs: float | None = None,
    mnca: float = 0.0,
    irrigated: bool = False,
    org_mineral_n_applied: float = 0.0,
    udlaeg_kode: int | None = None,
    only_organic: bool = False,
    kvalitet: str = "",
    praecisionsjordbrug: bool = False,
    forfrugtsvaerdi: float = 0.0,
    economics_key: str = "",
    itemized: bool = False,
    husdyrgodning_ton_pr_ha: float = 0.0,
) -> dict:
    """Calculate dækningsbidrag (DKK/ha) for an (afgrødekode, driftsform, JB-nr).

    mncs: Total spring-applied mineral N in kg N/ha (handelsgødning plus any
    utilized organisk N). The default is the afgrøde's own 100% Bilag 1 N norm
    for the given JB-nr and is later replaced by the actual MNCS for a specific
    sædskifte position.

    org_mineral_n_applied: The portion of `mncs` supplied by organisk gødning
    (gylle) rather than handelsgødning. Only the remainder
    (`mncs - org_mineral_n_applied`) is priced at the N price of
    handelsgødning; the gylle portion incurs only application costs. This also
    applies to konventionelle gylle categories, such as svinegylle/kvæggylle
    sædskifter, not only økologiske ones.

    husdyrgodning_ton_pr_ha: Tonnes of husdyrgødning spread per ha, the
    utilized N divided by the gødning's utilized N per tonne. The application
    is priced per tonne at the price list's trailing-hose rate, and the
    gødning itself at its purchase price per tonne.

    only_organic: The scenarie's gødning selection (Phase 13 GodningSettings),
    not the same as driftsform. This value, not driftsform, determines whether
    handelsgødning may top MNCS up beyond the organisk allocation. A simulering
    marked Økologisk can have only_organic=False and must then include the cost
    of the remaining handelsgødning.

    udlaeg_kode: The rotation position's udlægskode, also passed to
    bridge_v2.evaluate_leaching_position. It determines whether an additional
    seed/establishment cost is added for efterafgrøde, mellemafgrøde, or another
    udlæg (see _udlaeg_kategori).

    forfrugtsvaerdi: The forfrugt's N contribution (kg N/ha). Together with
    mncs and mnca it is the available N that the udbyttenorm is scaled by for
    crops with a yield-response curve (see economics.udbytterespons). Below
    the N-norm their yield drops; every other crop keeps its full udbyttenorm.

    An afgrøde without a cost budget that no sædskifte grows (see
    mangler_oekonomi) gets no indtægt, tilskud or omkostninger and a
    dækningsbidrag of 0, and `economics_missing` is true.
    """
    economics = json.loads(economics_key) if economics_key else {}
    prices = economics.get("prices", {})
    quantities = economics.get("quantities", {})
    yield_factor = 1 + economics.get("yield_pct", {}).get(str(afgrodekode), 0) / 100
    prisliste = _load_prisliste()

    def list_line(
        kategori, behandling, post, quantity=1.0, purpose=None, navn=None, optional=False
    ):
        maengde_id = (
            quantity_id(afgrodekode, "fertiliser", purpose)
            if purpose
            else quantity_id(afgrodekode, "list", post)
        )
        pris_id = identifier("list", post)
        entry = prisliste.get(post, {}) if optional else prisliste[post]
        return _linje(
            kategori,
            behandling,
            quantities.get(maengde_id, quantity),
            prices.get(pris_id, entry.get("pris", 0.0)),
            pris_id=pris_id,
            maengde_id=maengde_id,
            enhed=entry.get("enhed"),
            kilde=entry.get("kilde"),
            navn=navn,
        )

    norm, er_reel_oeko_norm = _lookup_udbyttenorm(
        afgrodekode,
        jbnr,
        irrigated,
        driftsform,
    )
    kalkule_kode = _KALKULE_KODE.get(afgrodekode, afgrodekode)
    pris = _lookup_salgspris(kalkule_kode, driftsform, kvalitet)
    frasorteret_andel = _FRASORTERET_ANDEL.get((kalkule_kode, driftsform), 0.0)
    frasorteret = (
        _lookup_salgspris(kalkule_kode, driftsform, _FRASORTERET_KVALITET)
        if frasorteret_andel and not kvalitet
        else None
    )
    if frasorteret is None:
        frasorteret_andel = 0.0
    frasorteret_pris = (
        prices.get(frasorteret["sale_id"], frasorteret["salgspris"]) if frasorteret else 0.0
    )

    salgspris = prices.get(pris.get("sale_id"), pris["salgspris"]) if pris else 0.0
    halm_pris = prices.get(pris.get("straw_id"), pris["halm_pris_kr_kg"]) if pris else 0.0
    halm_udbytte = _lookup_halm_udbytte(kalkule_kode, jbnr, irrigated, driftsform, kvalitet)
    halm_indtaegt = halm_udbytte * halm_pris * yield_factor
    if norm is not None:
        udbytte = norm["udbyttenorm"] or 0.0
        udbytteenhed = norm["udbytteenhed"]
        norm_mangler = False
    elif salgspris == 0.0:
        # No udbyttenorm is needed when there is no sales value (e.g. brak).
        udbytte = 0.0
        udbytteenhed = ""
        norm_mangler = False
    else:
        udbytte = 0.0
        udbytteenhed = ""
        norm_mangler = True  # afgrødekode is absent from the Bilag 1 master table for this JB-nr

    if driftsform == OEKOLOGISK and not er_reel_oeko_norm:
        udbytte *= 1 - _OEKO_UDBYTTE_REDUKTION

    if mncs is None:
        mncs = (norm["n_norm"] if norm else None) or 0.0

    tilgaengelig_n = mncs + mnca + forfrugtsvaerdi
    faktor = 1.0
    # An organic curve is relative to the organic N-norm, so it needs the
    # crop's own organic row; on the konventionel fallback it would be off.
    respons = (
        norm is not None
        and har_udbytterespons(afgrodekode, driftsform)
        and (driftsform != OEKOLOGISK or er_reel_oeko_norm)
    )
    if respons:
        faktor = udbytte_faktor(
            afgrodekode, jbnr, irrigated, tilgaengelig_n, norm["n_norm"], driftsform
        )
        udbytte *= faktor

    udbytte *= yield_factor
    frasorteret_udbytte = udbytte * frasorteret_andel
    sorteret_udbytte = udbytte - frasorteret_udbytte
    indtaegt = sorteret_udbytte * salgspris + frasorteret_udbytte * frasorteret_pris + halm_indtaegt

    # Itemized rows behind each category total for the UI calculation
    # walkthrough, showing which entries actually total categories such as
    # "Gødning" or "Markarbejde". only_organic, not driftsform, determines
    # whether handelsgødning may top MNCS up. A simulering marked Økologisk can
    # have only_organic=False (Phase 13 decoupled the settings) and must then
    # price the remaining handelsgødning just like a konventionel simulering.
    goedning_linjer: list[dict] = []
    handelsgodning_n = 0.0 if only_organic else max(0.0, mncs - org_mineral_n_applied) + mnca
    economic_n = quantities.get(
        quantity_id(afgrodekode, "fertiliser", "mineralN"), handelsgodning_n
    )
    economic_spreading = quantities.get(
        quantity_id(afgrodekode, "fertiliser", "mineralSpreading"),
        1.0 if handelsgodning_n > 0 else 0.0,
    )
    if handelsgodning_n > 0 or economic_n > 0 or economic_spreading > 0:
        goedning_linjer.append(
            list_line(
                "Gødning",
                f"Handelsgødning, N ({economic_n:.0f} kg/ha)",
                _N_POST,
                quantity=handelsgodning_n,
                purpose="mineralN",
                navn="Handelsgødning, N",
            )
        )
        goedning_linjer.append(
            list_line(
                "Gødning",
                "Udbringning, handelsgødning",
                _N_UDBRINGNING_POST,
                quantity=1.0 if handelsgodning_n > 0 else 0.0,
                purpose="mineralSpreading",
            )
        )
    if (
        husdyrgodning_ton_pr_ha > 0
        or quantities.get(quantity_id(afgrodekode, "fertiliser", "manureSpreading"), 0.0) > 0
    ):
        goedning_linjer.append(
            list_line(
                "Gødning",
                _GYLLE_UDBRINGNING_LABEL,
                _GYLLE_UDBRINGNING_POST,
                quantity=husdyrgodning_ton_pr_ha,
                purpose="manureSpreading",
            )
        )
    if (
        husdyrgodning_ton_pr_ha > 0
        or quantities.get(quantity_id(afgrodekode, "fertiliser", "manurePurchase"), 0.0) > 0
    ):
        # Optional: an older price list has no purchase price, which then is 0.
        goedning_linjer.append(
            list_line(
                "Gødning",
                _GYLLE_KOEB_LABEL,
                _GYLLE_KOEB_POST,
                quantity=husdyrgodning_ton_pr_ha,
                purpose="manurePurchase",
                optional=True,
            )
        )
    goedning = sum(line["udgift_kr_ha"] for line in goedning_linjer)

    # Drying, storage, cleaning, sorting and freight priced per kg are the kg
    # actually harvested, so they take the yield after the response and the yield
    # percentage, not the kg of the budget's own yield. Other drying follows the
    # yield response. Pressing is priced per kg of straw, which follows the yield
    # percentage like the straw sold. Copies, since the static cost rows are cached.
    def follow_yield(line: dict) -> dict:
        per_kg_harvested = line.get("enhed") == "kr/kg" and (
            line["kategori"] == "Tørring/lagring" or line["behandling"] in _PER_KG_HARVESTED
        )
        if (
            per_kg_harvested
            and line["maengde_id"] not in quantities
            and udbytteenhed.startswith("hkg")
        ):
            harvested_kg = udbytte * _KG_PER_HKG
            return {
                **line,
                "udgift_kr_ha": harvested_kg * line["pris"],
                "maengde": harvested_kg,
                "foelger_udbytte": True,
            }
        if line["kategori"] == "Tørring/lagring" or per_kg_harvested:
            scale = faktor * yield_factor
        elif line["behandling"] == _HALMPRESNING:
            scale = yield_factor
        else:
            return line
        return {
            **line,
            "udgift_kr_ha": line["udgift_kr_ha"] * scale,
            "maengde": line["maengde"] * scale,
            "foelger_udbytte": True,
        }

    linjer = [
        follow_yield(line)
        for line in _lookup_omkostningslinjer(
            kalkule_kode,
            driftsform,
            jbnr,
            irrigated,
            kvalitet,
            **({"economics": economics} if economics_key else {}),
        )
    ]
    udlaeg_kategori = _udlaeg_kategori(udlaeg_kode, afgrodekode)
    if udlaeg_kategori:
        for kategori, behandling, post in (
            ("Udsæd", "Udlæg/efterafgrøde, udsæd", f"{udlaeg_kategori}, udsæd"),
            ("Markarbejde", "Udlæg/efterafgrøde, etablering", f"{udlaeg_kategori}, etablering"),
        ):
            line = list_line(kategori, behandling, post, optional=True)
            if line["udgift_kr_ha"]:
                linjer.append(line)
    if praecisionsjordbrug and praecisionsgoedskning_tilladt(afgrodekode):
        linjer.append(
            list_line("Markarbejde", "Præcisionsjordbrug", "Præcisionsjordbrug", optional=True)
        )
    alle_linjer = goedning_linjer + linjer

    udsaed = sum(line["udgift_kr_ha"] for line in linjer if line["kategori"] == "Udsæd")
    plantevaern = sum(line["udgift_kr_ha"] for line in linjer if line["kategori"] == "Planteværn")
    markarbejde = sum(line["udgift_kr_ha"] for line in linjer if line["kategori"] == "Markarbejde")
    toerring = sum(line["udgift_kr_ha"] for line in linjer if line["kategori"] == "Tørring/lagring")
    andre_goedningsstoffer = sum(
        line["udgift_kr_ha"] for line in linjer if line["kategori"] == "Andre gødningsstoffer"
    )

    ingen_oekonomi = mangler_oekonomi(afgrodekode, driftsform)
    if ingen_oekonomi:
        # Nothing to subtract from: no economics at all, rather than a
        # dækningsbidrag of the sales value and the grundbetaling.
        indtaegt = halm_indtaegt = goedning = andre_goedningsstoffer = 0.0
        udsaed = plantevaern = markarbejde = toerring = 0.0
        alle_linjer = []
    tilskud_linjer = (
        []
        if ingen_oekonomi
        else [
            list_line("Tilskud", post, post, navn=post_label(post))
            for post in _tilskud_poster(afgrodekode, driftsform)
        ]
    )
    tilskud = sum(line["udgift_kr_ha"] for line in tilskud_linjer)
    omkostninger = udsaed + goedning + plantevaern + markarbejde + toerring + andre_goedningsstoffer
    db = indtaegt + tilskud - omkostninger

    if itemized:
        indtaegt_linjer = []
        if pris is not None and (udbytte or salgspris):
            indtaegt_linjer.append(
                _linje(
                    "Indtægt",
                    _SORTEREDE_KARTOFLER if frasorteret else "Udbytte",
                    sorteret_udbytte,
                    salgspris,
                    pris_id=pris.get("sale_id"),
                    maengde_id=None,
                    enhed=pris.get("enhed"),
                    kilde=pris.get("kilde"),
                    foelger_udbytte=True,
                )
            )
        if frasorteret is not None and udbytte:
            indtaegt_linjer.append(
                _linje(
                    "Indtægt",
                    _FRASORTEREDE_KARTOFLER,
                    frasorteret_udbytte,
                    frasorteret_pris,
                    pris_id=frasorteret["sale_id"],
                    maengde_id=None,
                    enhed=frasorteret["enhed"],
                    kilde=frasorteret["kilde"],
                    foelger_udbytte=True,
                )
            )
        if pris is not None and halm_udbytte:
            indtaegt_linjer.append(
                _linje(
                    "Indtægt",
                    "Halm",
                    halm_udbytte * yield_factor,
                    halm_pris,
                    pris_id=pris.get("straw_id"),
                    maengde_id=None,
                    enhed="kr/kg",
                    kilde=pris.get("halm_kilde"),
                    foelger_udbytte=True,
                )
            )
        if ingen_oekonomi:
            indtaegt_linjer = []
        detail = {"indtaegt_linjer": indtaegt_linjer, "tilskud_linjer": tilskud_linjer}
    else:
        alle_linjer = [{key: line[key] for key in _STORED_LINE_KEYS} for line in alle_linjer]
        detail = {}

    return {
        "calculation_inputs": {
            "afgrodekode": afgrodekode,
            "driftsform": driftsform,
            "jbnr": jbnr,
            "mncs": mncs,
            "mnca": mnca,
            "irrigated": irrigated,
            "org_mineral_n_applied": org_mineral_n_applied,
            "udlaeg_kode": udlaeg_kode,
            "only_organic": only_organic,
            "kvalitet": kvalitet,
            "praecisionsjordbrug": praecisionsjordbrug,
            "forfrugtsvaerdi": forfrugtsvaerdi,
            "husdyrgodning_ton_pr_ha": husdyrgodning_ton_pr_ha,
        },
        "afgrodekode": afgrodekode,
        "driftsform": driftsform,
        "jbnr": jbnr,
        "kvalitet": kvalitet,
        "udbytte": udbytte,
        "udbytteenhed": udbytteenhed,
        "udbyttenorm_mangler": norm_mangler,
        "udbytterespons": respons,
        "udbytte_faktor": faktor,
        "tilgaengelig_n": tilgaengelig_n,
        "salgspris": salgspris,
        "frasorteret_andel": frasorteret_andel,
        "frasorteret_pris": frasorteret_pris,
        "halm_indtaegt": round(halm_indtaegt, 0),
        "indtaegt": round(indtaegt, 0),
        "tilskud": round(tilskud, 0),
        "mncs": mncs,
        "goedning": round(goedning, 0),
        "andre_goedningsstoffer": round(andre_goedningsstoffer, 0),
        "udsaed": round(udsaed, 0),
        "plantevaern": round(plantevaern, 0),
        "markarbejde": round(markarbejde, 0),
        "toerring": round(toerring, 0),
        "omkostninger_total": round(omkostninger, 0),
        "db": round(db, 0),
        "economics_missing": ingen_oekonomi,
        "linjer": alle_linjer,
        **detail,
    }
