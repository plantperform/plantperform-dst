"""Prepare solver inputs and assemble results without changing simulation setup."""

import math
from collections import defaultdict
from dataclasses import dataclass, replace
from types import SimpleNamespace

from app.data import repository
from app.data.optimizer_inputs import OptimizerCandidate, OptimizerYear
from app.domain.field import FieldRecord
from app.domain.optimization import (
    NUM_YEARS,
    QuotaTradeSetting,
    SimulationQuotaTrade,
    untradable_quota_reason,
)
from app.domain.rotation_candidate import RotationCandidateEvaluation, SimulationFieldCandidates
from app.domain.simulation import OEKO_N_LOFT_BASIS, GodningSettings, KystvandoplandNLoadCap
from app.domain.soil import PercolationByKategori
from app.services.rotations import afgroede_normer, saedskifte_library
from app.services.rotations.custom import with_snapshot_rotations
from app.services.scenario import candidate_evaluator
from app.services.scenario.rotations import selected_locked_candidate
from plantperform_fargate.deadline import check_deadline, solver_time_limit
from plantperform_fargate.engine import solve
from plantperform_fargate.models import (
    ConstraintsInput,
    FieldInput,
    FixedFieldContribution,
    FixedYearlyFieldContribution,
    OptimizationInput,
    OptimizationOutput,
    RotationOption,
    YearlyConstraintsInput,
    YearlyFieldInput,
    YearlyOptimizationInput,
    YearlyOptimizationOutput,
    YearlyRotationOption,
)
from plantperform_fargate.yearly_engine import solve_yearly


class OptimizationNotFoundError(Exception):
    pass


class OptimizationInfeasibleError(Exception):
    pass


class OptimizationUnknownError(Exception):
    pass


@dataclass(frozen=True)
class OptimizationRunResult:
    output: OptimizationOutput
    fields: tuple[FieldRecord, ...]
    selected_candidates: dict[str, RotationCandidateEvaluation]


@dataclass(frozen=True)
class YearlyOptimizationRunResult:
    output: YearlyOptimizationOutput
    fields: tuple[FieldRecord, ...]
    selected_candidates: dict[str, RotationCandidateEvaluation]
    quota_trades: tuple[SimulationQuotaTrade, ...] = ()


def _exclude_afgrodekoder(
    candidates: list[RotationCandidateEvaluation],
    excluded_afgrodekoder: frozenset[int],
) -> list[RotationCandidateEvaluation]:
    if not excluded_afgrodekoder:
        return candidates
    return [
        candidate
        for candidate in candidates
        if not any(
            year.year.afgrode_kode in excluded_afgrodekoder
            for year in candidate.years[: candidate.active_len]
        )
    ]


def _udnyttet_n_kgn_ha_by_year(candidate: RotationCandidateEvaluation) -> tuple[float, ...]:
    """kg utilised N per ha in each candidate year, of a full or a compact candidate."""
    if not isinstance(candidate, OptimizerCandidate):
        return tuple(y.udnyttet_n_kgn_ha for y in candidate.years)
    if len(candidate.udnyttet_n_kgn_ha_by_year) != len(candidate.years):
        # Without this a candidate prepared without its utilised N would count as 0.
        raise ValueError("The compact candidate does not carry its utilised N")
    return candidate.udnyttet_n_kgn_ha_by_year


def _udnyttet_n_and_harmoni_area_by_year(
    candidate: RotationCandidateEvaluation,
    area_ha: float,
) -> tuple[tuple[float, ...], tuple[float, ...]]:
    """kg utilised N and ha harmoniareal of a whole mark, one entry per candidate year.

    The ceiling of the økologisk arealstøtte divides the farm's utilised N by
    its harmoniareal, which is the area of the afgrøder the master table marks
    Harmoni.
    """
    return (
        tuple(n * area_ha for n in _udnyttet_n_kgn_ha_by_year(candidate)),
        tuple(
            area_ha if afgroede_normer.is_harmoniareal(y.year.afgrode_kode) else 0.0
            for y in candidate.years
        ),
    )


def _cycle_average(by_year: tuple[float, ...], active_len: int) -> float:
    cycle = by_year[:active_len]
    return sum(cycle) / len(cycle) if cycle else 0.0


