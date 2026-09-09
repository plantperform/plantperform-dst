from dataclasses import dataclass

from app.data import repository
from app.domain.field import FieldRecord, UpdateFieldRequest
from app.domain.optimization import (
    ConstraintsInput,
    FieldInput,
    OptimizationInput,
    OptimizationOutput,
    RotationOption,
    YearlyConstraintsInput,
    YearlyFieldInput,
    YearlyOptimizationInput,
    YearlyOptimizationOutput,
    YearlyRotationOption,
)
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    RotationPositionOverride,
)
from app.domain.simulation import GodningSettings
from app.domain.soil import PercolationByKategori
from app.services.optimization.engine import solve
from app.services.optimization.yearly_engine import solve_yearly
from app.services.scenario import candidate_evaluator


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


@dataclass(frozen=True)
class YearlyOptimizationRunResult:
    output: YearlyOptimizationOutput
    fields: tuple[FieldRecord, ...]


@dataclass(frozen=True)
class YearlySummaryEntry:
    year: int
    total_n_load_kg: float
    total_db2: float
    total_fen: float
    field_count: int


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


def _build_options(
    field: FieldRecord,
    candidates: list[RotationCandidateEvaluation],
    excluded_afgrodekoder: frozenset[int] = frozenset(),
) -> tuple[RotationOption, ...]:
    """Build one RotationOption per stored, invisibly calculated candidate.

    These candidates come from "Opret scenarie". There is no 2^n virkemiddel
    expansion here; decision 7 reserves virkemidler as a future candidate
    facet that has not yet been built.

    If the mark has `allowed_rotation_ids`, for example after Phase 10's
    "Rediger manuelt" locks a manual adjustment to that choice, restrict the
    candidate set to those IDs. "Optimér" then cannot overwrite an intentional
    manual adjustment until the user unlocks it.
    """
    retention_factor = 1 - (field.retention or 0) / 100
    if field.allowed_rotation_ids:
        allowed = set(field.allowed_rotation_ids)
        candidates = [c for c in candidates if c.ref.to_id() in allowed]
    candidates = _exclude_afgrodekoder(candidates, excluded_afgrodekoder)
    options = []
    for candidate in candidates:
        ref_id = candidate.ref.to_id()
        leaching_total = candidate.avg_leaching_kg_n_ha * field.area_ha
        options.append(
            RotationOption(
                key=ref_id,
                id=ref_id,
                years=tuple(y.year for y in candidate.years[: candidate.active_len]),
                db2=candidate.avg_db_kr_ha * field.area_ha,
                n_load=leaching_total * retention_factor,
                leaching=leaching_total,
                fen=candidate.avg_fen * field.area_ha,
            )
        )
    return tuple(options)


def run_optimization(
    farm_id: str,
    simulation_id: str,
    time_limit_seconds: float,
    excluded_afgrodekoder: frozenset[int],
    email: str,
) -> OptimizationRunResult:
    simulation = repository.get_simulation(farm_id, simulation_id, email)
    fields = repository.list_simulation_fields(farm_id, simulation_id, email)
    field_candidates = repository.list_simulation_field_candidates(farm_id, simulation_id, email)

    if simulation is None or fields is None or field_candidates is None:
        raise OptimizationNotFoundError

    if not fields:
        raise OptimizationInfeasibleError("Simuleringen har ingen marker at optimere.")

    candidates_by_field_id = {fc.field_id: fc.candidates for fc in field_candidates}

    field_inputs = []
    for field in fields:
        options = _build_options(
            field, candidates_by_field_id.get(field.id, []), excluded_afgrodekoder,
        )
        if not options:
            raise OptimizationInfeasibleError(
                f"Marken {field.name} har ingen beregnede sædskifte-kandidater tilbage — "
                "genopret scenariet med mindst én kategori og N-norm%, eller fravælg "
                "færre afgrøder."
            )

        field_inputs.append(
            FieldInput(
                id=field.id, area_ha=field.area_ha, kystvand_id=field.kystvand_id, options=options,
            )
        )

    output = solve(
        input=OptimizationInput(
            fields=tuple(field_inputs),
            constraints=ConstraintsInput(
                max_n_load_by_kystvandopland={
                    cap.kystvand_id: cap.max_n_load_kg
                    for cap in simulation.constraints.max_n_load_by_kystvandopland
                    if cap.max_n_load_kg is not None
                },
                min_fen=simulation.constraints.min_fen,
                max_fen=simulation.constraints.max_fen,
            ),
            time_limit_seconds=time_limit_seconds,
        )
    )

    if output.status == "INFEASIBLE":
        raise OptimizationInfeasibleError(
            "Ingen sædskifte-fordeling kan opfylde de gemte krav — lempe krav som "
            "maks. udledning eller foderenheder og prøv igen."
        )

    if output.status == "UNKNOWN":
        raise OptimizationUnknownError(
            "Optimeringen fandt ikke en løsning inden for tidsgrænsen — "
            "prøv en længere tidsgrænse."
        )

    updated_fields = []
    for assignment in output.assignments:
        updated_field = repository.update_simulation_field(
            farm_id,
            simulation_id,
            assignment.field_id,
            UpdateFieldRequest(
                crop_rotation=list(assignment.years),
                rotation_id=assignment.rotation_id,
                db2=assignment.db2,
                n_load=assignment.n_load,
                leaching=assignment.leaching,
                fen=assignment.fen,
            ),
            email,
        )
        if updated_field is None:
            raise OptimizationNotFoundError
        updated_fields.append(updated_field)

    return OptimizationRunResult(output=output, fields=tuple(updated_fields))


