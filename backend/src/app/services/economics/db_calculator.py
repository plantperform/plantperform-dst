"""Dækningsbidrag (DB) for de afgrødekoder der indgår i sædskifte-lookup.

Kobler fire kilder sammen, alle under database/data/raw/ANGJ-data/:
  - Testdata_salgspriser_afgroedekoder.csv       kr/hkg eller kr/FE, pr. (afgrødekode, driftsform)
  - Testdata_dyrkningsomkostninger_afgroedekoder.csv  kr/ha, itemiseret pr. kategori/behandling
  - midlertidig_test_prisliste_2026.csv          SEGES-satser: maskinomkostninger, tilskud, N-pris
  - PlantPerform_master_afgroedenormer_...xlsx (Lang_lookup)  udbyttenorm pr. (afgrødekode, JB-nr, vanding)

Udbyttenormen er allerede angivet i samme enhed som salgsprisen (hkg/ha mod
kr/hkg for kornafgrøder, FE/ha mod kr/FE for helsæd/græs), så
indtægt = udbyttenorm × salgspris virker uden særtilfælde for FE-afgrøder.

Mastertabellens udbyttenormer er kun for konventionel drift. Indtil der
findes rigtige øko-specifikke normer pr. afgrøde, reduceres udbyttet med en
fast sats (32 %) for alle afgrøder ved økologisk driftsform.

Gødningslinjen i dyrkningsomkostninger-filen er kun et fladt gæt og
IGNORERES her til fordel for en reel beregning:
  - Konventionel: (MNCS + MNCA) × N-pris (12,5 kr/kg N) + udbringning (115 kr/ha)
  - Økologisk (gylle): kun udbringningsomkostningen — gyllen værdisættes ikke
    her (bruger: "Gylle skal kun koste udbringningsprisen, det integrerer vi
    senere"). Prislisten har kun ton-baserede gylle-satser og ingen ha-norm
    for udbragt mængde, så der genbruges midlertidigt samme flade
    udbringningssats som den konventionelle (115 kr/ha) — tydeligt markeret
    som en forenkling, ikke en rigtig gylle-pris.

Udsæd, planteværn, markarbejde og tørring/lagring tages uændret fra
dyrkningsomkostninger-filen (stadig testdata/estimater — uændret i denne
omgang), UNDTAGEN for positioner med et prissat efterafgrøde-/mellemafgrøde-/
udlæg-udlæg (jf. bridge_v2.py's _UDL_VIRKEMIDDEL-familie) — her lægges en
ekstra udsæds- og etableringsomkostning fra prislisten oveni (se
_udlaeg_omkostning nedenfor), så virkemidlerne rent faktisk koster noget i
optimeringen i stedet for at være en gratis udvasknings-reduktion.

Tilskud lægges til DB:
  - Grundbetaling: alle rækker (generisk arealstøtte)
  - Økologisk arealstøtte, grundbeløb: kun økologiske rækker
  - Stivelseskartoffel-tilskud: kun afgrødekode 151
De øvrige tilskud i prislisten (bioordninger, pleje af natur/græs 5-årigt)
er tilvalgsordninger en bruger aktivt skal tilmelde sig pr. mark/tilsagn —
de anvendes IKKE automatisk her.
"""
from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

import openpyxl

_ROOT = Path(__file__).resolve().parents[4]  # .../backend
_DATA_DIR = _ROOT / "database" / "data" / "raw" / "ANGJ-data"

_SALGSPRISER_PATH = _DATA_DIR / "Testdata_salgspriser_afgroedekoder.csv"
_DYRKNINGSOMKOSTNINGER_PATH = _DATA_DIR / "Testdata_dyrkningsomkostninger_afgroedekoder.csv"
_PRISLISTE_PATH = _DATA_DIR / "midlertidig_test_prisliste_2026.csv"
_NORMER_XLSX_PATH = (
    _DATA_DIR / "PlantPerform_master_afgroedenormer_opdateret_fra_hoeringsmateriale_Bilag_1_1_2027.xlsx"
)

KONVENTIONEL = "Konventionel"
OEKOLOGISK = "Økologisk"