def _build_options(
    field: FieldRecord,
    candidates: list[RotationCandidateEvaluation],
    excluded_afgrodekoder: frozenset[int] = frozenset(),
    with_udnyttet_n: bool = False,
) -> tuple[RotationOption, ...]:
    """Build one RotationOption per stored, invisibly calculated candidate.

    These candidates come from "Opret scenarie". There is no 2^n virkemiddel
    expansion here; decision 7 reserves virkemidler as a future candidate
    facet that has not yet been built.

    Only called for marks without `allowed_rotation_ids` - a locked mark (for
    example after Phase 10's "Rediger manuelt") is not a decision variable at
    all; see _locked_field_contribution and run_optimization.

    with_udnyttet_n adds each option's utilised N and harmoniareal, which only
    the ceiling of the økologisk arealstøtte needs.
    """
    retention_factor = 1 - (field.retention or 0) / 100
    candidates = _exclude_afgrodekoder(candidates, excluded_afgrodekoder)
    options = []
    for candidate in candidates:
        ref_id = candidate.ref.to_id()
        leaching_total = candidate.avg_leaching_kg_n_ha * field.area_ha
        udnyttet_n = harmoni_area_ha = 0.0
        if with_udnyttet_n:
            n_by_year, harmoni_by_year = _udnyttet_n_and_harmoni_area_by_year(
                candidate, field.area_ha
            )
            udnyttet_n = _cycle_average(n_by_year, candidate.active_len)
            harmoni_area_ha = _cycle_average(harmoni_by_year, candidate.active_len)
        options.append(
            RotationOption(
                key=ref_id,
                id=ref_id,
                years=tuple(y.year for y in candidate.years[: candidate.active_len]),
                db2=candidate.avg_db_kr_ha * field.area_ha,
                n_load=leaching_total * retention_factor,
                leaching=leaching_total,
                fen=candidate.avg_fen * field.area_ha,
                udnyttet_n=udnyttet_n,
                harmoni_area_ha=harmoni_area_ha,
            )
        )
    return tuple(options)


def _kvote_by_kystvandopland(fields: list[FieldRecord]) -> dict[int, float]:
    """Sum each kystvandopland's udledningskvote over its kvotegivende marker.

    Only kvotegivende marker draw on the quota, and only their udledning counts
    against a cap in the engines, so the default cap is their quota alone. It is
    rounded half up to whole kg N, exactly as the frontend rounds the value that
    Regler shows and saves.
    """
    quota_by_kystvand: dict[int, float] = {}
    for field in fields:
        check_deadline()
        if field.kystvand_id is None or not field.kvotegivende:
            continue
        quota_by_kystvand[field.kystvand_id] = (
            quota_by_kystvand.get(field.kystvand_id, 0.0) + field.udledningskvote_mark_kgn
        )
    return {
        kystvand_id: float(int(quota + 0.5))
        for kystvand_id, quota in quota_by_kystvand.items()
        if quota > 0
    }


def _locked_field_contribution(
    field: FieldRecord,
    candidate: RotationCandidateEvaluation | None = None,
    with_udnyttet_n: bool = False,
) -> FixedFieldContribution:
    """Use saved metrics, and the selected candidate's crops and N when needed."""
    udnyttet_n = harmoni_area_ha = 0.0
    if with_udnyttet_n and candidate is not None:
        n_by_year, harmoni_by_year = _udnyttet_n_and_harmoni_area_by_year(candidate, field.area_ha)
        udnyttet_n = _cycle_average(n_by_year, candidate.active_len)
        harmoni_area_ha = _cycle_average(harmoni_by_year, candidate.active_len)
    return FixedFieldContribution(
        kystvand_id=field.kystvand_id,
        db2=field.db2,
        n_load=field.n_load,
        leaching=field.leaching,
        fen=field.fen,
        kvotegivende=field.kvotegivende,
        area_ha=field.area_ha if candidate is not None else 0.0,
        crop_codes_by_year=(
            tuple(y.year.afgrode_kode for y in candidate.years[: candidate.active_len])
            if candidate is not None
            else ()
        ),
        udnyttet_n=udnyttet_n,
        harmoni_area_ha=harmoni_area_ha,
    )


def _max_n_load_by_kystvandopland(
    fields: list[FieldRecord],
    saved_caps: list[KystvandoplandNLoadCap],
) -> dict[int | None, float]:
    """Resolve the per-kystvandopland N-load cap for a run.

    An explicitly saved cap (set from "Regler") always wins, including an
    explicit `None` (the user cleared it back to no limit). A kystvandopland
    with no saved entry at all - the common case when the user has never
    opened "Regler" - defaults to the combined udledningskvote of its
    kvotegivende marker instead of running unconstrained, mirroring the
    default shown in the Regler panel. Fields with no kystvandopland have no
    quota to default to, so that bucket only ever gets a cap if one was
    explicitly saved for it.
    """
    saved_by_kystvand = {cap.kystvand_id: cap.max_n_load_kg for cap in saved_caps}
    quota_by_kystvand = _kvote_by_kystvandopland(fields)

    resolved: dict[int | None, float] = {}
    for kystvand_id in {*saved_by_kystvand, *quota_by_kystvand}:
        value = (
            saved_by_kystvand[kystvand_id]
            if kystvand_id in saved_by_kystvand
            else quota_by_kystvand.get(kystvand_id)
        )
        if value is not None:
            resolved[kystvand_id] = value
    return resolved


NLoadKey = tuple[int | None, int | None]


def _lowest_n_load_by_kystvandopland(
    field_inputs: list[FieldInput],
    fixed_fields: list[FixedFieldContribution],
) -> dict[NLoadKey, float]:
    lowest: dict[NLoadKey, float] = defaultdict(float)
    for field in field_inputs:
        if field.kvotegivende:
            lowest[(field.kystvand_id, None)] += min(option.n_load for option in field.options)
    for fixed in fixed_fields:
        if fixed.kvotegivende:
            lowest[(fixed.kystvand_id, None)] += fixed.n_load
    return lowest