class ManualRotationNotFoundError(Exception):
    """The simulering, mark, or its stored candidate set (jbnr source) is missing."""


def apply_manual_rotation(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    base_ref: RotationCandidateRef,
    overrides: list[RotationPositionOverride],
    email: str,
    start_year: int = 1,
) -> FieldRecord | None:
    """Apply a Phase 10 "Rediger manuelt" adjustment to a mark's rotation.

    Recalculate from base_ref plus any single-position overrides, store the
    result as an additional replaceable candidate on the mark, and write it
    back exactly as "Optimér" would, with the same area/retention scaling as
    _build_options. Lock the mark to this choice through allowed_rotation_ids
    so a later "Optimér" run cannot overwrite the manual adjustment until the
    user unlocks it.
    """
    simulation = repository.get_simulation(farm_id, simulation_id, email)
    field = repository.get_simulation_field(farm_id, simulation_id, field_id, email)
    if simulation is None or field is None:
        raise ManualRotationNotFoundError

    candidates_row = repository.get_simulation_field_candidates(
        farm_id,
        simulation_id,
        field_id,
        email,
    )
    if candidates_row is None:
        raise ManualRotationNotFoundError

    godning = simulation.godning
    soil_data = repository.get_registry_soil_data(field.imk_id)
    percolation, org_n_topsoil, s_soil = (
        soil_data if soil_data is not None else (None, None, None)
    )
    candidate = candidate_evaluator.evaluate_with_overrides(
        base_ref, overrides, jbnr=candidates_row.jbnr,
        driftsform=godning.driftsform,
        org_mineral_n=godning.org_mineral_n,
        mineralsk_andel_pct=godning.mineralsk_andel_pct,
        only_organic=godning.only_organic,
        n_indhold_kg_per_ton=godning.n_indhold_kg_per_ton,
        fdato=simulation.eea_fdato, precision_dagsbasis=simulation.eea_precision_dagsbasis,
        praecisionsjordbrug=simulation.praecisionsjordbrug,
        tidlig_saaning=simulation.tidlig_saaning,
        mellemafgrode=simulation.mellemafgrode,
        start_year=start_year,
        real_history=candidates_row.real_history,
        percolation_by_kategori=percolation,
        org_n_topsoil=org_n_topsoil,
        s_soil=s_soil,
    )
    if candidate is None:
        return None

    if not repository.append_manual_field_candidate(
        farm_id,
        simulation_id,
        field_id,
        candidate,
        email,
    ):
        raise ManualRotationNotFoundError

    retention_factor = 1 - (field.retention or 0) / 100
    leaching_total = candidate.avg_leaching_kg_n_ha * field.area_ha
    rotation_id = candidate.ref.to_id()
    return repository.update_simulation_field(
        farm_id, simulation_id, field_id,
        UpdateFieldRequest(
            crop_rotation=[y.year for y in candidate.years[: candidate.active_len]],
            rotation_id=rotation_id,
            db2=candidate.avg_db_kr_ha * field.area_ha,
            n_load=leaching_total * retention_factor,
            leaching=leaching_total,
            fen=candidate.avg_fen * field.area_ha,
            allowed_rotation_ids=[rotation_id],
        ),
        email,
    )


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
) -> tuple[YearlyRotationOption, ...]:
    """Expand each stored candidate to at most active_len shifted variants.

    start_year ranges from 1 through active_len, as in Phase 10's
    evaluate_with_overrides. Phase 11's additional "Års-optimering" decision
    variable uses these variants to shift a mark's sædskifte forward or
    backward to better satisfy annual udledning caps and the DB fluctuation
    limit. The allowed_rotation_ids lock from _build_options still applies: a
    locked mark's candidate set is restricted to its locked candidate before
    shifting.

    Every candidate can be shifted. The run-level afgrøde exclusion filter
    alone determines which candidates are removed entirely.
    """
    retention_factor = 1 - (field.retention or 0) / 100
    if field.allowed_rotation_ids:
        allowed = set(field.allowed_rotation_ids)
        candidates = [c for c in candidates if c.ref.to_id() in allowed]
    candidates = _exclude_afgrodekoder(candidates, excluded_afgrodekoder)

    # A candidate with base_ref and no overrides is a pure shift of another
    # candidate left by an earlier run. Shifting it again would only recreate
    # sequences already covered by its base_ref's shift expansion. Skip it to
    # prevent the candidate set, and thus the CP-SAT model, from growing on
    # every repeated run, but only while base_ref is still present. After the
    # allowed_rotation_ids filter above, a locked mark's only remaining
    # candidate may itself be a pure shift and must then remain to keep the
    # mark solvable. A candidate with actual Phase 10 "Rediger manuelt"
    # overrides is unique and is always retained.
    present_ids = {c.ref.to_id() for c in candidates}
    candidates = [
        c
        for c in candidates
        if c.overrides
        or c.base_ref is None
        or c.base_ref.to_id() not in present_ids
    ]

    options: list[YearlyRotationOption] = []
    for candidate in candidates:
        if candidate.active_len == 0:
            continue

        source_ref = candidate.base_ref or candidate.ref
        for shift in range(1, candidate.active_len + 1):
            variant = (
                candidate
                if shift == 1 and candidate.base_ref is None
                else candidate_evaluator.evaluate_with_overrides(
                    source_ref, candidate.overrides, jbnr=jbnr,
                    driftsform=godning.driftsform,
                    org_mineral_n=godning.org_mineral_n,
                    mineralsk_andel_pct=godning.mineralsk_andel_pct,
                    only_organic=godning.only_organic,
                    n_indhold_kg_per_ton=godning.n_indhold_kg_per_ton,
                    fdato=fdato, precision_dagsbasis=precision_dagsbasis,
                    praecisionsjordbrug=praecisionsjordbrug,
                    tidlig_saaning=tidlig_saaning,
                    mellemafgrode=mellemafgrode,
                    start_year=shift,
                    real_history=real_history,
                    percolation_by_kategori=percolation_by_kategori,
                    org_n_topsoil=org_n_topsoil,
                    s_soil=s_soil,
                )
            )
            if variant is None:
                continue

            db2_by_year = tuple(y.db_kr_ha * field.area_ha for y in variant.years)
            leaching_by_year = tuple(
                y.leaching_kg_n_ha * field.area_ha for y in variant.years
            )
            n_load_by_year = tuple(
                leaching * retention_factor for leaching in leaching_by_year
            )
            ref_id = variant.ref.to_id()
            options.append(
                YearlyRotationOption(
                    key=ref_id,
                    id=ref_id,
                    candidate=variant,
                    years=tuple(y.year for y in variant.years[: variant.active_len]),
                    db2_by_year=db2_by_year,
                    n_load_by_year=n_load_by_year,
                    leaching_by_year=leaching_by_year,
                    fen=variant.avg_fen * field.area_ha,
                )
            )
    return tuple(options)


