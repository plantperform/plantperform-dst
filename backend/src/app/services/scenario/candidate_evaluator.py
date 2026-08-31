"""Evaluerer én sædskifte-kandidat (RotationCandidateRef) for én mark: N-input,
udvaskning og dækningsbidrag pr. år (8 positioner), samt gennemsnit over én
fuld rotationscyklus.

N-input-logikken (compute_n_inputs) er porteret fra c:\\plantperform-nles\\
streamlit_app.py's "Organisk gødning"-sidebar (linje ~452-628, 911-1027).
Gødningsparametrene (org_mineral_n, mineralsk_andel_pct, only_organic) samt
driftsform er scenarie-niveau-valg (Fase 13's GodningSettings), fuldt
uafhængige af hvilket sædskifte der evalueres — se docstring på
compute_n_inputs for detaljer.
"""
from __future__ import annotations

from functools import lru_cache

from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    RotationCandidateYearResult,
    RotationPositionOverride,
    RotationYear,
)
from app.domain.simulation import GodningSettings
from app.services.economics.db_calculator import calculate_db
from app.services.nles5 import bridge_v2
from app.services.rotations import afgroede_normer, saedskifte_library

# Den viste/beregnede 8-årige rotation starter ved 2027 (nye simuleringer) —
# men NLES5's tidstrend-led (τ·(Y−1991)) skal have det RIGTIGE kalenderår pr.
# position, ikke en fast værdi for alle 8 år. Position 1 = 2027, position 2 =
# 2028, osv.
START_CALENDAR_YEAR = 2027


@lru_cache(maxsize=100_000)
def compute_n_inputs(
    afgrode_kode: int,
    prev_afgrode_kode: int | None,
    jbnr: int,
    n_norm_pct: float,
    org_mineral_n: float,
    mineralsk_andel_pct: float,
    only_organic: bool,
    irrigated: bool = False,
) -> dict:
    """Beregn {mncs, mnca, g0, net_n, org_mineral_n_applied} for én position.

    org_mineral_n/mineralsk_andel_pct/only_organic er scenariets gødningsvalg
    (Fase 13's GodningSettings — uafhængigt af hvilket sædskifte der evalueres):
      - org_mineral_n=0 (ren mineralsk gødning): MNCS = fuld N-norm (skaleret
        med N-norm%), G0=0 — organisk/handelsgødning er ligegyldig for NLES5
        når der ingen organisk kilde er.
      - only_organic=False (konventionel + gylle): MNCS = net_scaled stadig
        (handelsgødning topper op til fuld norm), men G0 afspejler nu den
        ikke-udnyttede del af den faste gylle-mængde.
      - only_organic=True (økologisk): MNCS = min(org_mineral_n, net_scaled)
        — ingen handelsgødnings-optopning. G0 = org_mineral_n ×
        (100−mineralsk_andel%)/mineralsk_andel%.

    MNCA (efterårs mineral-N) er IKKE en del af gødningsvalget i den
    oprindelige model — det er et separat, uafhængigt input, som udgangspunkt 0.
    """
    norm = afgroede_normer.lookup_norm(afgrode_kode, jbnr, irrigated)
    prev_norm = (
        afgroede_normer.lookup_norm(prev_afgrode_kode, jbnr, irrigated)
        if prev_afgrode_kode is not None
        else None
    )
    fv_forfrugt = prev_norm["forfrugtsvaerdi"] if prev_norm else 0.0

    if not norm or norm["n_norm"] is None:
        return {
            "mncs": 0.0, "mnca": 0.0, "g0": 0.0, "net_n": None, "org_mineral_n_applied": 0.0,
            "fv_forfrugt": fv_forfrugt, "n_norm": None,
        }

    net_n = max(0.0, norm["n_norm"] - fv_forfrugt)
    net_scaled = net_n * (float(n_norm_pct) / 100.0)

    if org_mineral_n <= 0:
        return {
            "mncs": net_scaled, "mnca": 0.0, "g0": 0.0,
            "net_n": net_n, "org_mineral_n_applied": 0.0,
            "fv_forfrugt": fv_forfrugt, "n_norm": norm["n_norm"],
        }

    eff_org = min(org_mineral_n, net_scaled)
    pool_pct = 100.0 - mineralsk_andel_pct
    # G0 bruger BEVIDST eff_org (den norm-begrænsede, faktisk tildelte
    # mængde), ikke den rå org_mineral_n-scenarieindstilling. Den gamle app
    # (streamlit_app.py, sidebar linje 966-986) beregner org_pool_n af den
    # ukappede org_mineral_n — men det svarer til at antage at hele den
    # maksimalt tilladte mængde husdyrgødning altid køres fysisk ud, uanset
    # afgrødens behov. Bekræftet forkert antagelse: man gøder kun til norm,
    # ikke mere — org_mineral_n er en ØVRE GRÆNSE for hvor meget udnyttet N
    # der må tildeles, ikke en fast udbragt mængde. G0 skal derfor afspejle
    # den organisk bundne rest af DEN MÆNGDE DER RENT FAKTISK BLEV TILDELT
    # (eff_org), ikke af loftet.
    g0 = eff_org * (pool_pct / mineralsk_andel_pct)

    if only_organic:
        mncs = eff_org
    else:
        mncs = net_scaled  # organisk + handelsgødning summerer altid til fuld norm

    return {
        "mncs": mncs,
        "mnca": 0.0,
        "g0": g0,
        "net_n": net_n,
        "org_mineral_n_applied": eff_org,
        "fv_forfrugt": fv_forfrugt,
        "n_norm": norm["n_norm"],
    }


