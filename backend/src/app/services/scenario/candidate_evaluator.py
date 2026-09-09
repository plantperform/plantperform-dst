"""Evaluate one sædskifte candidate (RotationCandidateRef) for one mark.

The evaluation covers N inputs, udvaskning, and dækningsbidrag for each year
(eight positions), plus averages over one full rotation cycle.

The N-input logic in compute_n_inputs is ported from the "Organisk gødning"
sidebar in c:\\plantperform-nles\\streamlit_app.py (lines ~452-628, 911-1027).
The gødning parameters (org_mineral_n, mineralsk_andel_pct, only_organic) and
driftsform are scenarie-level choices (Phase 13's GodningSettings), completely
independent of the sædskifte being evaluated. See the compute_n_inputs docstring
for details.
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
from app.domain.soil import PercolationByKategori
from app.services.economics.db_calculator import calculate_db
from app.services.nles5 import bridge_v2
from app.services.nles5.engine import LowNitrogenModelError
from app.services.rotations import afgroede_normer, saedskifte_library

# The displayed/calculated eight-year rotation starts in 2027 for new
# simuleringer, but NLES5's time-trend term (τ·(Y−1991)) requires the correct
# calendar year for each position rather than one fixed value for all eight
# years. Position 1 = 2027, position 2 = 2028, etc.
START_CALENDAR_YEAR = 2027

_EFTERAFGROEDE_UDLAEG_KODER = frozenset({968, 9680, 970})
_EFTERAFGROEDE_FORFRUGTSVAERDI_KGN_HA = 21.0
_MELLEMAFGROEDE_UDLAEG_KODER = frozenset({9682, 9684})
_TIDLIG_SAANING_UDLAEG_KODER = frozenset({9683})


def _strip_disabled_virkemidler(
    raw_rotation: list[tuple[int | None, int | None, str | None]],
    tidlig_saaning: bool,
    mellemafgrode: bool,
) -> list[tuple[int | None, int | None, str | None]]:
    if tidlig_saaning and mellemafgrode:
        return raw_rotation

    stripped = []
    for afgrode_kode, udlaeg_kode, udlaeg_navn in raw_rotation:
        if not tidlig_saaning and udlaeg_kode in _TIDLIG_SAANING_UDLAEG_KODER:
            udlaeg_kode, udlaeg_navn = None, None
        elif not mellemafgrode and udlaeg_kode in _MELLEMAFGROEDE_UDLAEG_KODER:
            udlaeg_kode, udlaeg_navn = None, None
        stripped.append((afgrode_kode, udlaeg_kode, udlaeg_navn))
    return stripped


@lru_cache(maxsize=100_000)
def compute_n_inputs(
    afgrode_kode: int,
    prev_afgrode_kode: int | None,
    prev_udlaeg_kode: int | None,
    jbnr: int,
    n_norm_pct: float,
    org_mineral_n: float,
    mineralsk_andel_pct: float,
    only_organic: bool,
    irrigated: bool = False,
) -> dict:
    """Calculate {mncs, mnca, g0, net_n, org_mineral_n_applied} for one position.

    org_mineral_n/mineralsk_andel_pct/only_organic are the scenarie's gødning
    choices (Phase 13's GodningSettings), independent of the sædskifte being
    evaluated:
      - org_mineral_n=0 (pure mineral gødning): MNCS = full N norm scaled by
        N-norm%, G0=0. Organisk gødning versus handelsgødning is irrelevant to
        NLES5 when there is no organisk source.
      - only_organic=False (konventionel + gylle): eff_org is capped at
        net_scaled, MNCS remains net_scaled because handelsgødning tops up to
        the full norm, and G0 reflects the unutilized part corresponding to the
        norm-limited eff_org allocation.
      - only_organic=True (økologisk): eff_org and MNCS are both
        min(org_mineral_n, net_scaled), with no handelsgødning top-up. G0 is
        likewise based on eff_org: eff_org ×
        (100−mineralsk_andel%)/mineralsk_andel%.

    MNCA (autumn mineral N) is not part of the gødning choice in the original
    model. It is a separate, independent input that defaults to 0.
    """
    norm = afgroede_normer.lookup_norm(afgrode_kode, jbnr, irrigated)
    prev_norm = (
        afgroede_normer.lookup_norm(prev_afgrode_kode, jbnr, irrigated)
        if prev_afgrode_kode is not None
        else None
    )
    fv_forfrugt = prev_norm["forfrugtsvaerdi"] if prev_norm else 0.0
    if prev_udlaeg_kode in _EFTERAFGROEDE_UDLAEG_KODER:
        fv_forfrugt += _EFTERAFGROEDE_FORFRUGTSVAERDI_KGN_HA

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
    # G0 intentionally uses eff_org, the norm-limited quantity actually
    # allocated, rather than the raw org_mineral_n scenarie setting. The old
    # app (streamlit_app.py, sidebar lines 966-986) calculates org_pool_n from
    # uncapped org_mineral_n. That assumes the maximum permitted quantity of
    # husdyrgødning is always physically applied regardless of the afgrøde's
    # need. This assumption is confirmed to be wrong: gødning is applied only
    # up to the norm. org_mineral_n is an upper limit on allocated utilized N,
    # not a fixed applied quantity. G0 must therefore reflect the organically
    # bound remainder of the quantity actually allocated (eff_org), not the cap.
    g0 = eff_org * (pool_pct / mineralsk_andel_pct)

    if only_organic:
        mncs = eff_org
    else:
        mncs = net_scaled  # Organisk gødning + handelsgødning always total the full norm

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
    praecisionsjordbrug: bool = False,
    base_ref: RotationCandidateRef | None = None,
    overrides: list[RotationPositionOverride] = (),
    start_year: int = 1,
    real_history: dict[str, dict] | None = None,
    percolation_by_kategori: PercolationByKategori | None = None,
    org_n_topsoil: float | None = None,
    s_soil: float | None = None,
) -> RotationCandidateEvaluation:
    """Evaluate eight positions with udvaskning and DB plus cycle averages.

    This is the core candidate evaluation over one full rotation cycle
    (active_len). It accepts completed afgrøde/udlæg sequences directly rather
    than looking them up in the library. It is shared by
    evaluate_candidate_for_mark (library lookup) and evaluate_with_overrides
    (Phase 10, manual single-position adjustment).

    Optional real_history has the shape
    {2025: {"code", "mncs", "mnca", "g0"}, 2026: {...}} and comes from
    historisk_goedning.real_history_lookback. It contains the mark's own actual
    2025/26 afgrøder and their historical N inputs (Bilag 3), used to seed
    f1/f2/g1/g2/m1/m2 for positions 0 (2027) and 1 (2028) instead of cycling to
    a hypothetical future position in the same candidate. Only those two
    positions' lookbacks are affected; the rest of the rotation (2029+) still
    uses the scenarie's unchanged gødning choices. Omitting real_history keeps
    the previous behavior of purely cyclic lookback.
    """
    n_norm_pct = float(result_ref.n_norm_pct)

    def prev_code_for(i: int) -> int | None:
        """Return the afgrødekode one year before position i.

        Position 0 uses actual 2026 history when real_history is provided;
        otherwise the lookup cycles through the candidate.
        """
        idx = i - 1
        if real_history is not None and idx < 0:
            entry = real_history.get(str(START_CALENDAR_YEAR + idx))
            if entry is not None:
                return entry["code"]
        return afgrode_seq[idx % active_len]

    def prev_udlaeg_for(i: int) -> int | None:
        idx = i - 1
        # Historical data does not record virkemidler, so do not infer one.
        if real_history is not None and idx < 0:
            return None
        return udlaeg_seq[idx % active_len]

    n_inputs = [
        compute_n_inputs(
            afgrode_seq[i],
            prev_code_for(i),
            prev_udlaeg_for(i),
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
        """Return (code, f, m, g) for the afgrøde `offset` years before position i.

        Use actual 2025/26 history when cycling would otherwise select a
        hypothetical future position in the same candidate. This applies only
        to lookbacks from position 0/2027 and 1/2028, per the confirmed rule.
        """
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
        return (
            code,
            f,
            n_inputs[wrapped]["mncs"] + n_inputs[wrapped]["mnca"],
            n_inputs[wrapped]["g0"],
        )

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

        try:
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
                praecisionsjordbrug=praecisionsjordbrug,
                y=START_CALENDAR_YEAR + i,
                percolation_by_kategori=percolation_by_kategori,
                org_n_topsoil=org_n_topsoil,
                s_soil=s_soil,
            )
        except LowNitrogenModelError:
            # Known NLES5 low-N edge: a negative fractional-power base has no
            # real result. Missing soil data raises a different exception.
            leaching = {}
        db = calculate_db(
            this_code, driftsform, jbnr,
            mncs=n_inputs[i]["mncs"], mnca=n_inputs[i]["mnca"], irrigated=irrigated,
            org_mineral_n_applied=n_inputs[i]["org_mineral_n_applied"],
            udlaeg_kode=udl_code, only_organic=only_organic,
            praecisionsjordbrug=praecisionsjordbrug,
        )
        crop_params = afgroede_normer.lookup_crop_params(this_code)
        # org_mineral_n_applied is the utilized/mineral part of husdyrgødning,
        # the only part that counts toward the norm, like handelsgødning. g0 is
        # the remaining organically bound part; it does not count toward the
        # norm but enters L_nuar through G0/G1/G2 above.
        tildelt_husdyrgodning_udnyttet = n_inputs[i]["org_mineral_n_applied"]
        tildelt_handelsgodning = max(0.0, n_inputs[i]["mncs"] - tildelt_husdyrgodning_udnyttet)
        # Tonnage overview of the husdyrgødning actually allocated to this
        # position. This intentionally uses tildelt_husdyrgodning_udnyttet
        # (eff_org, this position's norm-limited allocation), not the raw
        # org_mineral_n scenarie setting. org_mineral_n is an upper limit on
        # utilized N allocated through husdyrgødning, not a fixed applied
        # quantity; gødning is applied only up to the norm. If there is no norm
        # (for example, brak or administrative land),
        # tildelt_husdyrgodning_udnyttet is already 0, so tonnage is also 0.
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
            leaching_kg_n_ha=leaching.get("L_nuar", 0.0),
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
    # FEN is meaningful only for afgrøder measured in FE (helsæd/græs):
    # grovfoderudbytte, using the same definition as TabSaedsk's
    # "Grovfoder FEN pr. ha".
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
    praecisionsjordbrug: bool = False,
    tidlig_saaning: bool = True,
    mellemafgrode: bool = True,
    real_history: dict[str, dict] | None = None,
    percolation_by_kategori: PercolationByKategori | None = None,
    org_n_topsoil: float | None = None,
    s_soil: float | None = None,
) -> RotationCandidateEvaluation | None:
    """Evaluate a sædskifte candidate over eight yearly positions.

    Each position includes udvaskning and DB, with averages over one full
    rotation cycle (active_len). Return None when (saedskiftevariant, variant)
    is absent from the dataset; callers should skip these rather than fail.
    """
    raw_rotation = saedskifte_library.generate_rotation(
        ref.saedskiftevariant, ref.variant, start_year
    )
    raw_rotation = _strip_disabled_virkemidler(raw_rotation, tidlig_saaning, mellemafgrode)
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
        praecisionsjordbrug=praecisionsjordbrug,
        start_year=start_year,
        real_history=real_history,
        percolation_by_kategori=percolation_by_kategori,
        org_n_topsoil=org_n_topsoil,
        s_soil=s_soil,
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
    praecisionsjordbrug: bool = False,
    tidlig_saaning: bool = True,
    mellemafgrode: bool = True,
    start_year: int = 1,
    real_history: dict[str, dict] | None = None,
    percolation_by_kategori: PercolationByKategori | None = None,
    org_n_topsoil: float | None = None,
    s_soil: float | None = None,
) -> RotationCandidateEvaluation | None:
    """Evaluate a candidate after applying manual changes to the library result.

    This works like evaluate_candidate_for_mark but overrides the hovedafgrøde
    in one or more positions and/or shifts the rotation's cyclic starting point
    (one-based start_year, "ryk sædskiftet frem/tilbage" in the old app's
    "Startår i rotation"). Phase 10's live "Rediger manuelt" calculation uses
    this function. An overridden position retains its udlæg/virkemiddel; only
    the hovedafgrøde changes.

    result.ref remains equal to base_ref when neither overrides nor start_year
    changed, making a preview without changes identical to a regular library
    lookup. Otherwise it is a synthetic, collision-free ref with the variant
    suffix "+manuel". A pure start_year shift also needs a synthetic ref;
    otherwise its actual afgrøde sequence would share an ID with the different
    start_year=1 candidate in the stored candidate set.
    """
    raw_rotation = saedskifte_library.generate_rotation(
        base_ref.saedskiftevariant, base_ref.variant, start_year
    )
    raw_rotation = _strip_disabled_virkemidler(raw_rotation, tidlig_saaning, mellemafgrode)
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
        praecisionsjordbrug=praecisionsjordbrug,
        base_ref=base_ref, overrides=overrides, start_year=start_year,
        real_history=real_history,
        percolation_by_kategori=percolation_by_kategori,
        org_n_topsoil=org_n_topsoil,
        s_soil=s_soil,
    )


def generate_candidates_for_field(
    saedskiftevarianter: list[str],
    n_norm_procenter: list[str],
    jbnr: int,
    godning: GodningSettings,
    fdato: str = "20/8",
    precision_dagsbasis: bool = False,
    praecisionsjordbrug: bool = False,
    tidlig_saaning: bool = True,
    mellemafgrode: bool = True,
    real_history: dict[str, dict] | None = None,
    percolation_by_kategori: PercolationByKategori | None = None,
    org_n_topsoil: float | None = None,
    s_soil: float | None = None,
) -> list[RotationCandidateEvaluation]:
    """Generate and evaluate every explicitly selected candidate combination.

    Cross the selected saedskiftevariant IDs with selected N-norm% values and
    every variant, then evaluate each result under the scenarie's gødning
    choice. Phase 13 uses the same gødning for every selected sædskifte,
    independently of which sædskifter were selected.

    "Opret scenarie" uses this for its hidden background calculation (plan
    decisions 14/19, Phase 9). N-norm% is now only a percentage scaling in
    candidate_evaluator.compute_n_inputs, not part of the rotation lookup; see
    the saedskifte_library.py module docstring. There are consequently no
    invalid combinations to skip: every selected N-norm% applies to every
    selected sædskifte/variant.
    """
    results: list[RotationCandidateEvaluation] = []
    seen_ref_ids: set[str] = set()
    seen_rotation_by_n_norm: dict[str, set[tuple]] = {}

    for saedskiftevariant in saedskiftevarianter:
        for variant in saedskifte_library.list_variants(saedskiftevariant):
            raw_rotation = saedskifte_library.generate_rotation(saedskiftevariant, variant)
            rotation_signature = tuple(
                _strip_disabled_virkemidler(raw_rotation, tidlig_saaning, mellemafgrode)
            )
            for n_norm_pct in n_norm_procenter:
                ref = RotationCandidateRef(
                    saedskiftevariant=saedskiftevariant, variant=variant, n_norm_pct=n_norm_pct,
                )
                ref_id = ref.to_id()
                if ref_id in seen_ref_ids:
                    continue
                seen_ref_ids.add(ref_id)
                seen_for_norm = seen_rotation_by_n_norm.setdefault(n_norm_pct, set())
                if rotation_signature in seen_for_norm:
                    continue
                seen_for_norm.add(rotation_signature)
                result = evaluate_candidate_for_mark(
                    ref, jbnr=jbnr,
                    driftsform=godning.driftsform,
                    org_mineral_n=godning.org_mineral_n,
                    mineralsk_andel_pct=godning.mineralsk_andel_pct,
                    only_organic=godning.only_organic,
                    n_indhold_kg_per_ton=godning.n_indhold_kg_per_ton,
                    fdato=fdato, precision_dagsbasis=precision_dagsbasis,
                    praecisionsjordbrug=praecisionsjordbrug,
                    tidlig_saaning=tidlig_saaning,
                    mellemafgrode=mellemafgrode,
                    real_history=real_history,
                    percolation_by_kategori=percolation_by_kategori,
                    org_n_topsoil=org_n_topsoil,
                    s_soil=s_soil,
                )
                if result is not None:
                    results.append(result)

    return results