_VANDING_PRIORITY = {
    True: ["Vandet", "Ikke særskilt vanding", "Uvandet"],
    False: ["Uvandet", "Ikke særskilt vanding", "Vandet"],
}

# Tilskud der automatisk matches ind i DB (kr/ha) — resten af prislistens
# tilskud er tilvalgsordninger, se moduldocstring.
_GRUNDBETALING_POST = "Grundbetaling (estimat)"
_OEKO_AREALSTOETTE_POST = "Grundbeløb (basis)"
_STIVELSESKARTOFLER_POST = "Stivelseskartofler"
_STIVELSESKARTOFLER_KODE = 151

# Placeholder: gylle-udbringning har ingen ha-norm i prislisten (kun kr/ton),
# så vi genbruger handelsgødningens flade udbringningssats indtil videre.
_GYLLE_UDBRINGNING_PLACEHOLDER_POST = "Handelsgødning, udbringning"

# Placeholder: Bilag 1-mastertabellens udbyttenormer er kun for konventionel
# drift. Økologisk udbytte er typisk lavere; indtil der findes rigtige
# øko-specifikke normer pr. afgrøde, bruges en fast reduktion på alle
# afgrøder ved økologisk driftsform.
_OEKO_UDBYTTE_REDUKTION = 0.32

