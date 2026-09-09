"""Dækningsbidrag from the real SEGES 2026 data under ANGJ-data.

Crop work costs are quantity multiplied by a shared or crop-specific rate.
Yield is JB-, irrigation-, and driftsform-aware; prices are driftsform-aware.
Dynamic fertilizer costs replace the static fertilizer rows from source data.
"""
from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

import openpyxl

from app.services.virkemidler import KORN_OG_RAPS_KODER

_ROOT = Path(__file__).resolve().parents[4]  # .../backend
_DATA_DIR = _ROOT / "database" / "data" / "raw" / "ANGJ-data"

_SALGSPRISER_PATH = _DATA_DIR / "Salgspriser_afgroedekoder.csv"
_DYRKNINGSOMKOSTNINGER_PATH = _DATA_DIR / "Dyrkningsomkostninger_afgroedekoder.csv"
_HALMUDBYTTE_PATH = _DATA_DIR / "Halmudbytte_afgroedekoder.csv"
_ARBEJDSSATSER_PATH = _DATA_DIR / "Arbejdssatser.csv"
_ARBEJDSMAENGDER_PATH = _DATA_DIR / "Arbejdsmaengder_afgroedekoder.csv"
_PRISLISTE_PATH = _DATA_DIR / "Prisliste_2026.csv"
_NORMER_XLSX_PATH = (
    _DATA_DIR
    / "PlantPerform_master_afgroedenormer_opdateret_fra_hoeringsmateriale_Bilag_1_1_2027.xlsx"
)

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

# Tilskud der automatisk matches ind i DB (kr/ha) — resten af prislistens
# tilskud er tilvalgsordninger, se moduldocstring.
_GRUNDBETALING_POST = "Grundbetaling (estimat)"
_OEKO_AREALSTOETTE_POST = "Grundbeløb (basis)"
_STIVELSESKARTOFLER_POST = "Stivelseskartofler"
_STIVELSESKARTOFLER_KODE = 151

# Placeholder: gylle-udbringning har ingen ha-norm i prislisten (kun kr/ton),
# så vi genbruger handelsgødningens flade udbringningssats indtil videre.
_GYLLE_UDBRINGNING_PLACEHOLDER_POST = "Handelsgødning, udbringning"

# Fallback only when the master table has no organic row for a crop/JB pair.
_OEKO_UDBYTTE_REDUKTION = 0.32

# Udlægskode -> hvilken pris-kategori i prislisten dækker udsæd/etablering af
# dette udlæg. Samme kode-familie som bridge_v2.py's _UDL_VIRKEMIDDEL, men
# her grupperet efter hvilken FYSISK afgrøde der sås (ikke NUAR-virkemiddel-
# eligibilitet) — fx er 960-966 ("udlæg/eftersslæt" klovergræs) og 2000
# ("udlæg til frø") ikke NUAR-virkemidler, men koster stadig rigtig udsæd.
# 3000 (jordbearbejdning efterår) er ikke en sået afgrøde og har ingen post her.
_UDL_KOSTKATEGORI: dict[int, str] = {
    968: "Efterafgrøde", 970: "Efterafgrøde",
    9680: "Efterafgrøde, frøgræs",
    9682: "Mellemafgrøde",
    9684: "Mellemafgrøde, frøgræs",
    9683: "Tidlig såning",
    960: "Udlæg", 961: "Udlæg", 962: "Udlæg", 963: "Udlæg",
    964: "Udlæg", 965: "Udlæg", 966: "Udlæg", 2000: "Udlæg",
}


def _to_float(v) -> float | None:
    if v is None:
        return None
    s = str(v).strip().replace(",", ".")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_jb_set(match_type, jb_values_str) -> set[int]:
    s = str(jb_values_str).strip() if jb_values_str is not None else ""
    if not s or s.lower() == "none":
        return set()
    mt = str(match_type).strip().lower() if match_type else ""
    try:
        if mt == "plus":
            return {int(x) for x in s.split(";")}
        elif mt == "til":
            a, b = s.split("-")
            return set(range(int(a), int(b) + 1))
        elif mt == "enkelt":
            return {int(s)}
    except (ValueError, IndexError):
        pass
    return set()