def _lowest_n_load_by_kystvandopland_and_year(
    field_inputs: list[YearlyFieldInput],
    fixed_fields: list[FixedYearlyFieldContribution],
) -> dict[NLoadKey, float]:
    lowest: dict[NLoadKey, float] = defaultdict(float)
    for field in field_inputs:
        if field.kvotegivende:
            for year in range(NUM_YEARS):
                lowest[(field.kystvand_id, year)] += min(
                    option.n_load_by_year[year] for option in field.options
                )
    for fixed in fixed_fields:
        if fixed.kvotegivende:
            for year, n_load in enumerate(fixed.n_load_by_year):
                lowest[(fixed.kystvand_id, year)] += n_load
    return lowest


def _lowest_average(
    choices: list[list[tuple[float, float]]],
    fixed_n: float,
    fixed_area: float,
) -> float | None:
    """The lowest total N over total harmoniareal that one pick per mark reaches.

    Each mark offers (kg utilised N, ha harmoniareal) pairs, one per option.
    This is Dinkelbach's method: for a guessed average every mark takes the
    option with the least N above what that average allows its harmoniareal,
    and the average of that pick is the next guess, which never rises. A pick
    without any harmoniareal has no average. With no N either it meets any
    ceiling, so the answer is 0; with N, the earlier guess stands (None at the
    start, when there is none).
    """
    pick = [min(options) for options in choices]
    average = None
    for _ in range(100):
        total_n = fixed_n + sum(n for n, _ in pick)
        total_area = fixed_area + sum(area for _, area in pick)
        if total_area <= 0:
            return 0.0 if total_n <= 1e-9 else average
        if average is not None and total_n / total_area >= average - 1e-9:
            break
        average = total_n / total_area
        pick = [
            min(options, key=lambda option, lam=average: option[0] - lam * option[1])
            for options in choices
        ]
    return average


def _lowest_udnyttet_n_per_harmoni_ha(
    field_inputs: list[FieldInput],
    fixed_fields: list[FixedFieldContribution],
) -> dict[int | None, float | None]:
    return {
        None: _lowest_average(
            [
                [(option.udnyttet_n, option.harmoni_area_ha) for option in field.options]
                for field in field_inputs
            ],
            sum(fixed.udnyttet_n for fixed in fixed_fields),
            sum(fixed.harmoni_area_ha for fixed in fixed_fields),
        )
    }


def _lowest_udnyttet_n_per_harmoni_ha_by_year(
    field_inputs: list[YearlyFieldInput],
    fixed_fields: list[FixedYearlyFieldContribution],
) -> dict[int | None, float | None]:
    return {
        year: _lowest_average(
            [
                [
                    (option.udnyttet_n_by_year[year], option.harmoni_area_by_year[year])
                    for option in f.options
                ]
                for f in field_inputs
            ],
            sum(fixed.udnyttet_n_by_year[year] for fixed in fixed_fields),
            sum(fixed.harmoni_area_by_year[year] for fixed in fixed_fields),
        )
        for year in range(NUM_YEARS)
    }


def _kg_per_ha(value: float) -> str:
    """Round up, so the lowest possible average never reads as meeting the ceiling."""
    return f"{math.ceil(value * 10) / 10:.1f}".replace(".", ",")


def _n_ceiling_shortfall_error(
    ceiling: float,
    lowest: dict[int | None, float | None],
) -> OptimizationInfeasibleError | None:
    """Name the years in which no pick gets the farm's average N under the ceiling.

    ``lowest`` maps a year, or None for the period average, to the lowest
    average the options reach. Returns None when every one of them can meet
    the ceiling, so the cause is some other limit.
    """
    over = [
        (year, value)
        for year, value in lowest.items()
        if value is not None and value > ceiling + 1e-9
    ]
    if not over:
        return None
    parts = []
    for year, value in over:
        when = "" if year is None else f"i {candidate_evaluator.START_CALENDAR_YEAR + year} "
        parts.append(f"{when}(laveste mulige: {_kg_per_ha(value)} kg N)")
    listed = parts[0] if len(parts) == 1 else f"{', '.join(parts[:-1])} og {parts[-1]}"
    remedies = ["flere N-norm-niveauer under 100 %", "flere sædskifter"]
    if ceiling < OEKO_N_LOFT_BASIS:
        remedies.append(f"grænsen på {OEKO_N_LOFT_BASIS} kg N")
    advice = f"{', '.join(remedies[:-1])} eller {remedies[-1]}"
    return OptimizationInfeasibleError(
        "Med de valgte sædskifter og N-normer kan bedriftens gennemsnit af udnyttet N ikke "
        f"komme under grænsen på {ceiling:g} kg N pr. ha harmoniareal {listed}. Vælg {advice}."
    )


def _kg(value: int) -> str:
    return f"{value:,}".replace(",", ".")


def _kystvand_names(farm_id: str, email: str) -> dict[int | None, str]:
    return {
        row.kystvand_id: row.kystvand_navn
        for row in repository.get_farm_udledning_per_kystvandopland(farm_id, email) or []
    }


def _kystvand_name(names: dict[int | None, str], kystvand_id: int | None) -> str:
    return names.get(kystvand_id) or (
        f"kystvandopland {kystvand_id}" if kystvand_id is not None else "marker uden kystvandopland"
    )