def run_yearly_optimization(
    farm_id: str,
    simulation_id: str,
    time_limit_seconds: float,
    max_n_load_by_kystvandopland: dict[int | None, tuple[float | None, ...]],
    db2_swing_pct: float | None,
    excluded_afgrodekoder: frozenset[int],
    email: str,
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
    simulation = repository.get_simulation(farm_id, simulation_id, email)
    fields = repository.list_simulation_fields(farm_id, simulation_id, email)
    field_candidates = repository.list_simulation_field_candidates(farm_id, simulation_id, email)

    if simulation is None or fields is None or field_candidates is None:
        raise OptimizationNotFoundError

    if not fields:
        raise OptimizationInfeasibleError("Simuleringen har ingen marker at optimere.")

    candidates_by_field_id = {fc.field_id: fc for fc in field_candidates}
    soil_data_by_imk_id = repository.get_registry_soil_data_batch(
        [field.imk_id for field in fields if field.imk_id is not None]
    )

    field_inputs = []
    options_by_field_id: dict[str, tuple[YearlyRotationOption, ...]] = {}
    for field in fields:
        field_candidates_row = candidates_by_field_id.get(field.id)
        base_candidates = field_candidates_row.candidates if field_candidates_row else []
        jbnr = field_candidates_row.jbnr if field_candidates_row else 0
        real_history = field_candidates_row.real_history if field_candidates_row else None
        soil_data = soil_data_by_imk_id.get(field.imk_id)
        percolation, org_n_topsoil, s_soil = (
            soil_data if soil_data is not None else (None, None, None)
        )
        options = _expand_yearly_options(
            field, base_candidates, jbnr=jbnr, godning=simulation.godning,
            fdato=simulation.eea_fdato, precision_dagsbasis=simulation.eea_precision_dagsbasis,
            praecisionsjordbrug=simulation.praecisionsjordbrug,
            tidlig_saaning=simulation.tidlig_saaning,
            mellemafgrode=simulation.mellemafgrode,
            excluded_afgrodekoder=excluded_afgrodekoder,
            real_history=real_history,
            percolation_by_kategori=percolation,
            org_n_topsoil=org_n_topsoil,
            s_soil=s_soil,
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
                id=field.id, area_ha=field.area_ha, kystvand_id=field.kystvand_id, options=options,
            )
        )

    output = solve_yearly(
        input=YearlyOptimizationInput(
            fields=tuple(field_inputs),
            constraints=YearlyConstraintsInput(
                max_n_load_by_kystvandopland_and_year=max_n_load_by_kystvandopland,
                db2_swing_pct=db2_swing_pct,
                min_fen=simulation.constraints.min_fen,
                max_fen=simulation.constraints.max_fen,
            ),
            time_limit_seconds=time_limit_seconds,
        )
    )

    if output.status == "INFEASIBLE":
        raise OptimizationInfeasibleError(
            "Ingen sædskifte-fordeling kan opfylde de gemte krav — lempe krav som "
            "maks. udledning eller foderenheder og prøv igen."
        )

    if output.status == "UNKNOWN":
        raise OptimizationUnknownError(
            "Optimeringen fandt ikke en løsning inden for tidsgrænsen — "
            "prøv en længere tidsgrænse."
        )

    updated_fields = []
    for assignment in output.assignments:
        winning_option = next(
            option
            for option in options_by_field_id[assignment.field_id]
            if option.id == assignment.rotation_id
        )
        if not repository.append_manual_field_candidate(
            farm_id,
            simulation_id,
            assignment.field_id,
            winning_option.candidate,
            email,
        ):
            raise OptimizationNotFoundError
        updated_field = repository.update_simulation_field(
            farm_id,
            simulation_id,
            assignment.field_id,
            UpdateFieldRequest(
                crop_rotation=list(assignment.years),
                rotation_id=assignment.rotation_id,
                db2=assignment.db2,
                n_load=assignment.n_load,
                leaching=assignment.leaching,
                fen=assignment.fen,
            ),
            email,
        )
        if updated_field is None:
            raise OptimizationNotFoundError
        updated_fields.append(updated_field)

    return YearlyOptimizationRunResult(output=output, fields=tuple(updated_fields))