@lru_cache(maxsize=1)
def _load_udbyttenormer() -> dict[tuple[int, int, str, str], dict]:
    """Index crop norms by crop, JB, irrigation category, and driftsform."""
    wb = openpyxl.load_workbook(_NORMER_XLSX_PATH, read_only=True, data_only=True)
    ws = wb["Lang_lookup"]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    lookup: dict[tuple[int, int, str, str], dict] = {}
    for row in rows[1:]:
        if not row[0]:
            continue
        try:
            code = int(row[0])
        except (ValueError, TypeError):
            continue

        jb_set = _parse_jb_set(row[5], row[6])
        if not jb_set:
            continue

        vanding = str(row[7]).strip() if row[7] else ""
        driftsform = str(row[25]).strip() if len(row) > 25 and row[25] else KONVENTIONEL
        data = {
            "udbytteenhed": str(row[9]).strip() if row[9] else "",
            "udbyttenorm": _to_float(row[10]),
            "n_norm": _to_float(row[13]),
        }
        for jb_nr in jb_set:
            lookup[(code, jb_nr, vanding, driftsform)] = data
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
    lookup: dict[tuple[int, str, str], dict] = {}
    with open(_SALGSPRISER_PATH, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=","):
            code = int(row["afgroedekode"])
            driftsform = row["driftsform"].strip()
            kvalitet = row.get("kvalitet", "").strip()
            lookup[(code, driftsform, kvalitet)] = {
                "salgspris": _to_float(row["salgspris"]) or 0.0,
                "enhed": row["enhed"].strip(),
                "halm_pris_kr_kg": _to_float(row.get("halm_pris_kr_kg")) or 0.0,
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
    lookup: dict[tuple[int, str], float] = {}
    with open(_HALMUDBYTTE_PATH, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            lookup[(int(row["afgroedekode"]), row["jordbonitet"].strip())] = (
                _to_float(row["halm_udbytte_kg_ha"]) or 0.0
            )
    return lookup


def _lookup_halm_udbytte(afgrodekode: int, jbnr: int, irrigated: bool) -> float:
    lookup = _load_halmudbytte()
    for jordbonitet in _jordbonitet_kandidater(jbnr, irrigated):
        hit = lookup.get((afgrodekode, jordbonitet))
        if hit is not None:
            return hit
    return 0.0


@lru_cache(maxsize=1)
def _load_arbejdssatser() -> dict[tuple[str, str], list[dict]]:
    lookup: dict[tuple[str, str], list[dict]] = {}
    with open(_ARBEJDSSATSER_PATH, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            code = row["afgroedekode"].strip()
            key = (row["behandling"].strip(), row["jordbonitet"].strip())
            lookup.setdefault(key, []).append({
                "afgrodekode": int(code) if code else None,
                "driftsform": row["driftsform"].strip(),
                "pris": _to_float(row["pris_kr_per_enhed"]) or 0.0,
            })
    return lookup


def _lookup_arbejdssats(
    behandling: str, jordbonitet: str, afgrodekode: int, driftsform: str,
) -> float:
    rates = _load_arbejdssatser()
    for candidate_jordbonitet in (jordbonitet, ""):
        universal = None
        for rate in rates.get((behandling, candidate_jordbonitet), []):
            if rate["afgrodekode"] == afgrodekode and rate["driftsform"] in (
                driftsform,
                "",
            ):
                return rate["pris"]
            if rate["afgrodekode"] is None:
                universal = rate["pris"]
        if universal is not None:
            return universal
    return 0.0


@lru_cache(maxsize=1)
def _load_arbejdsmaengder() -> dict[tuple[int, str, str, str], list[dict]]:
    lookup: dict[tuple[int, str, str, str], list[dict]] = {}
    with open(_ARBEJDSMAENGDER_PATH, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            key = (
                int(row["afgroedekode"]), row["driftsform"].strip(),
                row["jordbonitet"].strip(), row["kvalitet"].strip(),
            )
            lookup.setdefault(key, []).append({
                "kategori": row["kategori"].strip(),
                "behandling": row["behandling"].strip(),
                "antal": _to_float(row["antal"]) or 0.0,
            })
    return lookup


@lru_cache(maxsize=1)
def _migrerede_afgrodekoder() -> frozenset[int]:
    return frozenset(code for code, _, _, _ in _load_arbejdsmaengder())


@lru_cache(maxsize=1)
def _load_dyrkningsomkostninger() -> dict[tuple[int, str], list[dict]]:
    """(afgrodekode, driftsform) -> linjer, EKSKL. kategori "Gødning" (genberegnes dynamisk)."""
    lookup: dict[tuple[int, str], list[dict]] = {}
    with open(_DYRKNINGSOMKOSTNINGER_PATH, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=","):
            if row["kategori"].strip() == "Gødning":
                continue
            code = int(row["afgroedekode"])
            driftsform = row["driftsform"].strip()
            key = (code, driftsform)
            lookup.setdefault(key, []).append({
                "kategori": row["kategori"].strip(),
                "behandling": row["behandling"].strip(),
                "udgift_kr_ha": _to_float(row["udgift_kr_ha"]) or 0.0,
            })
    return lookup


def _lookup_omkostningslinjer(
    afgrodekode: int,
    driftsform: str,
    jbnr: int,
    irrigated: bool,
    kvalitet: str = "",
) -> list[dict]:
    if afgrodekode not in _migrerede_afgrodekoder():
        return _load_dyrkningsomkostninger().get((afgrodekode, driftsform), [])

    maengder = _load_arbejdsmaengder()
    for jordbonitet in _jordbonitet_kandidater(jbnr, irrigated):
        rows = maengder.get((afgrodekode, driftsform, jordbonitet, kvalitet))
        if rows is None:
            continue
        return [
            {
                "kategori": row["kategori"],
                "behandling": row["behandling"],
                "udgift_kr_ha": row["antal"] * _lookup_arbejdssats(
                    row["behandling"], jordbonitet, afgrodekode, driftsform,
                ),
            }
            for row in rows
        ]
    return []


@lru_cache(maxsize=1)
def _load_prisliste() -> dict[str, dict]:
    """post -> {kategori, type, pris, enhed} fra prislisten (både Omkostning og Tilskud)."""
    lookup: dict[str, dict] = {}
    with open(_PRISLISTE_PATH, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=";"):
            post = row["post"].strip()
            lookup[post] = {
                "kategori": row["kategori"].strip(),
                "type": row["type"].strip(),
                "pris": _to_float(row["pris"]) or 0.0,
                "enhed": row["enhed"].strip(),
            }
    return lookup


def _n_pris() -> float:
    return _load_prisliste()["Handelsgødning, kvælstof (N)"]["pris"]


def _n_udbringning() -> float:
    return _load_prisliste()["Handelsgødning, udbringning"]["pris"]


_MAJSHELSAED_KODE = 216


def _udlaeg_omkostning(
    udlaeg_kode: int | None,
    afgrodekode: int | None = None,
) -> tuple[float, float]:
    """(udsæd, etablering) kr/ha for et efterafgrøde-/mellemafgrøde-/udlæg-
    udlæg på denne position — (0, 0) hvis intet udlæg eller en kode uden
    prissat kategori (fx 3000, jordbearbejdning)."""
    kategori = _UDL_KOSTKATEGORI.get(udlaeg_kode) if udlaeg_kode is not None else None
    if kategori is None:
        return 0.0, 0.0
    if kategori == "Efterafgrøde" and afgrodekode == _MAJSHELSAED_KODE:
        kategori = "Efterafgrøde, majshelsæd"

    prisliste = _load_prisliste()
    udsaed = prisliste.get(f"{kategori}, udsæd", {}).get("pris", 0.0)
    etablering = prisliste.get(f"{kategori}, etablering", {}).get("pris", 0.0)
    return udsaed, etablering


def _tilskud_kr_ha(afgrodekode: int, driftsform: str) -> float:
    prisliste = _load_prisliste()
    total = prisliste[_GRUNDBETALING_POST]["pris"]
    if driftsform == OEKOLOGISK:
        total += prisliste[_OEKO_AREALSTOETTE_POST]["pris"]
    if afgrodekode == _STIVELSESKARTOFLER_KODE:
        total += prisliste[_STIVELSESKARTOFLER_POST]["pris"]
    return total


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
) -> dict:
    """Beregn dækningsbidrag (kr/ha) for én (afgrødekode, driftsform, JB-nr).

    mncs: kg N/ha total tilført forårs-mineral-N (handelsgødning + evt.
    udnyttet organisk N). Default = afgrødens egen Bilag 1 N-norm (100 %) for
    det givne JB-nr — erstattes senere af den faktiske MNCS fra en konkret
    sædskifte-position.

    org_mineral_n_applied: hvor meget af `mncs` der kommer fra organisk
    gødning (gylle) frem for handelsgødning — kun den resterende del
    (`mncs - org_mineral_n_applied`) prissættes til handelsgødningens N-pris;
    gylle-delen koster kun udbringning (jf. "gylle skal kun koste
    udbringningsprisen"). Gælder også for KONVENTIONELLE gylle-kategorier
    (fx svinegylle/kvæggylle-sædskifter), ikke kun økologisk.

    only_organic: scenariets gødningsvalg (Fase 13's GodningSettings) —
    IKKE det samme som driftsform. Om handelsgødning må toppe MNCS op ud
    over den organiske tildeling afgøres af denne, ikke af driftsform (en
    Økologisk-mærket simulering kan sagtens have only_organic=False, og skal
    så også prissættes for den resterende handelsgødning).

    udlaeg_kode: rotationspositionens udlægskode (samme kode som
    bridge_v2.evaluate_leaching_position modtager) — bestemmer om der lægges
    en ekstra udsæds-/etableringsomkostning oveni for efterafgrøde/
    mellemafgrøde/udlæg (se _udlaeg_omkostning).
    """
    norm, er_reel_oeko_norm = _lookup_udbyttenorm(
        afgrodekode, jbnr, irrigated, driftsform,
    )
    pris = _lookup_salgspris(afgrodekode, driftsform, kvalitet)

    salgspris = pris["salgspris"] if pris else 0.0
    halm_pris = pris["halm_pris_kr_kg"] if pris else 0.0
    halm_indtaegt = _lookup_halm_udbytte(afgrodekode, jbnr, irrigated) * halm_pris
    if norm is not None:
        udbytte = norm["udbyttenorm"] or 0.0
        udbytteenhed = norm["udbytteenhed"]
        norm_mangler = False
    elif salgspris == 0.0:
        # Ingen udbyttenorm nødvendig når der ikke er nogen salgsværdi (fx brak).
        udbytte = 0.0
        udbytteenhed = ""
        norm_mangler = False
    else:
        udbytte = 0.0
        udbytteenhed = ""
        norm_mangler = True  # afgrødekode findes ikke i Bilag 1-mastertabellen for dette JB-nr

    if driftsform == OEKOLOGISK and not er_reel_oeko_norm:
        udbytte *= 1 - _OEKO_UDBYTTE_REDUKTION

    indtaegt = udbytte * salgspris + halm_indtaegt

    if mncs is None:
        mncs = (norm["n_norm"] if norm else None) or 0.0

    # Itemiserede linjer bag hver kategori-sum, til UI'ens beregningsgennemgang
    # (hvilke enkeltposter der reelt summer til fx "Gødning" eller "Markarbejde").
    # Om handelsgødning må toppe MNCS op afgøres af only_organic — IKKE af
    # driftsform. En Økologisk-mærket simulering kan sagtens have
    # only_organic=False (Fase 13 afkoblede de to indstillinger), og skal så
    # også prissættes for den resterende handelsgødning, ligesom konventionel.
    goedning_linjer: list[dict] = []
    goedning = 0.0
    handelsgodning_n = 0.0 if only_organic else max(0.0, mncs - org_mineral_n_applied) + mnca
    if handelsgodning_n > 0:
        handelsgodning_kr = handelsgodning_n * _n_pris()
        goedning += handelsgodning_kr
        goedning_linjer.append({
            "kategori": "Gødning",
            "behandling": f"Handelsgødning, N ({handelsgodning_n:.0f} kg/ha)",
            "udgift_kr_ha": handelsgodning_kr,
        })
        n_udb = _n_udbringning()
        goedning += n_udb
        goedning_linjer.append({
            "kategori": "Gødning", "behandling": "Udbringning, handelsgødning",
            "udgift_kr_ha": n_udb,
        })
    if org_mineral_n_applied > 0:
        gylle_udb = _load_prisliste()[_GYLLE_UDBRINGNING_PLACEHOLDER_POST]["pris"]
        goedning += gylle_udb
        goedning_linjer.append({
            "kategori": "Gødning", "behandling": "Udbringning, husdyrgødning",
            "udgift_kr_ha": gylle_udb,
        })

    linjer = list(
        _lookup_omkostningslinjer(afgrodekode, driftsform, jbnr, irrigated, kvalitet)
    )
    udlaeg_udsaed, udlaeg_etablering = _udlaeg_omkostning(udlaeg_kode, afgrodekode)
    if udlaeg_udsaed:
        linjer.append({
            "kategori": "Udsæd", "behandling": "Udlæg/efterafgrøde, udsæd",
            "udgift_kr_ha": udlaeg_udsaed,
        })
    if udlaeg_etablering:
        linjer.append({
            "kategori": "Markarbejde", "behandling": "Udlæg/efterafgrøde, etablering",
            "udgift_kr_ha": udlaeg_etablering,
        })
    if praecisionsjordbrug and afgrodekode in KORN_OG_RAPS_KODER:
        linjer.append({
            "kategori": "Markarbejde",
            "behandling": "Præcisionsjordbrug",
            "udgift_kr_ha": _load_prisliste().get("Præcisionsjordbrug", {}).get("pris", 0.0),
        })
    alle_linjer = goedning_linjer + linjer

    udsaed = sum(line["udgift_kr_ha"] for line in linjer if line["kategori"] == "Udsæd")
    plantevaern = sum(
        line["udgift_kr_ha"] for line in linjer if line["kategori"] == "Planteværn"
    )
    markarbejde = sum(
        line["udgift_kr_ha"] for line in linjer if line["kategori"] == "Markarbejde"
    )
    toerring = sum(
        line["udgift_kr_ha"] for line in linjer if line["kategori"] == "Tørring/lagring"
    )
    andre_goedningsstoffer = sum(
        line["udgift_kr_ha"]
        for line in linjer
        if line["kategori"] == "Andre gødningsstoffer"
    )

    tilskud = _tilskud_kr_ha(afgrodekode, driftsform)
    omkostninger = (
        udsaed + goedning + plantevaern + markarbejde + toerring + andre_goedningsstoffer
    )
    db = indtaegt + tilskud - omkostninger

    return {
        "afgrodekode": afgrodekode,
        "driftsform": driftsform,
        "jbnr": jbnr,
        "kvalitet": kvalitet,
        "udbytte": udbytte,
        "udbytteenhed": udbytteenhed,
        "udbyttenorm_mangler": norm_mangler,
        "salgspris": salgspris,
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
        "linjer": alle_linjer,
    }