# Udlægskode -> hvilken pris-kategori i prislisten dækker udsæd/etablering af
# dette udlæg. Samme kode-familie som bridge_v2.py's _UDL_VIRKEMIDDEL, men
# her grupperet efter hvilken FYSISK afgrøde der sås (ikke NUAR-virkemiddel-
# eligibilitet) — fx er 960-966 ("udlæg/eftersslæt" klovergræs) og 2000
# ("udlæg til frø") ikke NUAR-virkemidler, men koster stadig rigtig udsæd.
# 3000 (jordbearbejdning efterår) er ikke en sået afgrøde og har ingen post her.
_UDL_KOSTKATEGORI: dict[int, str] = {
    968: "Efterafgrøde", 9680: "Efterafgrøde", 970: "Efterafgrøde",
    9682: "Mellemafgrøde", 9684: "Mellemafgrøde",
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
def _load_udbyttenormer() -> dict[tuple[int, int, str], dict]:
    """(afgrodekode, jb_nr, vanding) -> {udbyttenorm, udbytteenhed, n_norm}."""
    wb = openpyxl.load_workbook(_NORMER_XLSX_PATH, read_only=True, data_only=True)
    ws = wb["Lang_lookup"]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    lookup: dict[tuple[int, int, str], dict] = {}
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
        data = {
            "udbytteenhed": str(row[9]).strip() if row[9] else "",
            "udbyttenorm": _to_float(row[10]),
            "n_norm": _to_float(row[13]),
        }
        for jb_nr in jb_set:
            lookup[(code, jb_nr, vanding)] = data
    return lookup


def _lookup_udbyttenorm(afgrodekode: int, jb_nr: int, irrigated: bool = False) -> dict | None:
    lut = _load_udbyttenormer()
    for vanding in _VANDING_PRIORITY[bool(irrigated)]:
        key = (afgrodekode, jb_nr, vanding)
        if key in lut:
            return lut[key]
    return None


@lru_cache(maxsize=1)
def _load_salgspriser() -> dict[tuple[int, str], dict]:
    """(afgrodekode, driftsform) -> {salgspris, enhed}. driftsform "—" = fælles for begge."""
    lookup: dict[tuple[int, str], dict] = {}
    with open(_SALGSPRISER_PATH, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=","):
            code = int(row["afgroedekode"])
            driftsform = row["driftsform"].strip()
            lookup[(code, driftsform)] = {
                "salgspris": _to_float(row["salgspris"]) or 0.0,
                "enhed": row["enhed"].strip(),
            }
    return lookup


def _lookup_salgspris(afgrodekode: int, driftsform: str) -> dict | None:
    lut = _load_salgspriser()
    return lut.get((afgrodekode, driftsform)) or lut.get((afgrodekode, "—"))


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


def _udlaeg_omkostning(udlaeg_kode: int | None) -> tuple[float, float]:
    """(udsæd, etablering) kr/ha for et efterafgrøde-/mellemafgrøde-/udlæg-
    udlæg på denne position — (0, 0) hvis intet udlæg eller en kode uden
    prissat kategori (fx 3000, jordbearbejdning)."""
    kategori = _UDL_KOSTKATEGORI.get(udlaeg_kode) if udlaeg_kode is not None else None
    if kategori is None:
        return 0.0, 0.0

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

    udlaeg_kode: rotationspositionens udlægskode (samme kode som
    bridge_v2.evaluate_leaching_position modtager) — bestemmer om der lægges
    en ekstra udsæds-/etableringsomkostning oveni for efterafgrøde/
    mellemafgrøde/udlæg (se _udlaeg_omkostning).
    """
    norm = _lookup_udbyttenorm(afgrodekode, jbnr, irrigated)
    pris = _lookup_salgspris(afgrodekode, driftsform)

    salgspris = pris["salgspris"] if pris else 0.0
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

    if driftsform == OEKOLOGISK:
        udbytte *= 1 - _OEKO_UDBYTTE_REDUKTION

    indtaegt = udbytte * salgspris

    if mncs is None:
        mncs = (norm["n_norm"] if norm else None) or 0.0

    # Itemiserede linjer bag hver kategori-sum, til UI'ens beregningsgennemgang
    # (hvilke enkeltposter der reelt summer til fx "Gødning" eller "Markarbejde").
    goedning_linjer: list[dict] = []
    if driftsform == OEKOLOGISK:
        # Økologiske kandidater er altid "kun organisk" (only_organic=True i
        # KATEGORI_GODNING) — hele mncs er organisk, ingen handelsgødningsdel.
        gylle_udbringning = _load_prisliste()[_GYLLE_UDBRINGNING_PLACEHOLDER_POST]["pris"]
        goedning = gylle_udbringning
        goedning_linjer.append({
            "kategori": "Gødning", "behandling": "Udbringning, husdyrgødning",
            "udgift_kr_ha": gylle_udbringning,
        })
    else:
        handelsgodning_n = max(0.0, mncs - org_mineral_n_applied) + mnca
        handelsgodning_kr = handelsgodning_n * _n_pris()
        goedning = handelsgodning_kr
        goedning_linjer.append({
            "kategori": "Gødning",
            "behandling": f"Handelsgødning, N ({handelsgodning_n:.0f} kg/ha)",
            "udgift_kr_ha": handelsgodning_kr,
        })
        if handelsgodning_n > 0:
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

    linjer = list(_load_dyrkningsomkostninger().get((afgrodekode, driftsform), []))
    udlaeg_udsaed, udlaeg_etablering = _udlaeg_omkostning(udlaeg_kode)
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
    alle_linjer = goedning_linjer + linjer

    udsaed = sum(l["udgift_kr_ha"] for l in linjer if l["kategori"] == "Udsæd")
    plantevaern = sum(l["udgift_kr_ha"] for l in linjer if l["kategori"] == "Planteværn")
    markarbejde = sum(l["udgift_kr_ha"] for l in linjer if l["kategori"] == "Markarbejde")
    toerring = sum(l["udgift_kr_ha"] for l in linjer if l["kategori"] == "Tørring/lagring")

    tilskud = _tilskud_kr_ha(afgrodekode, driftsform)
    omkostninger = udsaed + goedning + plantevaern + markarbejde + toerring
    db = indtaegt + tilskud - omkostninger

    return {
        "afgrodekode": afgrodekode,
        "driftsform": driftsform,
        "jbnr": jbnr,
        "udbytte": udbytte,
        "udbytteenhed": udbytteenhed,
        "udbyttenorm_mangler": norm_mangler,
        "salgspris": salgspris,
        "indtaegt": round(indtaegt, 0),
        "tilskud": round(tilskud, 0),
        "mncs": mncs,
        "goedning": round(goedning, 0),
        "udsaed": round(udsaed, 0),
        "plantevaern": round(plantevaern, 0),
        "markarbejde": round(markarbejde, 0),
        "toerring": round(toerring, 0),
        "omkostninger_total": round(omkostninger, 0),
        "db": round(db, 0),
        "linjer": alle_linjer,
    }