def _validate_quota_trades(
    fields: list[FieldRecord],
    quota_trades: tuple[QuotaTradeSetting, ...],
    names: dict[int | None, str],
) -> None:
    """Check each kvotehandel against this run's marker.

    Saved settings are checked without marker, so a trade for an opland whose
    kvotegivende marker are gone is only caught here.
    """
    kvotegivende = {field.kystvand_id for field in fields if field.kvotegivende}
    for trade in quota_trades:
        reason = untradable_quota_reason(trade.kystvand_id in kvotegivende)
        if reason is not None:
            raise ValueError(
                f"Kvotehandel er ikke mulig i {_kystvand_name(names, trade.kystvand_id)}: "
                f"{reason.lower()}."
            )


def _quota_shortfall_error(
    farm_id: str,
    email: str,
    lowest: dict[NLoadKey, float],
    caps: dict[NLoadKey, float | None],
) -> OptimizationInfeasibleError | None:
    over = [
        (key, value, cap)
        for key, value in lowest.items()
        if (cap := caps.get(key)) is not None and value > cap
    ]
    if not over:
        return None
    names = _kystvand_names(farm_id, email)
    parts = []
    for (kystvand_id, year), value, cap in over:
        name = _kystvand_name(names, kystvand_id)
        when = "" if year is None else f" i {candidate_evaluator.START_CALENDAR_YEAR + year}"
        parts.append(
            f"{name}{when} (mindst {_kg(math.ceil(value))} kg N, "
            f"grænse {_kg(math.floor(cap))} kg N)"
        )
    listed = parts[0] if len(parts) == 1 else f"{', '.join(parts[:-1])} og {parts[-1]}"
    return OptimizationInfeasibleError(
        f"Med de valgte sædskifter kan udledningen ikke komme under grænsen i {listed}. "
        "Vælg flere sædskifter, eller hæv maks. udledning under Grænser."
    )


@with_snapshot_rotations
def run_optimization(
    farm_id: str,
    simulation_id: str,
    time_limit_seconds: float,
    excluded_afgrodekoder: frozenset[int],
    email: str,
    snapshot,
) -> OptimizationRunResult:
    simulation, fields, field_candidates = snapshot

    if simulation is None or fields is None or field_candidates is None:
        raise OptimizationNotFoundError

    if not fields:
        raise OptimizationInfeasibleError("Simuleringen har ingen marker at optimere.")

    candidates_by_field_id = {fc.field_id: fc.candidates for fc in field_candidates}
    n_ceiling = simulation.godning.oeko_n_loft_kg_ha

    field_inputs = []
    fixed_fields = []
    for field in fields:
        check_deadline()
        if field.allowed_rotation_ids:
            candidate = None
            if simulation.constraints.crop_area_limits or n_ceiling is not None:
                candidate = selected_locked_candidate(
                    field,
                    candidates_by_field_id.get(field.id, []),
                )
                if candidate is None:
                    raise OptimizationInfeasibleError(
                        f"Marken {field.name} er låst til en sædskiftekandidat, der ikke "
                        "længere findes — lås marken op og lås den igen."
                    )
            fixed_fields.append(
                _locked_field_contribution(field, candidate, with_udnyttet_n=n_ceiling is not None)
            )
            continue

        options = _build_options(
            field,
            candidates_by_field_id.get(field.id, []),
            excluded_afgrodekoder,
            with_udnyttet_n=n_ceiling is not None,
        )
        if not options:
            raise OptimizationInfeasibleError(
                f"Marken {field.name} har ingen beregnede sædskifte-kandidater tilbage — "
                "genopret scenariet med mindst én kategori og N-norm%, eller fravælg "
                "færre afgrøder."
            )

        field_inputs.append(
            FieldInput(
                id=field.id,
                area_ha=field.area_ha,
                kystvand_id=field.kystvand_id,
                options=options,
                kvotegivende=field.kvotegivende,
            )
        )

    max_n_load = _max_n_load_by_kystvandopland(
        fields,
        simulation.constraints.max_n_load_by_kystvandopland,
    )
    output = solve(
        input=OptimizationInput(
            fields=tuple(field_inputs),
            fixed_fields=tuple(fixed_fields),
            constraints=ConstraintsInput(
                max_n_load_by_kystvandopland=max_n_load,
                min_fen=simulation.constraints.min_fen,
                max_fen=simulation.constraints.max_fen,
                crop_area_limits=tuple(simulation.constraints.crop_area_limits),
                max_udnyttet_n_per_harmoni_ha=n_ceiling,
            ),
            time_limit_seconds=solver_time_limit(time_limit_seconds),
        )
    )

    if output.status == "INFEASIBLE":
        error = _quota_shortfall_error(
            farm_id,
            email,
            _lowest_n_load_by_kystvandopland(field_inputs, fixed_fields),
            {(kystvand_id, None): cap for kystvand_id, cap in max_n_load.items()},
        )
        if error is None and n_ceiling is not None:
            error = _n_ceiling_shortfall_error(
                n_ceiling, _lowest_udnyttet_n_per_harmoni_ha(field_inputs, fixed_fields)
            )
        raise error or OptimizationInfeasibleError(
            "Ingen sædskifte-fordeling kan opfylde de gemte krav — lempe krav som "
            "maks. udledning eller foderenheder og prøv igen."
        )

    if output.status == "UNKNOWN":
        raise OptimizationUnknownError(
            "Optimeringen fandt ikke en løsning inden for tidsgrænsen — prøv at lempe kravene."
        )

    updated_by_id = {
        assignment.field_id: _assigned_field(
            next(field for field in fields if field.id == assignment.field_id),
            assignment,
        )
        for assignment in output.assignments
    }
    result_fields = tuple(updated_by_id.get(field.id, field) for field in fields)
    selected = {
        field.id: candidate
        for field in result_fields
        for candidate in candidates_by_field_id.get(field.id, [])
        if candidate.ref.to_id() == field.rotation_id
    }
    return OptimizationRunResult(output=output, fields=result_fields, selected_candidates=selected)