def evaluate_sequence_for_mark(
    result_ref: RotationCandidateRef,
    afgrode_seq: list[int | None],
    udlaeg_seq: list[int | None],
    udlaeg_navn_seq: list[str | None],
    active_len: int,
    jbnr: int,
    driftsform: str,
    org_mineral_n: float,
    mineralsk_andel_pct: float,
    only_organic: bool,
    n_indhold_kg_per_ton: float = 6.0,
    irrigated: bool = False,
    fdato: str = "20/8",
    precision_dagsbasis: bool = False,
    base_ref: RotationCandidateRef | None = None,
    overrides: list[RotationPositionOverride] = (),
    start_year: int = 1,
    real_history: dict[str, dict] | None = None,
) -> RotationCandidateEvaluation:
    """Kernen af kandidat-evaluering: 8 positioner, hver med udvaskning + DB,
    samt gennemsnit over én fuld rotationscyklus (active_len). Tager de
    færdige afgrøde-/udlægssekvenser direkte i stedet for selv at slå dem op
    i biblioteket — genbrugt af både evaluate_candidate_for_mark (bibliotek)
    og evaluate_with_overrides (Fase 10 — manuel enkelt-position-rettelse).

    real_history (valgfri): {2025: {"code", "mncs", "mnca", "g0"}, 2026: {...}}
    fra historisk_goedning.real_history_lookback — markens EGNE ægte 2025/26-
    afgrøder og deres historiske N-input (Bilag 3), til at seede f1/f2/g1/g2/
    m1/m2 for position 0 (2027) og 1 (2028) i stedet for at ombukke cyklisk
    til en hypotetisk fremtidig position i SAMME kandidat — kun disse to
    positioners bagudkig påvirkes; resten af rotationen (2029+) bruger
    stadig scenariets gødningsvalg uændret. Ingen real_history (default) =
    uændret opførsel (ren cyklisk ombukning, som før denne funktion fik
    parameteren).
    """
    n_norm_pct = float(result_ref.n_norm_pct)

    def prev_code_for(i: int) -> int | None:
        """Afgrødekoden 1 år før position i — ægte 2026-historik for
        position 0 når real_history er givet, ellers cyklisk ombukning."""
        idx = i - 1
        if real_history is not None and idx < 0:
            entry = real_history.get(str(START_CALENDAR_YEAR + idx))
            if entry is not None:
                return entry["code"]
        return afgrode_seq[idx % active_len]

    n_inputs = [
        compute_n_inputs(
            afgrode_seq[i],
            prev_code_for(i),
            jbnr,
            n_norm_pct,
            org_mineral_n,
            mineralsk_andel_pct,
            only_organic,
            irrigated,
        )
        for i in range(8)
    ]

    def lookback(i: int, offset: int) -> tuple[int | None, float, float, float]:
        """(code, f, m, g) for afgrøden `offset` år før position i — ægte
        2025/26-historik når lookback'et ellers ville ombukke til en
        hypotetisk fremtidig position i SAMME kandidat (kun sandt for
        position 0/2027 og 1/2028's bagudkig, jf. den bekræftede regel)."""
        idx = i - offset
        if real_history is not None and idx < 0:
            entry = real_history.get(str(START_CALENDAR_YEAR + idx))
            if entry is not None:
                code = entry["code"]
                f = afgroede_normer.lookup_nfix(code, jbnr, irrigated) if code is not None else 0.0
                return code, f, entry["mncs"] + entry["mnca"], entry["g0"]
        wrapped = idx % active_len
        code = afgrode_seq[wrapped]
        f = afgroede_normer.lookup_nfix(code, jbnr, irrigated) if code is not None else 0.0
        return code, f, n_inputs[wrapped]["mncs"] + n_inputs[wrapped]["mnca"], n_inputs[wrapped]["g0"]

    years: list[RotationCandidateYearResult] = []
    for i in range(8):
        this_code = afgrode_seq[i]
        next_code = afgrode_seq[(i + 1) % active_len]
        prev_code, f1, m1, g1 = lookback(i, 1)
        _, f2, m2, g2 = lookback(i, 2)
        udl_code = udlaeg_seq[i]

        f0 = (
            afgroede_normer.lookup_nfix(this_code, jbnr, irrigated)
            if this_code is not None
            else 0.0
        )

        leaching = bridge_v2.evaluate_leaching_position(
            afgrode_kode=this_code,
            next_afgrode_kode=next_code,
            prev_afgrode_kode=prev_code,
            udlaeg_kode=udl_code,
            jbnr=jbnr,
            mncs=n_inputs[i]["mncs"],
            mnca=n_inputs[i]["mnca"],
            g0=n_inputs[i]["g0"],
            m1=m1, m2=m2, f0=f0, f1=f1, f2=f2, g1=g1, g2=g2,
            irrigated=irrigated,
            fdato=fdato, precision_dagsbasis=precision_dagsbasis,
            y=START_CALENDAR_YEAR + i,
        )
        db = calculate_db(
            this_code, driftsform, jbnr,
            mncs=n_inputs[i]["mncs"], mnca=n_inputs[i]["mnca"], irrigated=irrigated,
            org_mineral_n_applied=n_inputs[i]["org_mineral_n_applied"],
            udlaeg_kode=udl_code, only_organic=only_organic,
        )
        crop_params = afgroede_normer.lookup_crop_params(this_code)
        # org_mineral_n_applied er husdyrgødningens UDNYTTEDE/mineralske del —
        # den eneste del der tæller med i normopfyldelsen, ligesom
        # handelsgødning. g0 er den resterende, organisk bundne del (tæller
        # ikke med i normen, men indgår i L_nuar via G0/G1/G2 ovenfor).
        tildelt_husdyrgodning_udnyttet = n_inputs[i]["org_mineral_n_applied"]
        tildelt_handelsgodning = max(0.0, n_inputs[i]["mncs"] - tildelt_husdyrgodning_udnyttet)
        # Ton-overblik — hvor mange ton husdyrgødning der reelt blev tildelt
        # på denne position. Bruger BEVIDST tildelt_husdyrgodning_udnyttet
        # (eff_org, denne positions norm-begrænsede tildeling), ikke den rå
        # scenarie-indstilling org_mineral_n — org_mineral_n er en ØVRE
        # GRÆNSE for hvor meget udnyttet N der må tildeles via husdyrgødning,
        # ikke en fast udbragt mængde; man gøder kun til norm, aldrig mere.
        # Er der ingen norm (fx brak/administrativt areal), er
        # tildelt_husdyrgodning_udnyttet allerede 0, så ton bliver det også.
        husdyrgodning_ton = (
            tildelt_husdyrgodning_udnyttet / n_indhold_kg_per_ton
            if n_indhold_kg_per_ton > 0
            else 0.0
        )

        years.append(RotationCandidateYearResult(
            year=RotationYear(
                afgrode_kode=this_code,
                afgrode_navn=crop_params.get("navn", ""),
                udlaeg_kode=udl_code,
                udlaeg_navn=udlaeg_navn_seq[i],
            ),
            leaching_kg_n_ha=leaching["L_nuar"],
            leaching_detail=leaching,
            db_kr_ha=db["db"],
            db_detail=db,
            forfrugtsvaerdi_kgn_ha=n_inputs[i]["fv_forfrugt"],
            tildelt_husdyrgodning_udnyttet_kgn_ha=tildelt_husdyrgodning_udnyttet,
            tildelt_handelsgodning_kgn_ha=tildelt_handelsgodning,
            husdyrgodning_organisk_bundet_kgn_ha=n_inputs[i]["g0"],
            husdyrgodning_ton_pr_ha=husdyrgodning_ton,
            afgrode_norm_kgn_ha=n_inputs[i]["n_norm"],
            n_norm_pct=n_norm_pct,
        ))

    cycle = years[:active_len]
    avg_leaching = sum(y.leaching_kg_n_ha for y in cycle) / len(cycle)
    avg_db = sum(y.db_kr_ha for y in cycle) / len(cycle)
    # FEN: kun meningsfuldt for FE-noterede afgrøder (helsæd/græs) — grovfoder-
    # udbytte, jf. samme definition som TabSaedsk's "Grovfoder FEN pr. ha".
    fen_values = [
        year.db_detail["udbytte"]
        for year in cycle
        if year.db_detail.get("udbytteenhed") == "FE/ha"
    ]
    avg_fen = sum(fen_values) / len(cycle) if fen_values else 0.0

    return RotationCandidateEvaluation(
        ref=result_ref,
        active_len=active_len,
        years=years,
        avg_leaching_kg_n_ha=avg_leaching,
        avg_db_kr_ha=avg_db,
        avg_fen=avg_fen,
        base_ref=base_ref,
        overrides=list(overrides),
        start_year=start_year,
    )


