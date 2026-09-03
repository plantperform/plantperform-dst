"""Dækningsbidrag (DB) for de afgrødekoder der indgår i sædskifte-lookup.

Kobler seks kilder sammen, alle under database/data/raw/ANGJ-data/:
  - Salgspriser_afgroedekoder.csv       kr/hkg + halm_pris_kr_kg, pr.
    (afgrødekode, driftsform, kvalitet) — IKKE jordbonitet, se nedenfor.
  - Halmudbytte_afgroedekoder.csv       halm kg/ha, pr. (afgrødekode, jordbonitet)
  - Arbejdssatser.csv                   kr/enhed pr. (behandling, jordbonitet[, afgrødekode])
  - Arbejdsmaengder_afgroedekoder.csv   antal enheder pr. (afgrødekode,
    driftsform, jordbonitet, kvalitet, behandling)
  - Dyrkningsomkostninger_afgroedekoder.csv  kr/ha, kun for de IKKE-migrerede
    afgrødekoder (pr. 2026-09-02 kun Lupin — se nedenfor); de migrerede
    afgrødekoder bruger de to foregående i stedet.
  - Prisliste_2026.csv                  SEGES-satser: tilskud, N-pris
  - PlantPerform_master_afgroedenormer_...xlsx (Lang_lookup)
    udbyttenorm pr. (afgrødekode, JB-nr, vanding, driftsform)

Udbyttenormen er allerede angivet i samme enhed som salgsprisen (hkg/ha mod
kr/hkg for kornafgrøder, FE/ha mod kr/FE for helsæd/græs), så
indtægt = udbyttenorm × salgspris virker uden særtilfælde for FE-afgrøder.

Mastertabellen fik 2026-09-02 en Driftsform-kolonne og 192 nye Økologisk-
rækker (32 af sædskifte-lookup'ens 34 afgrødekoder — flettet ind fra
goedningsnormer_konventionel_og_estimeret_øko.xlsx, se Kilder_og_noter-fanen
i mastertabellen for kilde og kvalitetsniveau pr. afgrøde). Findes der en
reel øko-specifik række for (afgrødekode, JB-nr), bruges den direkte, uden
reduktion. For de resterende afgrødekoder (endnu ingen kilde) samt for
enhver kombination uden øko-række reduceres udbyttet stadig med en fast sats
(32 %) af den konventionelle norm, som en midlertidig stedfortræder.

Reel prisdata for 33 af sædskifte-lookup'ens 34 afgrødekoder (pr.
2026-09-02), udtrukket fra SEGES' Budgetkalkuler 2026. Den sidste (Lupin,
kode 32) har ingen SEGES-kalkule overhovedet — konstrueret i stedet ud fra
to landbrugsfaglige dyrkningsvejledninger + reelle satser for sammenlignelige
bælgsæd allerede i datasættet, se kilde-feltet i Dyrkningsomkostninger_
afgroedekoder.csv. Kun "Uden husdyrgødning"-arkene er brugt til
konventionel — "Med husdyrgødning"-varianten er ekskluderet, fordi
husdyrgødnings-udbringning allerede prissættes dynamisk her (se
org_mineral_n_applied nedenfor), og en statisk linje fra "med
husdyrgødning"-arket ville derfor dobbelttælle den. Økologisk findes kun som
"med husdyrgødning" hos SEGES, så samme filter (husdyrgødning-linjer droppet
ved udtræk) er anvendt der af samme grund.

**Prisen varierer ikke med jordbonitet** for nogen af de 33 udtrukne
afgrøder — kun UDBYTTET gør (allerede en separat, JB-nøglet kilde). Derfor
er salgspriser-filen flad pr. (afgrødekode, driftsform, kvalitet), uden
JB-nøgle. Halm er samme mønster: halm_pris_kr_kg er flad i salgspriser,
halm-UDBYTTET (kg/ha) er JB-specifikt i sin egen fil, mhp. samme
fallback-kæde (_jordbonitet_kandidater) som kerneudbyttet allerede bruger.

**Arbejde er opdelt i sats × mængde, ikke én fastlåst kr/ha-sum**, så en
bruger der vil rette op på fx sprøjtesatsen kan gøre det ét sted
(arbejdssatser) i stedet for at finde og rette hver afgrødes linje for sig.
De fleste maskinoperationer (Pløjning, Sprøjtning, Gødningsspredning m.fl.)
har ÉN standardsats pr. jordbonitet, delt af de fleste afgrøder — hvor en
afgrøde reelt afviger (fx sprøjtning er dyrere for kartofler end for korn),
får den sin egen linje i stedet, se _lookup_arbejdssats. Nogle behandlinger
har derimod aldrig en fælles sats (Udsæd, Mejetærskning, de flade
sæson-behandlinger Ukrudt/Sygdom/Skadedyr/Vækstregulering/Analyser) — her er
hver afgrødes linje reelt forskellig fra alle andres, så de ender som
afgrøde-specifikke satser uden nogen fælles standard at falde tilbage til.
Ikke-migrerede afgrødekoder har slet ingen rækker i arbejdsmaengder-filen —
_lookup_omkostningslinjer falder da tilbage til den gamle flade
dyrkningsomkostninger-fil uændret (se _migrerede_afgrodekoder).

Gødningslinjen i kildedata er kun et fladt gæt og IGNORERES her til fordel
for en reel beregning:
  - Konventionel: (MNCS + MNCA) × N-pris (12,5 kr/kg N) + udbringning (115 kr/ha)
  - Økologisk (gylle): kun udbringningsomkostningen — gyllen værdisættes ikke
    her (bruger: "Gylle skal kun koste udbringningsprisen, det integrerer vi
    senere"). Prislisten har kun ton-baserede gylle-satser og ingen ha-norm
    for udbragt mængde, så der genbruges midlertidigt samme flade
    udbringningssats som den konventionelle (115 kr/ha) — tydeligt markeret
    som en forenkling, ikke en rigtig gylle-pris.
  - Fosfor og kalium er IKKE del af denne dynamiske beregning (ingen officiel
    P/K-pris- eller forbrugsnorm er koblet ind endnu) — for de 33 reelt
    udtrukne afgrødekoder kommer de i stedet med som én "Andre
    gødningsstoffer"-behandling i arbejdsmaengder/arbejdssatser (SEGES' egen
    P+K-sats, altid afgrøde-specifik — aldrig en fælles standardsats).

Udsæd, planteværn, markarbejde og tørring/lagring for de IKKE-migrerede
afgrødekoder (pr. 2026-09-02 kun Lupin, se ovenfor) tages stadig fra den
gamle dyrkningsomkostninger-fil uændret, UNDTAGEN for positioner med et prissat
efterafgrøde-/mellemafgrøde-/udlæg-udlæg (jf. bridge_v2.py's
_UDL_VIRKEMIDDEL-familie) — her lægges en ekstra udsæds- og
etableringsomkostning fra prislisten oveni (se _udlaeg_omkostning nedenfor),
så virkemidlerne rent faktisk koster noget i optimeringen i stedet for at
være en gratis udvasknings-reduktion.

Halmpresning er ét specialtilfælde: kildedataens eget "antal" er et
brøktal (fx 4,8) uden angivet enhed — det viste sig at være proportionalt
med halm-kg, ikke et pasnings-/balletal (bekræftet: halmpresnings-kr / halm-
indtægt er konstant 0,2 kr/kg halm på tværs af alle udtrukne afgrøder og
jordboniteter). Prissat som kr/kg halm i stedet for kr/gang; "antal" i
arbejdsmaengder er derfor det samme kg-tal som halmudbytte-filen bruger.

kvalitet (default "" — normalsorten) rummer kvalitetsvarianter der er
udtrukket, men ikke koblet ind i den almindelige sædskifte-brug endnu, fx
"Brødhvede" for vinterhvede-kode 11 (samme afgrødekode, tilret pris/mængde
manuelt indtil en rigtig kvalitets-toggle findes i UI'en).

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

# JB-gruppering som i SEGES' egne Budgetkalkuler-ark: "JB1-3" dækker JB 1+3
# uvandet, "JB1-4" dækker JB 1-4 VANDET (den eneste vandede variant SEGES har
# for de lette jorde), "JB5-6" dækker JB 5+6 (ingen separat vandet-variant).
# JB2 uvandet og JB>6 mangler helt i kildedata — falder tilbage til nærmeste
# gruppe. (jordbonitet, vandet) -> prioriteret liste af kandidat-grupper at
# forsøge i _load_salgspriser/_load_dyrkningsomkostninger's opslag.
def _jordbonitet_kandidater(jbnr: int, irrigated: bool) -> list[tuple[str, bool]]:
    if jbnr <= 4:
        if irrigated:
            return [("JB1-4", True), ("JB1-3", False), ("JB5-6", False)]
        return [("JB1-3", False), ("JB1-4", True), ("JB5-6", False)]
    return [("JB5-6", False), ("JB1-4", True), ("JB1-3", False)]

# Tilskud der automatisk matches ind i DB (kr/ha) — resten af prislistens
# tilskud er tilvalgsordninger, se moduldocstring.
_GRUNDBETALING_POST = "Grundbetaling (estimat)"
_OEKO_AREALSTOETTE_POST = "Grundbeløb (basis)"
_STIVELSESKARTOFLER_POST = "Stivelseskartofler"
_STIVELSESKARTOFLER_KODE = 151

# Placeholder: gylle-udbringning har ingen ha-norm i prislisten (kun kr/ton),
# så vi genbruger handelsgødningens flade udbringningssats indtil videre.
_GYLLE_UDBRINGNING_PLACEHOLDER_POST = "Handelsgødning, udbringning"

# Placeholder for afgrødekoder UDEN en reel Økologisk-række i mastertabellens
# Lang_lookup (se _lookup_udbyttenorm). Bruges kun som stedfortræder når der
# ikke findes øko-specifik data — for de 32 afgrødekoder der fik rigtige
# øko-normer 2026-09-02 rammes denne reduktion ikke længere.
_OEKO_UDBYTTE_REDUKTION = 0.32

# Udlægskode -> hvilken pris-kategori i prislisten dækker udsæd/etablering af
# dette udlæg. Samme kode-familie som bridge_v2.py's _UDL_VIRKEMIDDEL, men
# her grupperet efter hvilken FYSISK afgrøde der sås (ikke NUAR-virkemiddel-
# eligibilitet) — fx er 960-966 ("udlæg/eftersslæt" klovergræs) og 2000
# ("udlæg til frø") ikke NUAR-virkemidler, men koster stadig rigtig udsæd.
# 3000 (jordbearbejdning efterår) er ikke en sået afgrøde og har ingen post her.
#
# 9680/9684 (frøgræs der fortsætter som efter-/mellemafgrøde) er egne
# kategorier fra 968/970 og 9682 — frøgræsset selv udgør plantedækket, så
# SKH's faktaark (2026) sætter omkostningen til 0 kr, adskilt fra den rigtige
# sås-fra-bunden-etablering efter korn.
# 9683 (Tidlig såning af vintersæd) manglede tidligere en prispost helt,
# selvom den allerede findes som udlægskode på udvasknings-siden (bridge_v2.py).
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
    """(afgrodekode, jb_nr, vanding, driftsform) -> {udbyttenorm, udbytteenhed,
    n_norm}. Driftsform er "Konventionel" for alle oprindelige rækker (tom
    celle i Driftsform-kolonnen) og "Økologisk" for de 192 rækker tilføjet
    2026-09-02 (32 af sædskifte-lookup'ens 34 afgrødekoder — se
    Kilder_og_noter-fanen for hvilke der er reelle SEGES-tal kontra stadig
    "best bet")."""
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
    afgrodekode: int, jb_nr: int, irrigated: bool = False, driftsform: str = KONVENTIONEL
) -> tuple[dict | None, bool]:
    """Returns (norm, er_reel_oeko_norm). er_reel_oeko_norm er True kun når
    driftsform er Økologisk OG en rigtig øko-specifik række findes — det
    styrer om _OEKO_UDBYTTE_REDUKTION skal lægges oveni i calculate_db (den
    syntetiske reduktion er kun nødvendig som stedfortræder når der IKKE
    findes en reel øko-norm for denne (afgrødekode, JB-nr))."""
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
    """(afgrodekode, driftsform, kvalitet) -> {salgspris, enhed,
    halm_pris_kr_kg}. driftsform "—" = fælles for begge. Prisen viste sig
    IKKE at variere med jordbonitet for nogen afgrøde (kun udbyttet gør, som
    allerede kommer fra en separat kilde) — derfor ingen JB-nøgle her."""
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
    for df in (driftsform, "—"):
        hit = lut.get((afgrodekode, df, kvalitet))
        if hit is not None:
            return hit
    # Sikkerhedsnet: økologisk uden egen pris falder tilbage til konventionel
    # i stedet for 0 kr. De 15 afgrødekoder der havde dette hul pr.
    # 2026-09-02 har allerede fået en eksplicit Økologisk-række med samme
    # begrundelse (se kilde-feltet i Salgspriser_afgroedekoder.csv) — dette
    # er kun for en fremtidig/uforudset afgrødekode med samme mangel.
    if driftsform == OEKOLOGISK:
        return lut.get((afgrodekode, KONVENTIONEL, kvalitet))
    return None


@lru_cache(maxsize=1)
def _load_halmudbytte() -> dict[tuple[int, str], float]:
    """(afgrodekode, jordbonitet) -> halm kg/ha. Kun for afgrøder med halm —
    ingen række her betyder ikke "0 halm", det betyder "ikke migreret endnu"
    ELLER "afgrøden har ingen halm" (fx kartofler); calculate_db behandler
    begge som 0 kr halm-indtægt, hvilket er korrekt i begge tilfælde."""
    lookup: dict[tuple[int, str], float] = {}
    with open(_HALMUDBYTTE_PATH, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=","):
            code = int(row["afgroedekode"])
            jordbonitet = row["jordbonitet"].strip()
            lookup[(code, jordbonitet)] = _to_float(row["halm_udbytte_kg_ha"]) or 0.0
    return lookup


def _lookup_halm_udbytte(afgrodekode: int, jbnr: int, irrigated: bool) -> float:
    lut = _load_halmudbytte()
    for jb_gruppe, _ in _jordbonitet_kandidater(jbnr, irrigated):
        hit = lut.get((afgrodekode, jb_gruppe))
        if hit is not None:
            return hit
    return 0.0


@lru_cache(maxsize=1)
def _load_arbejdssatser() -> dict[tuple[str, str], list[dict]]:
    """(behandling, jordbonitet) -> liste af satser, hver enten universel
    (afgrodekode="") eller en afvigende sats for én bestemt afgrødekode.
    _lookup_arbejdssats prøver crop-specifik først, falder tilbage til den
    universelle standardsats."""
    lookup: dict[tuple[str, str], list[dict]] = {}
    with open(_ARBEJDSSATSER_PATH, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=","):
            behandling = row["behandling"].strip()
            jordbonitet = row["jordbonitet"].strip()
            afgrodekode_raw = row["afgroedekode"].strip()
            lookup.setdefault((behandling, jordbonitet), []).append({
                "afgrodekode": int(afgrodekode_raw) if afgrodekode_raw else None,
                "driftsform": row["driftsform"].strip(),
                "pris_kr_per_enhed": _to_float(row["pris_kr_per_enhed"]) or 0.0,
                "enhed": row["enhed"].strip(),
            })
    return lookup


def _lookup_arbejdssats(
    behandling: str, jordbonitet: str, afgrodekode: int, driftsform: str
) -> tuple[float, str] | None:
    satser = _load_arbejdssatser().get((behandling, jordbonitet), [])
    universel = None
    for sats in satser:
        if sats["afgrodekode"] == afgrodekode and sats["driftsform"] in (driftsform, ""):
            return sats["pris_kr_per_enhed"], sats["enhed"]
        if sats["afgrodekode"] is None:
            universel = sats
    if universel is not None:
        return universel["pris_kr_per_enhed"], universel["enhed"]
    return None


@lru_cache(maxsize=1)
def _load_arbejdsmaengder() -> dict[tuple[int, str, str, str], list[dict]]:
    """(afgrodekode, driftsform, jordbonitet, kvalitet) -> [{kategori,
    behandling, antal}] — "hvor meget arbejde" denne afgrøde/JB-kombination
    kræver af hver behandling. Sat sammen med _load_arbejdssatser giver det
    udgift_kr_ha = antal × sats, i stedet for én fastlåst sum pr. linje."""
    lookup: dict[tuple[int, str, str, str], list[dict]] = {}
    with open(_ARBEJDSMAENGDER_PATH, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=","):
            code = int(row["afgroedekode"])
            driftsform = row["driftsform"].strip()
            jordbonitet = row["jordbonitet"].strip()
            kvalitet = row["kvalitet"].strip()
            key = (code, driftsform, jordbonitet, kvalitet)
            lookup.setdefault(key, []).append({
                "kategori": row["kategori"].strip(),
                "behandling": row["behandling"].strip(),
                "antal": _to_float(row["antal"]) or 0.0,
            })
    return lookup


@lru_cache(maxsize=1)
def _migrerede_afgrodekoder() -> frozenset[int]:
    """Afgrødekoder der har rigtige SEGES-satser i arbejdsmaengder/satser-
    tabellerne — resten falder tilbage til den gamle flade
    dyrkningsomkostninger-fil (se _lookup_omkostningslinjer)."""
    return frozenset(code for code, _, _, _ in _load_arbejdsmaengder())


@lru_cache(maxsize=1)
def _load_dyrkningsomkostninger() -> dict[tuple[int, str], list[dict]]:
    """(afgrodekode, driftsform) -> linjer, EKSKL. kategori "Gødning" (det
    gamle fladt-gæt-NPK-forsøg, genberegnes dynamisk). Kun de IKKE-migrerede
    afgrødekoder ligger her nu — de migrerede bruger arbejdsmaengder/satser."""
    lookup: dict[tuple[int, str], list[dict]] = {}
    with open(_DYRKNINGSOMKOSTNINGER_PATH, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=","):
            if row["kategori"].strip() == "Gødning":
                continue
            code = int(row["afgroedekode"])
            driftsform = row["driftsform"].strip()
            lookup.setdefault((code, driftsform), []).append({
                "kategori": row["kategori"].strip(),
                "behandling": row["behandling"].strip(),
                "udgift_kr_ha": _to_float(row["udgift_kr_ha"]) or 0.0,
            })
    return lookup


def _lookup_omkostningslinjer(
    afgrodekode: int, driftsform: str, jbnr: int, irrigated: bool, kvalitet: str = ""
) -> list[dict]:
    """Udgiftslinjer (kategori, behandling, udgift_kr_ha) for én afgrøde.
    Migrerede afgrødekoder: antal × sats fra arbejdsmaengder/arbejdssatser,
    med JB-fallback. Ikke-migrerede: det gamle flade linjesæt uændret."""
    if afgrodekode not in _migrerede_afgrodekoder():
        return _load_dyrkningsomkostninger().get((afgrodekode, driftsform), [])

    maengder = _load_arbejdsmaengder()
    raekker = None
    valgt_jb = ""
    for jb_gruppe, _ in _jordbonitet_kandidater(jbnr, irrigated):
        hit = maengder.get((afgrodekode, driftsform, jb_gruppe, kvalitet))
        if hit is not None:
            raekker, valgt_jb = hit, jb_gruppe
            break
    if raekker is None:
        return []

    linjer = []
    for r in raekker:
        sats = _lookup_arbejdssats(r["behandling"], valgt_jb, afgrodekode, driftsform)
        pris = sats[0] if sats is not None else 0.0
        linjer.append({
            "kategori": r["kategori"],
            "behandling": r["behandling"],
            "udgift_kr_ha": r["antal"] * pris,
        })
    return linjer


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

# Afgrødekoder hvor præcisionsjordbrug kan anvendes (korn + raps, dansk
# standardbetydning) — SKH's faktaark om virkemidler, 2026. Samme sæt som
# bridge_v2._KORN_OG_RAPS_KODER — hold i sync, se dens kommentar for hvorfor
# majs/bælgsæd er udeladt.
_KORN_OG_RAPS_KODER = frozenset({1, 2, 3, 10, 11, 14, 15, 22})


def _udlaeg_omkostning(
    udlaeg_kode: int | None, afgrodekode: int | None = None,
) -> tuple[float, float]:
    """(udsæd, etablering) kr/ha for et efterafgrøde-/mellemafgrøde-/udlæg-
    udlæg på denne position — (0, 0) hvis intet udlæg eller en kode uden
    prissat kategori (fx 3000, jordbearbejdning).

    Efterafgrøde efter majshelsæd (afgrodekode 216) har sin egen, lavere
    pris-kategori (radrensning/såning + udbyttetab i majs, ingen fuld
    harvning) — SKH's faktaark om virkemidler, 2026. Gælder kun 968/970
    (rigtig efterafgrøde); 9680 (frøgræs-videreført) er allerede 0 kr
    uanset hovedafgrøde, ingen majs-variant nødvendig for den.
    """
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

    kvalitet: kvalitetsvariant (fx "Brødhvede" for afgrødekode 11) — default
    "" er normalsorten. Kun udtrukket, ikke koblet ind i UI/sædskifte endnu.

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
    norm, er_reel_oeko_norm = _lookup_udbyttenorm(afgrodekode, jbnr, irrigated, driftsform)
    pris = _lookup_salgspris(afgrodekode, driftsform, kvalitet)

    salgspris = pris["salgspris"] if pris else 0.0
    halm_pris = pris["halm_pris_kr_kg"] if pris else 0.0
    halm_udbytte = _lookup_halm_udbytte(afgrodekode, jbnr, irrigated)
    halm_indtaegt = halm_udbytte * halm_pris
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

    # Reel øko-norm (32 af 34 afgrødekoder pr. 2026-09-02, se Kilder_og_noter)
    # bruges direkte uden reduktion. Kun når ingen øko-specifik række findes
    # (endnu ikke-dækkede afgrødekoder) falder vi tilbage til den syntetiske
    # -32 %-reduktion af konventionel-normen som stedfortræder.
    if driftsform == OEKOLOGISK and not er_reel_oeko_norm:
        udbytte *= 1 - _OEKO_UDBYTTE_REDUKTION

    # halm_udbytte er allerede JB-specifik (fra Testdata_halmudbytte, samme
    # fallback-mønster som kerneudbyttet), og halm_pris er driftsform-specifik
    # fra salgspriser-filen — begge er SEGES-tal, ikke ramt af den syntetiske
    # økologiske udbytte-reduktion ovenfor, som kun gælder kerneudbyttet.
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

    linjer = list(_lookup_omkostningslinjer(afgrodekode, driftsform, jbnr, irrigated, kvalitet))
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
    if praecisionsjordbrug and afgrodekode in _KORN_OG_RAPS_KODER:
        pjb_pris = _load_prisliste().get("Præcisionsjordbrug", {}).get("pris", 0.0)
        linjer.append({
            "kategori": "Markarbejde", "behandling": "Præcisionsjordbrug",
            "udgift_kr_ha": pjb_pris,
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
        line["udgift_kr_ha"] for line in linjer if line["kategori"] == "Andre gødningsstoffer"
    )

    tilskud = _tilskud_kr_ha(afgrodekode, driftsform)
    omkostninger = udsaed + goedning + plantevaern + markarbejde + toerring + andre_goedningsstoffer
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