def _assigned_field(field, assignment):
    return field.model_copy(
        update={
            "crop_rotation": list(assignment.years),
            "rotation_id": assignment.rotation_id,
            "db2": assignment.db2,
            "n_load": assignment.n_load,
            "leaching": assignment.leaching,
            "fen": assignment.fen,
        }
    )


def _shift_count(candidate: RotationCandidateEvaluation) -> int:
    """Return how many distinct start years a candidate's sædskifte has.

    candidate.active_len is always 8, because generate_rotation cycles a
    shorter library rotation out to eight positions before it is measured. A
    3-year rotation shifted by 4 is the same sequence as shifted by 1, so
    shifting through all eight positions only adds duplicate options to the
    CP-SAT model. The rotation's own length comes from the library instead. A
    candidate with "Rediger manuelt" overrides is an eight-year plan in its own
    right and keeps all eight start years.
    """
    if candidate.overrides:
        return candidate.active_len
    source_ref = candidate.base_ref or candidate.ref
    cycle_len = saedskifte_library.rotation_active_len(
        saedskifte_library.get_raw_rotation(source_ref.saedskiftevariant, source_ref.variant)
    )
    return min(cycle_len, candidate.active_len) or candidate.active_len


def _expand_yearly_options(
    field: FieldRecord,
    candidates: list[RotationCandidateEvaluation],
    jbnr: int,
    godning: GodningSettings,
    fdato: str,
    precision_dagsbasis: bool,
    praecisionsjordbrug: bool,
    tidlig_saaning: bool,
    mellemafgrode: bool,
    excluded_afgrodekoder: frozenset[int] = frozenset(),
    real_history: dict[str, dict] | None = None,
    percolation_by_kategori: PercolationByKategori | None = None,
    org_n_topsoil: float | None = None,
    s_soil: float | None = None,
    economics_key: str = "",
) -> tuple[YearlyRotationOption, ...]:
    """Expand each stored candidate to one variant per distinct start year.

    start_year ranges from 1 through _shift_count(candidate), as in Phase 10's
    evaluate_with_overrides. Phase 11's additional "Års-optimering" decision
    variable uses these variants to shift a mark's sædskifte forward or
    backward to better satisfy annual udledning caps and the DB fluctuation
    limit.

    Only called for marks without `allowed_rotation_ids` - a locked mark is
    not shifted or re-evaluated at all; see _locked_yearly_field_contribution
    and run_yearly_optimization.

    Every candidate can be shifted. The run-level afgrøde exclusion filter
    alone determines which candidates are removed entirely.
    """
    retention_factor = 1 - (field.retention or 0) / 100
    candidates = _exclude_afgrodekoder(candidates, excluded_afgrodekoder)

    # A candidate with base_ref and no overrides is a pure shift of another
    # candidate left by an earlier run. Shifting it again would only recreate
    # sequences already covered by its base_ref's shift expansion. Skip it to
    # prevent the candidate set, and thus the CP-SAT model, from growing on
    # every repeated run, but only while base_ref is still present. A
    # candidate with actual Phase 10 "Rediger manuelt" overrides is unique
    # and is always retained.
    present_ids = {c.ref.to_id() for c in candidates}
    candidates = [
        c
        for c in candidates
        if c.overrides or c.base_ref is None or c.base_ref.to_id() not in present_ids
    ]

    options: list[YearlyRotationOption] = []
    for candidate in candidates:
        if candidate.active_len == 0:
            continue

        source_ref = candidate.base_ref or candidate.ref
        for shift in range(1, _shift_count(candidate) + 1):
            check_deadline()
            variant = (
                candidate
                if shift == 1 and candidate.base_ref is None
                else candidate_evaluator.evaluate_with_overrides(
                    source_ref,
                    candidate.overrides,
                    jbnr=jbnr,
                    driftsform=godning.driftsform,
                    org_mineral_n=godning.org_mineral_n,
                    mineralsk_andel_pct=godning.mineralsk_andel_pct,
                    only_organic=godning.only_organic,
                    n_indhold_kg_per_ton=godning.n_indhold_kg_per_ton,
                    oeko_n_loft=godning.oeko_n_loft,
                    fdato=fdato,
                    precision_dagsbasis=precision_dagsbasis,
                    praecisionsjordbrug=praecisionsjordbrug,
                    tidlig_saaning=tidlig_saaning,
                    mellemafgrode=mellemafgrode,
                    start_year=shift,
                    real_history=real_history,
                    percolation_by_kategori=percolation_by_kategori,
                    org_n_topsoil=org_n_topsoil,
                    s_soil=s_soil,
                    economics_key=economics_key,
                    autumn_plan=godning.autumn_plan(),
                )
            )
            if variant is None:
                continue

            db2_by_year = tuple(y.db_kr_ha * field.area_ha for y in variant.years)
            leaching_by_year = tuple(y.leaching_kg_n_ha * field.area_ha for y in variant.years)
            n_load_by_year = tuple(leaching * retention_factor for leaching in leaching_by_year)
            udnyttet_n_by_year, harmoni_area_by_year = (
                _udnyttet_n_and_harmoni_area_by_year(variant, field.area_ha)
                if godning.oeko_n_loft_kg_ha is not None
                else ((), ())
            )
            ref_id = variant.ref.to_id()
            # Expanded alternatives carry numbers in memory, not rich reports.
            compact = OptimizerCandidate(
                ref=variant.ref,
                base_ref=variant.base_ref,
                overrides=variant.overrides,
                start_year=variant.start_year,
                active_len=variant.active_len,
                avg_db_kr_ha=variant.avg_db_kr_ha,
                avg_leaching_kg_n_ha=variant.avg_leaching_kg_n_ha,
                avg_fen=variant.avg_fen,
                years=[
                    OptimizerYear(
                        year=y.year,
                        db_kr_ha=y.db_kr_ha,
                        leaching_kg_n_ha=y.leaching_kg_n_ha,
                        fen_fe_ha=y.fen_fe_ha,
                    )
                    for y in variant.years
                ],
            )
            options.append(
                YearlyRotationOption(
                    key=ref_id,
                    id=ref_id,
                    candidate=compact,
                    years=tuple(y.year for y in variant.years[: variant.active_len]),
                    db2_by_year=db2_by_year,
                    n_load_by_year=n_load_by_year,
                    leaching_by_year=leaching_by_year,
                    fen=variant.avg_fen * field.area_ha,
                    fen_by_year=_fen_by_year(variant, field.area_ha),
                    udnyttet_n_by_year=udnyttet_n_by_year,
                    harmoni_area_by_year=harmoni_area_by_year,
                )
            )
    return tuple(options)


