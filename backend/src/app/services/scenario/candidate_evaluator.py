"""Evaluerer én sædskifte-kandidat (RotationCandidateRef) for én mark: N-input,
udvaskning og dækningsbidrag pr. år (8 positioner), samt gennemsnit over én
fuld rotationscyklus.

N-input-logikken (compute_n_inputs) er porteret fra c:\\plantperform-nles\\
streamlit_app.py's "Organisk gødning"-sidebar (linje ~452-628, 911-1027),
nu datadrevet af kategori (se services.rotations.saedskifte_kategorier) i
stedet for en fri driftsform/regelsæt/andel-formular — se docstring på
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
from app.services.economics.db_calculator import calculate_db
from app.services.nles5 import bridge_v2
from app.services.rotations import afgroede_normer, saedskifte_kategorier, saedskifte_library

# Rigtig historik dækker kun 2017-2023 (jf. planens beslutning 11), så den
# viste/beregnede 8-årige rotation starter ved 2024 — men NLES5's tidstrend-
# led (τ·(Y−1991)) skal have det RIGTIGE kalenderår pr. position, ikke en
# fast værdi for alle 8 år. Position 1 = 2024, position 2 = 2025, osv.
_START_CALENDAR_YEAR = 2024


@lru_cache(maxsize=100_000)
def compute_n_inputs(
    afgrode_kode: int,
    prev_afgrode_kode: int | None,
    jbnr: int,
    n_norm_pct: float,
    kategori: str,
    irrigated: bool = False,
) -> dict:
    """Beregn {mncs, mnca, g0, net_n, org_mineral_n_applied} for én position.

    Kategorien slår op i saedskifte_kategorier.KATEGORI_GODNING for
    {org_mineral_n, mineralsk_andel_pct, only_organic}:
      - org_mineral_n=0 (Plantesædskifter): MNCS = fuld N-norm (skaleret med
        N-norm%), G0=0 — organisk/handelsgødning er ligegyldig for NLES5 når
        der ingen organisk kilde er.
      - only_organic=False (konventionel + gylle): MNCS = net_scaled stadig
        (handelsgødning topper op til fuld norm), men G0 afspejler nu den
        ikke-udnyttede del af den faste gylle-mængde.
      - only_organic=True (økologisk): MNCS = min(org_mineral_n, net_scaled)
        — ingen handelsgødnings-optopning. G0 = org_mineral_n ×
        (100−mineralsk_andel%)/mineralsk_andel%.

    MNCA (efterårs mineral-N) er IKKE en kategori-kanal i den oprindelige
    model — det er et separat, uafhængigt input, som udgangspunkt 0.
    """
    norm = afgroede_normer.lookup_norm(afgrode_kode, jbnr, irrigated)
    prev_norm = (
        afgroede_normer.lookup_norm(prev_afgrode_kode, jbnr, irrigated)
        if prev_afgrode_kode is not None
        else None
    )
    fv_forfrugt = prev_norm["forfrugtsvaerdi"] if prev_norm else 0.0

    if not norm or norm["n_norm"] is None:
        return {"mncs": 0.0, "mnca": 0.0, "g0": 0.0, "net_n": None, "org_mineral_n_applied": 0.0}

    net_n = max(0.0, norm["n_norm"] - fv_forfrugt)
    net_scaled = net_n * (float(n_norm_pct) / 100.0)

    godning = saedskifte_kategorier.KATEGORI_GODNING[kategori]
    org_mineral_n = godning["org_mineral_n"]

    if org_mineral_n <= 0:
        return {
            "mncs": net_scaled, "mnca": 0.0, "g0": 0.0,
            "net_n": net_n, "org_mineral_n_applied": 0.0,
        }

    eff_org = min(org_mineral_n, net_scaled)
    mineralsk_andel_pct = godning["mineralsk_andel_pct"]
    pool_pct = 100.0 - mineralsk_andel_pct
    g0 = org_mineral_n * (pool_pct / mineralsk_andel_pct)

    if godning["only_organic"]:
        mncs = eff_org
    else:
        mncs = net_scaled  # organisk + handelsgødning summerer altid til fuld norm

    return {
        "mncs": mncs,
        "mnca": 0.0,
        "g0": g0,
        "net_n": net_n,
        "org_mineral_n_applied": eff_org,
    }


def evaluate_sequence_for_mark(
    result_ref: RotationCandidateRef,
    afgrode_seq: list[int | None],
    udlaeg_seq: list[int | None],
    udlaeg_navn_seq: list[str | None],
    active_len: int,
    jbnr: int,
    kategori: str,
    irrigated: bool = False,
    fdato: str = "20/8",
    precision_dagsbasis: bool = False,
    base_ref: RotationCandidateRef | None = None,
    overrides: list[RotationPositionOverride] = (),
) -> RotationCandidateEvaluation:
    """Kernen af kandidat-evaluering: 8 positioner, hver med udvaskning + DB,
    samt gennemsnit over én fuld rotationscyklus (active_len). Tager de
    færdige afgrøde-/udlægssekvenser direkte i stedet for selv at slå dem op
    i biblioteket — genbrugt af både evaluate_candidate_for_mark (bibliotek)
    og evaluate_with_overrides (Fase 10 — manuel enkelt-position-rettelse).
    """
    n_norm_pct = float(result_ref.n_norm_pct)
    driftsform = saedskifte_kategorier.dyrkningssystem_for_kategori(kategori)

    n_inputs = [
        compute_n_inputs(
            afgrode_seq[i],
            afgrode_seq[(i - 1) % active_len],
            jbnr,
            n_norm_pct,
            kategori,
            irrigated,
        )
        for i in range(8)
    ]

    years: list[RotationCandidateYearResult] = []
    for i in range(8):
        this_code = afgrode_seq[i]
        next_code = afgrode_seq[(i + 1) % active_len]
        prev_code = afgrode_seq[(i - 1) % active_len]
        udl_code = udlaeg_seq[i]
        idx1, idx2 = (i - 1) % active_len, (i - 2) % active_len

        f0 = afgroede_normer.lookup_nfix(this_code, jbnr, irrigated) if this_code is not None else 0.0
        f1 = afgroede_normer.lookup_nfix(afgrode_seq[idx1], jbnr, irrigated) if afgrode_seq[idx1] is not None else 0.0
        f2 = afgroede_normer.lookup_nfix(afgrode_seq[idx2], jbnr, irrigated) if afgrode_seq[idx2] is not None else 0.0
        m1 = n_inputs[idx1]["mncs"] + n_inputs[idx1]["mnca"]
        m2 = n_inputs[idx2]["mncs"] + n_inputs[idx2]["mnca"]
        g1 = n_inputs[idx1]["g0"]
        g2 = n_inputs[idx2]["g0"]

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
            y=_START_CALENDAR_YEAR + i,
        )
        db = calculate_db(
            this_code, driftsform, jbnr,
            mncs=n_inputs[i]["mncs"], mnca=n_inputs[i]["mnca"], irrigated=irrigated,
            org_mineral_n_applied=n_inputs[i]["org_mineral_n_applied"],
            udlaeg_kode=udl_code,
        )
        crop_params = afgroede_normer.lookup_crop_params(this_code)

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
        ))

    cycle = years[:active_len]
    avg_leaching = sum(y.leaching_kg_n_ha for y in cycle) / len(cycle)
    avg_db = sum(y.db_kr_ha for y in cycle) / len(cycle)
    # FEN: kun meningsfuldt for FE-noterede afgrøder (helsæd/græs) — grovfoder-
    # udbytte, jf. samme definition som TabSaedsk's "Grovfoder FEN pr. ha".
    fen_values = [y.db_detail["udbytte"] for y in cycle if y.db_detail.get("udbytteenhed") == "FE/ha"]
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
    )


def evaluate_candidate_for_mark(
    ref: RotationCandidateRef,
    jbnr: int,
    kategori: str,
    start_year: int = 1,
    irrigated: bool = False,
    fdato: str = "20/8",
    precision_dagsbasis: bool = False,
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
        jbnr, kategori, irrigated, fdato, precision_dagsbasis,
    )


def evaluate_with_overrides(
    base_ref: RotationCandidateRef,
    overrides: list[RotationPositionOverride],
    jbnr: int,
    kategori: str,
    irrigated: bool = False,
    fdato: str = "20/8",
    precision_dagsbasis: bool = False,
) -> RotationCandidateEvaluation | None:
    """Som evaluate_candidate_for_mark, men overskriver hovedafgrøden i én
    eller flere positioner efter opslag i biblioteket — bruges af Fase 10's
    "Rediger manuelt" (levende beregning). Udlæg/virkemiddel ved den
    overskrevne position røres ikke, kun hovedafgrøden.

    result.ref bliver base_ref uændret hvis overrides er tom (så et "preview
    uden ændringer" er identisk med et almindeligt bibliotek-opslag);
    ellers en syntetisk, kollisionsfri ref (variant-suffiks "+manuel").
    """
    raw_rotation = saedskifte_library.generate_rotation(
        base_ref.saedskiftevariant, base_ref.variant, base_ref.n_norm_pct, 1
    )
    active_len = saedskifte_library.rotation_active_len(raw_rotation)
    if active_len == 0:
        return None

    afgrode_seq = [raw_rotation[i][0] for i in range(8)]
    udlaeg_seq = [raw_rotation[i][1] for i in range(8)]
    udlaeg_navn_seq = [raw_rotation[i][2] for i in range(8)]
    for override in overrides:
        afgrode_seq[override.position] = override.afgrode_kode

    if overrides:
        result_ref = RotationCandidateRef(
            saedskiftevariant=base_ref.saedskiftevariant,
            variant=f"{base_ref.variant}+manuel",
            n_norm_pct=base_ref.n_norm_pct,
        )
    else:
        result_ref = base_ref

    return evaluate_sequence_for_mark(
        result_ref, afgrode_seq, udlaeg_seq, udlaeg_navn_seq, active_len,
        jbnr, kategori, irrigated, fdato, precision_dagsbasis,
        base_ref=base_ref, overrides=overrides,
    )


def generate_candidates_for_field(
    kategori_saedskifter: dict[str, list[str]],
    n_norm_procenter: list[str],
    jbnr: int,
    fdato: str = "20/8",
    precision_dagsbasis: bool = False,
) -> list[RotationCandidateEvaluation]:
    """Kryds de eksplicit valgte (kategori -> saedskiftevariant-id'er) med
    valgte N-norm%-værdier × alle varianter, og evaluer hver resulterende
    kandidat.

    Bruges af "Opret scenarie" (usynlig baggrundsberegning, jf. plan-
    beslutning 14/19/Fase 9) — springer kombinationer der ikke findes i
    datasættet over (fx en N-norm% der ikke er defineret for en given
    variant), og deduplikerer på tværs af kategorier (saedskiftevariant
    "1"/ren brak hører til alle 6 kategorier).

    kategori_saedskifter styrer eksplicit hvilke saedskiftevariant-id'er der
    indgår pr. kategori (fra "Nyt scenarie"s fold-ud-liste) — en
    saedskiftevariant der ikke reelt hører til den angivne kategori
    filtreres defensivt fra, så en fejlformet anmodning ikke kan blande
    driftsform/gødningsregler forkert.
    """
    results: list[RotationCandidateEvaluation] = []
    seen_ref_ids: set[str] = set()

    for kategori, saedskiftevarianter in kategori_saedskifter.items():
        valid_saedskiftevarianter = set(saedskifte_kategorier.saedskifter_for_kategori(kategori))
        for saedskiftevariant in saedskiftevarianter:
            if saedskiftevariant not in valid_saedskiftevarianter:
                continue
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
                        ref, jbnr=jbnr, kategori=kategori,
                        fdato=fdato, precision_dagsbasis=precision_dagsbasis,
                    )
                    if result is not None:
                        results.append(result)

    return results