def compute_yearly_summary(
    farm_id: str,
    simulation_id: str,
    email: str,
) -> tuple[YearlySummaryEntry, ...] | None:
    """Summarize annual udledning, DB2, and foderenheder for optimized marks.

    udledning is retention-corrected. Each year is a position in the individual
    mark's own rotation cycle. The result feeds the "Årsoversigt" strip at the
    top of the Liste-visning. Marker without a winning candidate, which have not yet
    been optimized, do not contribute. Rotations shorter than those of other
    marker contribute only to the years they actually cover; field_count shows
    how many marker have data for each year.
    """
    fields = repository.list_simulation_fields(farm_id, simulation_id, email)
    field_candidates = repository.list_simulation_field_candidates(farm_id, simulation_id, email)
    if fields is None or field_candidates is None:
        return None

    candidates_by_field_id = {fc.field_id: fc.candidates for fc in field_candidates}

    totals: dict[int, dict[str, float]] = {}
    for field in fields:
        if field.rotation_id is None:
            continue
        candidates = candidates_by_field_id.get(field.id, [])
        candidate = next(
            (c for c in candidates if c.ref.to_id() == field.rotation_id), None,
        )
        if candidate is None:
            continue

        retention_factor = 1 - (field.retention or 0) / 100
        for index, year_result in enumerate(candidate.years[: candidate.active_len]):
            bucket = totals.setdefault(
                index + 1, {"n_load": 0.0, "db2": 0.0, "fen": 0.0, "count": 0},
            )
            bucket["n_load"] += year_result.leaching_kg_n_ha * field.area_ha * retention_factor
            bucket["db2"] += year_result.db_kr_ha * field.area_ha
            if year_result.db_detail.get("udbytteenhed") == "FE/ha":
                bucket["fen"] += (year_result.db_detail.get("udbytte") or 0.0) * field.area_ha
            bucket["count"] += 1

    return tuple(
        YearlySummaryEntry(
            year=year,
            total_n_load_kg=data["n_load"],
            total_db2=data["db2"],
            total_fen=data["fen"],
            field_count=int(data["count"]),
        )
        for year, data in sorted(totals.items())
    )