def _fen_by_year(
    candidate: RotationCandidateEvaluation,
    area_ha: float,
) -> tuple[float, ...]:
    """Foderenheder per calendar year for a mark, one entry per candidate year.

    fen_fe_ha follows avg_fen's FE/ha rule and is present both on compact
    cached years, which omit db_detail, and on freshly evaluated ones.
    """
    return tuple(y.fen_fe_ha * area_ha for y in candidate.years)


def _max_n_load_by_kystvandopland_and_year(
    fields: list[FieldRecord],
    requested: dict[int | None, tuple[float | None, ...]],
) -> dict[int | None, tuple[float | None, ...]]:
    """Resolve the per-kystvandopland, per-year N-load cap for a yearly run.

    A kystvandopland in the request is taken as sent: a blank year (None) means
    no limit that year, which is what the dialog's "Ingen grænse" promises. A
    kystvandopland missing from the request entirely defaults to the combined
    udledningskvote of its kvotegivende marker for every year, like
    _max_n_load_by_kystvandopland does when nothing was saved.
    """
    resolved = dict(requested)
    for kystvand_id, quota in _kvote_by_kystvandopland(fields).items():
        if kystvand_id not in resolved:
            resolved[kystvand_id] = (quota,) * NUM_YEARS
    return resolved


def _locked_yearly_field_contribution(
    field: FieldRecord,
    candidates: list[RotationCandidateEvaluation],
    with_udnyttet_n: bool = False,
) -> FixedYearlyFieldContribution | None:
    """A locked mark's fixed per-year contribution, from its own locked candidate.

    No shifting, no re-evaluation - Års-optimering does not get to phase a
    locked mark's rotation either, it is exactly as static as its db2/
    n_load/leaching already are everywhere else. Returns None if the locked
    candidate can no longer be found (stale allowed_rotation_ids), so the
    caller can fail with a clear error instead of silently dropping the
    mark's quota use from the model.
    """
    candidate = selected_locked_candidate(field, candidates)
    if candidate is None:
        return None
    retention_factor = 1 - (field.retention or 0) / 100
    leaching_by_year = tuple(y.leaching_kg_n_ha * field.area_ha for y in candidate.years)
    udnyttet_n_by_year, harmoni_area_by_year = (
        _udnyttet_n_and_harmoni_area_by_year(candidate, field.area_ha)
        if with_udnyttet_n
        else ((), ())
    )
    return FixedYearlyFieldContribution(
        kystvand_id=field.kystvand_id,
        db2_by_year=tuple(y.db_kr_ha * field.area_ha for y in candidate.years),
        n_load_by_year=tuple(leaching * retention_factor for leaching in leaching_by_year),
        leaching_by_year=leaching_by_year,
        fen=candidate.avg_fen * field.area_ha,
        fen_by_year=_fen_by_year(candidate, field.area_ha),
        kvotegivende=field.kvotegivende,
        area_ha=field.area_ha,
        crop_codes_by_year=tuple(y.year.afgrode_kode for y in candidate.years),
        udnyttet_n_by_year=udnyttet_n_by_year,
        harmoni_area_by_year=harmoni_area_by_year,
    )