def evaluate_candidate_for_mark(
    ref: RotationCandidateRef,
    jbnr: int,
    driftsform: str,
    org_mineral_n: float,
    mineralsk_andel_pct: float,
    only_organic: bool,
    n_indhold_kg_per_ton: float = 6.0,
    start_year: int = 1,
    irrigated: bool = False,
    fdato: str = "20/8",
    precision_dagsbasis: bool = False,
    real_history: dict[str, dict] | None = None,
) -> RotationCandidateEvaluation | None:
    """Evaluer en sædskifte-kandidat: 8 års positioner, hver med udvaskning +
    DB, samt gennemsnit over én fuld rotationscyklus (active_len).

    Returnerer None hvis (saedskiftevariant, variant, n_norm_pct) ikke findes
    i datasættet (fx en N-norm% der ikke er defineret for denne variant) —
    kaldere skal springe disse over, ikke fejle.
    """
    raw_rotation = saedskifte_library.generate_rotation(
        ref.saedskiftevariant, ref.variant, ref.n_norm_pct, start_year
    )
    active_len = saedskifte_library.rotation_active_len(raw_rotation)
    if active_len == 0:
        return None

    afgrode_seq = [raw_rotation[i][0] for i in range(8)]
    udlaeg_seq = [raw_rotation[i][1] for i in range(8)]
    udlaeg_navn_seq = [raw_rotation[i][2] for i in range(8)]

    return evaluate_sequence_for_mark(
        ref, afgrode_seq, udlaeg_seq, udlaeg_navn_seq, active_len,
        jbnr, driftsform, org_mineral_n, mineralsk_andel_pct, only_organic,
        n_indhold_kg_per_ton=n_indhold_kg_per_ton,
        irrigated=irrigated, fdato=fdato, precision_dagsbasis=precision_dagsbasis,
        start_year=start_year,
        real_history=real_history,
    )