@dataclass(frozen=True)
class YearlyInputBuild:
    """The yearly solver input plus what is needed to turn a solution into fields."""

    input: YearlyOptimizationInput
    fields: tuple[FieldRecord, ...]
    options_by_field_id: dict[str, tuple[YearlyRotationOption, ...]]
    candidates_by_field_id: dict[str, SimulationFieldCandidates]


@with_snapshot_rotations
def build_yearly_input(
    farm_id: str,
    simulation_id: str,
    time_limit_seconds: float,
    max_n_load_by_kystvandopland: dict[int | None, tuple[float | None, ...]],
    db2_swing_pct: float | None,
    excluded_afgrodekoder: frozenset[int],
    email: str,
    snapshot,
    quota_trades: tuple[QuotaTradeSetting, ...] = (),
) -> YearlyInputBuild:
    """Build the "Års-optimering" solver input, including every shifted option.

    Expanding the shifted options is the expensive part of a yearly run, so
    callers that solve the same scenarie several times (the kvote value curve)
    build it once and only vary the constraints.
    """
    simulation, fields, field_candidates = snapshot

    if simulation is None or fields is None or field_candidates is None:
        raise OptimizationNotFoundError

    if not fields:
        raise OptimizationInfeasibleError("Simuleringen har ingen marker at optimere.")

    candidates_by_field_id = {fc.field_id: fc for fc in field_candidates}
    n_ceiling = simulation.godning.oeko_n_loft_kg_ha
    if hasattr(snapshot, "contexts"):
        soil_data_by_imk_id = {
            field.imk_id: repository._soil_data_for_context(SimpleNamespace(**context))
            for field in fields
            if (context := snapshot.contexts.get(field.id)) is not None
        }
    else:
        soil_data_by_imk_id = repository.get_registry_soil_data_batch(
            [field.imk_id for field in fields if field.imk_id is not None]
        )

    field_inputs = []
    fixed_fields = []
    options_by_field_id: dict[str, tuple[YearlyRotationOption, ...]] = {}
    for field in fields:
        check_deadline()
        field_candidates_row = candidates_by_field_id.get(field.id)
        base_candidates = field_candidates_row.candidates if field_candidates_row else []

        if field.allowed_rotation_ids:
            fixed = _locked_yearly_field_contribution(
                field, base_candidates, with_udnyttet_n=n_ceiling is not None
            )
            if fixed is None:
                raise OptimizationInfeasibleError(
                    f"Marken {field.name} er låst til en sædskiftekandidat, der ikke "
                    "længere findes — lås marken op og lås den igen."
                )
            fixed_fields.append(fixed)
            continue

        jbnr = field_candidates_row.jbnr if field_candidates_row else 0
        real_history = field_candidates_row.real_history if field_candidates_row else None
        soil_data = soil_data_by_imk_id.get(field.imk_id)
        percolation, org_n_topsoil, s_soil = (
            soil_data if soil_data is not None else (None, None, None)
        )
        options = _expand_yearly_options(
            field,
            base_candidates,
            jbnr=jbnr,
            godning=simulation.godning,
            fdato=simulation.eea_fdato,
            precision_dagsbasis=simulation.eea_precision_dagsbasis,
            praecisionsjordbrug=simulation.praecisionsjordbrug,
            tidlig_saaning=simulation.tidlig_saaning,
            mellemafgrode=simulation.mellemafgrode,
            excluded_afgrodekoder=excluded_afgrodekoder,
            real_history=real_history,
            percolation_by_kategori=percolation,
            org_n_topsoil=org_n_topsoil,
            s_soil=s_soil,
            economics_key=simulation.economics_snapshot.overrides.cache_key(),
        )
        if not options:
            raise OptimizationInfeasibleError(
                f"Marken {field.name} har ingen beregnede sædskifte-kandidater tilbage — "
                "genopret scenariet med mindst én kategori og N-norm%, eller fravælg "
                "færre afgrøder."
            )
        options_by_field_id[field.id] = options
        field_inputs.append(
            YearlyFieldInput(
                id=field.id,
                area_ha=field.area_ha,
                kystvand_id=field.kystvand_id,
                options=options,
                kvotegivende=field.kvotegivende,
            )
        )

    max_n_load_by_year = _max_n_load_by_kystvandopland_and_year(
        fields,
        max_n_load_by_kystvandopland,
    )
    return YearlyInputBuild(
        input=YearlyOptimizationInput(
            fields=tuple(field_inputs),
            fixed_fields=tuple(fixed_fields),
            constraints=YearlyConstraintsInput(
                max_n_load_by_kystvandopland_and_year=max_n_load_by_year,
                db2_swing_pct=db2_swing_pct,
                min_fen=simulation.constraints.min_fen,
                max_fen=simulation.constraints.max_fen,
                crop_area_limits=tuple(simulation.constraints.crop_area_limits),
                quota_trades=quota_trades,
                kvote_by_kystvandopland=_kvote_by_kystvandopland(fields),
                max_udnyttet_n_per_harmoni_ha=n_ceiling,
            ),
            time_limit_seconds=time_limit_seconds,
        ),
        fields=tuple(fields),
        options_by_field_id=options_by_field_id,
        candidates_by_field_id=candidates_by_field_id,
    )