def evaluate_with_overrides(
    base_ref: RotationCandidateRef,
    overrides: list[RotationPositionOverride],
    jbnr: int,
    driftsform: str,
    org_mineral_n: float,
    mineralsk_andel_pct: float,
    only_organic: bool,
    n_indhold_kg_per_ton: float = 6.0,
    irrigated: bool = False,
    fdato: str = "20/8",
    precision_dagsbasis: bool = False,
    start_year: int = 1,
    real_history: dict[str, dict] | None = None,
) -> RotationCandidateEvaluation | None:
    """Som evaluate_candidate_for_mark, men overskriver hovedafgrøden i én
    eller flere positioner efter opslag i biblioteket, og/eller forskyder
    rotationens startpunkt i cyklussen (start_year, 1-baseret, cyklisk —
    "ryk sædskiftet frem/tilbage", jf. den gamle apps "Startår i rotation")
    — bruges af Fase 10's "Rediger manuelt" (levende beregning). Udlæg/
    virkemiddel ved en overskrevet position røres ikke, kun hovedafgrøden.

    result.ref bliver base_ref uændret hvis hverken overrides eller
    start_year er ændret (så et "preview uden ændringer" er identisk med et
    almindeligt bibliotek-opslag); ellers en syntetisk, kollisionsfri ref
    (variant-suffiks "+manuel") — nødvendigt også for en ren start_year-
    forskydning, da den afgrødesekvens der reelt beregnes ellers ville dele
    ref-id med den (anderledes) start_year=1-kandidat i den gemte
    kandidatmængde.
    """
    raw_rotation = saedskifte_library.generate_rotation(
        base_ref.saedskiftevariant, base_ref.variant, base_ref.n_norm_pct, start_year
    )
    active_len = saedskifte_library.rotation_active_len(raw_rotation)
    if active_len == 0:
        return None

    afgrode_seq = [raw_rotation[i][0] for i in range(8)]
    udlaeg_seq = [raw_rotation[i][1] for i in range(8)]
    udlaeg_navn_seq = [raw_rotation[i][2] for i in range(8)]
    for override in overrides:
        afgrode_seq[override.position] = override.afgrode_kode

    if overrides or start_year != 1:
        suffix_parts = []
        if start_year != 1:
            suffix_parts.append(f"sy{start_year}")
        if overrides:
            ov_signature = ",".join(
                f"{o.position}:{o.afgrode_kode}"
                for o in sorted(overrides, key=lambda o: o.position)
            )
            suffix_parts.append(f"ov[{ov_signature}]")
        result_ref = RotationCandidateRef(
            saedskiftevariant=base_ref.saedskiftevariant,
            variant=f"{base_ref.variant}+manuel-{'-'.join(suffix_parts)}",
            n_norm_pct=base_ref.n_norm_pct,
        )
    else:
        result_ref = base_ref

    return evaluate_sequence_for_mark(
        result_ref, afgrode_seq, udlaeg_seq, udlaeg_navn_seq, active_len,
        jbnr, driftsform, org_mineral_n, mineralsk_andel_pct, only_organic,
        n_indhold_kg_per_ton=n_indhold_kg_per_ton,
        irrigated=irrigated, fdato=fdato, precision_dagsbasis=precision_dagsbasis,
        base_ref=base_ref, overrides=overrides, start_year=start_year,
        real_history=real_history,
    )


def generate_candidates_for_field(
    saedskiftevarianter: list[str],
    n_norm_procenter: list[str],
    jbnr: int,
    godning: GodningSettings,
    fdato: str = "20/8",
    precision_dagsbasis: bool = False,
    real_history: dict[str, dict] | None = None,
) -> list[RotationCandidateEvaluation]:
    """Kryds de eksplicit valgte saedskiftevariant-id'er med valgte
    N-norm%-værdier × alle varianter, og evaluer hver resulterende kandidat
    under scenariets gødningsvalg (Fase 13 — samme godning for alle valgte
    sædskifter, fuldt uafhængigt af hvilke der er valgt).

    Bruges af "Opret scenarie" (usynlig baggrundsberegning, jf. plan-
    beslutning 14/19/Fase 9) — springer kombinationer der ikke findes i
    datasættet over (fx en N-norm% der ikke er defineret for en given
    variant).
    """
    results: list[RotationCandidateEvaluation] = []
    seen_ref_ids: set[str] = set()

    for saedskiftevariant in saedskiftevarianter:
        for variant in saedskifte_library.list_variants(saedskiftevariant):
            available_norms = set(saedskifte_library.list_n_norms(saedskiftevariant, variant))
            for n_norm_pct in n_norm_procenter:
                if n_norm_pct not in available_norms:
                    continue
                ref = RotationCandidateRef(
                    saedskiftevariant=saedskiftevariant, variant=variant, n_norm_pct=n_norm_pct,
                )
                ref_id = ref.to_id()
                if ref_id in seen_ref_ids:
                    continue
                seen_ref_ids.add(ref_id)
                result = evaluate_candidate_for_mark(
                    ref, jbnr=jbnr,
                    driftsform=godning.driftsform,
                    org_mineral_n=godning.org_mineral_n,
                    mineralsk_andel_pct=godning.mineralsk_andel_pct,
                    only_organic=godning.only_organic,
                    n_indhold_kg_per_ton=godning.n_indhold_kg_per_ton,
                    fdato=fdato, precision_dagsbasis=precision_dagsbasis,
                    real_history=real_history,
                )
                if result is not None:
                    results.append(result)

    return results