@with_snapshot_rotations
def run_yearly_optimization(
    farm_id: str,
    simulation_id: str,
    time_limit_seconds: float,
    max_n_load_by_kystvandopland: dict[int | None, tuple[float | None, ...]],
    db2_swing_pct: float | None,
    excluded_afgrodekoder: frozenset[int],
    email: str,
    snapshot,
    quota_trades: tuple[QuotaTradeSetting, ...] = (),
) -> YearlyOptimizationRunResult:
    """Run Phase 11 "Års-optimering" with annual rotation shifting.

    This works like run_optimization but also lets the solver choose how far
    each mark's sædskifte is shifted (start_year), allowing it to satisfy
    calendar-year udledning caps and a limit on total DB2 fluctuation between
    years. Winning candidates are stored as manual candidates following the
    apply_manual_rotation pattern, but do not lock the mark. A later regular
    "Optimér" or "Års-optimering" run may overwrite the result.

    Every remaining candidate can be shifted; see _expand_yearly_options.
    """
    built = build_yearly_input(
        farm_id,
        simulation_id,
        time_limit_seconds,
        max_n_load_by_kystvandopland,
        db2_swing_pct,
        excluded_afgrodekoder,
        email,
        snapshot=snapshot,
        quota_trades=quota_trades,
    )
    fields = list(built.fields)
    options_by_field_id = built.options_by_field_id
    candidates_by_field_id = built.candidates_by_field_id
    field_inputs = list(built.input.fields)
    fixed_fields = list(built.input.fixed_fields)
    n_ceiling = built.input.constraints.max_udnyttet_n_per_harmoni_ha
    names = _kystvand_names(farm_id, email) if quota_trades else {}
    _validate_quota_trades(fields, quota_trades, names)
    output = solve_yearly(
        input=replace(built.input, time_limit_seconds=solver_time_limit(time_limit_seconds))
    )

    if output.status == "INFEASIBLE":
        traded = {trade.kystvand_id for trade in quota_trades}
        error = _quota_shortfall_error(
            farm_id,
            email,
            _lowest_n_load_by_kystvandopland_and_year(field_inputs, fixed_fields),
            {
                (kystvand_id, year): cap
                for kystvand_id, caps in (
                    built.input.constraints.max_n_load_by_kystvandopland_and_year.items()
                )
                # A traded opland can buy what it lacks, so it never falls short.
                if kystvand_id not in traded
                for year, cap in enumerate(caps)
            },
        )
        if error is None and n_ceiling is not None:
            error = _n_ceiling_shortfall_error(
                n_ceiling, _lowest_udnyttet_n_per_harmoni_ha_by_year(field_inputs, fixed_fields)
            )
        raise error or OptimizationInfeasibleError(
            "Ingen sædskifte-fordeling kan opfylde de gemte krav — lempe krav som "
            "maks. udledning eller foderenheder og prøv igen."
        )

    if output.status == "UNKNOWN":
        raise OptimizationUnknownError(
            "Optimeringen fandt ikke en løsning inden for tidsgrænsen — prøv at lempe kravene."
        )

    updated_by_id = {}
    selected = {}
    for assignment in output.assignments:
        winning_option = next(
            option
            for option in options_by_field_id[assignment.field_id]
            if option.id == assignment.rotation_id
        )
        selected[assignment.field_id] = winning_option.candidate
        field = next(field for field in fields if field.id == assignment.field_id)
        updated_by_id[field.id] = _assigned_field(field, assignment)
    result_fields = tuple(updated_by_id.get(field.id, field) for field in fields)
    for field in result_fields:
        if field.id not in selected and field.rotation_id:
            row = candidates_by_field_id.get(field.id)
            if row:
                candidate = next(
                    (c for c in row.candidates if c.ref.to_id() == field.rotation_id), None
                )
                if candidate:
                    selected[field.id] = candidate
    return YearlyOptimizationRunResult(
        output=output,
        fields=result_fields,
        selected_candidates=selected,
        quota_trades=tuple(
            SimulationQuotaTrade(
                kystvand_id=trade.kystvand_id,
                kystvand_navn=names.get(trade.kystvand_id),
                trade_kg_by_year={
                    candidate_evaluator.START_CALENDAR_YEAR + y: kg
                    for y, kg in enumerate(output.quota_trades[trade.kystvand_id])
                },
                buy_price_kr_per_kg=trade.buy_price_kr_per_kg,
                sell_price_kr_per_kg=trade.sell_price_kr_per_kg,
                same_each_year=trade.same_each_year,
                payment_kr_per_year=sum(
                    kg * (trade.buy_price_kr_per_kg if kg >= 0 else trade.sell_price_kr_per_kg)
                    for kg in output.quota_trades[trade.kystvand_id]
                )
                / NUM_YEARS,
            )
            for trade in quota_trades
        ),
    )
