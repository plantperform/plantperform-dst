from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from starlette.status import HTTP_204_NO_CONTENT

from app.api.v0.rotation_candidates import AfgrodeKodeOption
from app.auth import AuthenticatedUser, current_user
from app.data.repository import (
    FieldNotOptimizedError,
    create_simulation,
    delete_simulation,
    get_registry_soil_data,
    get_simulation,
    get_simulation_field,
    get_simulation_field_candidate_detail,
    get_simulation_field_candidates,
    list_scenario_afgrodekoder,
    list_simulation_field_candidates,
    list_simulation_fields,
    list_simulations,
    update_simulation_constraints,
    update_simulation_field,
)
from app.domain.base import CamelModel
from app.domain.field import FieldRecord, UpdateFieldRequest
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    RotationPositionOverride,
)
from app.domain.simulation import (
    CreateSimulationRequest,
    OptimizationConstraints,
    Simulation,
)
from app.services.optimization.orchestrator import (
    ManualRotationNotFoundError,
    OptimizationInfeasibleError,
    OptimizationNotFoundError,
    OptimizationUnknownError,
    apply_manual_rotation,
    compute_yearly_summary,
    run_optimization,
    run_yearly_optimization,
)
from app.services.rotations import afgroede_normer, saedskifte_kategorier
from app.services.scenario.candidate_evaluator import (
    START_CALENDAR_YEAR,
    evaluate_with_overrides,
)

NUM_ROTATION_YEARS = 8

router = APIRouter(prefix="/farms/{farm_id}/simulations", tags=["simulations"])
CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]


class OptimizeSimulationRequest(CamelModel):
    time_limit_seconds: float = Field(default=15, gt=0, le=600)
    excluded_afgrodekoder: list[int] = Field(default_factory=list)


class RotationAssignmentResponse(CamelModel):
    field_id: str
    rotation_id: str


class OptimizeSimulationResponse(CamelModel):
    status: Literal["OPTIMAL", "FEASIBLE"]
    objective_db2: float
    total_n_load_kg: float
    total_leaching_kg: float
    total_fen: float
    fields: list[FieldRecord]
    assignments: list[RotationAssignmentResponse]


class YearlySummaryEntryResponse(CamelModel):
    year: int
    total_n_load_kg: float
    total_db2: float
    total_fen: float
    field_count: int


@router.get("", response_model=list[Simulation])
def get_farm_simulations(
    farm_id: str,
    user: CurrentUser,
) -> list[Simulation]:
    simulations = list_simulations(farm_id, user.email)

    if simulations is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    return simulations


@router.post("", response_model=Simulation)
def post_farm_simulation(
    farm_id: str,
    request: CreateSimulationRequest,
    user: CurrentUser,
) -> Simulation:
    simulation = create_simulation(farm_id, request, user.email)

    if simulation is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    return simulation


@router.get("/{simulation_id}", response_model=Simulation)
def get_farm_simulation(
    farm_id: str,
    simulation_id: str,
    user: CurrentUser,
) -> Simulation:
    simulation = get_simulation(farm_id, simulation_id, user.email)

    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")

    return simulation


@router.delete("/{simulation_id}", status_code=HTTP_204_NO_CONTENT)
def delete_farm_simulation(
    farm_id: str,
    simulation_id: str,
    user: CurrentUser,
) -> None:
    deleted = delete_simulation(farm_id, simulation_id, user.email)

    if deleted is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    if not deleted:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")


@router.patch("/{simulation_id}/constraints", response_model=Simulation)
def patch_farm_simulation_constraints(
    farm_id: str,
    simulation_id: str,
    request: OptimizationConstraints,
    user: CurrentUser,
) -> Simulation:
    try:
        simulation = update_simulation_constraints(farm_id, simulation_id, request, user.email)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")

    return simulation


@router.get("/{simulation_id}/afgroder-i-brug", response_model=list[AfgrodeKodeOption])
def get_farm_simulation_afgroder_i_brug(
    farm_id: str,
    simulation_id: str,
    user: CurrentUser,
) -> list[AfgrodeKodeOption]:
    codes = list_scenario_afgrodekoder(farm_id, simulation_id, user.email)
    if codes is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")

    return sorted(
        (
            AfgrodeKodeOption(
                code=code,
                navn=afgroede_normer.lookup_crop_params(code).get("navn", str(code)),
            )
            for code in codes
        ),
        key=lambda option: option.navn,
    )


@router.post("/{simulation_id}/optimize", response_model=OptimizeSimulationResponse)
def post_farm_simulation_optimization(
    farm_id: str,
    simulation_id: str,
    user: CurrentUser,
    request: OptimizeSimulationRequest | None = None,
) -> OptimizeSimulationResponse:
    optimization_request = request or OptimizeSimulationRequest()

    try:
        result = run_optimization(
            farm_id,
            simulation_id,
            optimization_request.time_limit_seconds,
            frozenset(optimization_request.excluded_afgrodekoder),
            user.email,
        )
    except OptimizationNotFoundError as error:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet") from error
    except OptimizationInfeasibleError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except OptimizationUnknownError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    return OptimizeSimulationResponse(
        status=result.output.status,
        objective_db2=result.output.total_db2,
        total_n_load_kg=result.output.total_n_load_kg,
        total_leaching_kg=result.output.total_leaching_kg,
        total_fen=result.output.total_fen,
        fields=list(result.fields),
        assignments=[
            RotationAssignmentResponse(
                field_id=assignment.field_id,
                rotation_id=assignment.rotation_id,
            )
            for assignment in result.output.assignments
        ],
    )


class KystvandoplandYearlyNLoadCaps(CamelModel):
    """Per-calendar-year udledning caps for one kystvandopland.

    Each kystvandopland containing the scenarie's marker can be configured
    independently, with its own "same for all years"/"per year" UI state. See
    KystvandoplandNLoadCap for why oplande must not be combined.
    """

    kystvand_id: int | None = None
    max_n_load_by_year: dict[int, float] = Field(default_factory=dict)


class YearlyOptimizeSimulationRequest(CamelModel):
    time_limit_seconds: float = Field(default=20, gt=0, le=600)
    max_n_load_by_kystvandopland: list[KystvandoplandYearlyNLoadCaps] = Field(default_factory=list)
    db2_swing_pct: float | None = Field(default=None, ge=0)
    excluded_afgrodekoder: list[int] = Field(default_factory=list)


class YearlyOptimizeSimulationResponse(CamelModel):
    status: Literal["OPTIMAL", "FEASIBLE"]
    objective_db2: float
    total_n_load_kg: float
    total_leaching_kg: float
    total_fen: float
    total_db2_by_year: dict[int, float]
    total_n_load_by_year: dict[int, float]
    fields: list[FieldRecord]
    assignments: list[RotationAssignmentResponse]


@router.post("/{simulation_id}/optimize-yearly", response_model=YearlyOptimizeSimulationResponse)
def post_farm_simulation_yearly_optimization(
    farm_id: str,
    simulation_id: str,
    user: CurrentUser,
    request: YearlyOptimizeSimulationRequest | None = None,
) -> YearlyOptimizeSimulationResponse:
    """"Års-optimering" (Phase 11) works like /optimize but uses per-calendar-
    year udledning caps and a DB fluctuation limit instead of scenarie totals.
    The solver chooses how far to offset each mark's sædskifte.
    """
    optimization_request = request or YearlyOptimizeSimulationRequest()
    max_n_load_by_kystvandopland = {
        cap.kystvand_id: tuple(
            cap.max_n_load_by_year.get(START_CALENDAR_YEAR + i)
            for i in range(NUM_ROTATION_YEARS)
        )
        for cap in optimization_request.max_n_load_by_kystvandopland
    }
    try:
        result = run_yearly_optimization(
            farm_id,
            simulation_id,
            optimization_request.time_limit_seconds,
            max_n_load_by_kystvandopland,
            optimization_request.db2_swing_pct,
            frozenset(optimization_request.excluded_afgrodekoder),
            user.email,
        )
    except OptimizationNotFoundError as error:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet") from error
    except OptimizationInfeasibleError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except OptimizationUnknownError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    return YearlyOptimizeSimulationResponse(
        status=result.output.status,
        objective_db2=result.output.total_db2,
        total_n_load_kg=result.output.total_n_load_kg,
        total_leaching_kg=result.output.total_leaching_kg,
        total_fen=result.output.total_fen,
        total_db2_by_year={
            START_CALENDAR_YEAR + i: value
            for i, value in enumerate(result.output.total_db2_by_year)
        },
        total_n_load_by_year={
            START_CALENDAR_YEAR + i: value
            for i, value in enumerate(result.output.total_n_load_by_year)
        },
        fields=list(result.fields),
        assignments=[
            RotationAssignmentResponse(
                field_id=assignment.field_id,
                rotation_id=assignment.rotation_id,
            )
            for assignment in result.output.assignments
        ],
    )


class YearlyOptimizationSaedskifteOption(CamelModel):
    saedskiftevariant: str
    variant: str
    crop_sequence: list[str]
    active_len: int


class YearlyOptimizationKategoriOption(CamelModel):
    kategori: str
    saedskifter: list[YearlyOptimizationSaedskifteOption]


@router.get(
    "/{simulation_id}/yearly-optimization-candidates",
    response_model=list[YearlyOptimizationKategoriOption],
)
def get_farm_simulation_yearly_optimization_candidates(
    farm_id: str,
    simulation_id: str,
    user: CurrentUser,
) -> list[YearlyOptimizationKategoriOption]:
    """Return the (saedskiftevariant, variant) pairs stored for the marker.

    These Phase 12 options come from "Opret scenarie" and populate the explicit
    sædskifte selector in "Års-optimering". Only real library references are
    shown (base_ref is None); "+manuel" variants left by earlier Phase 10/11
    runs are filtered out using the same pattern as _expand_yearly_options.
    """
    field_candidates = list_simulation_field_candidates(farm_id, simulation_id, user.email)
    if field_candidates is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")

    by_pair: dict[tuple[str, str], RotationCandidateEvaluation] = {}
    for row in field_candidates:
        for candidate in row.candidates:
            if candidate.base_ref is not None:
                continue
            pair = (candidate.ref.saedskiftevariant, candidate.ref.variant)
            by_pair.setdefault(pair, candidate)

    # Categories are normally mutually exclusive for a saedskiftevariant. The
    # exception is "ren brak" (saedskiftevariant "1"), which belongs to every
    # source-data category (decision 15; four categories as of 2026-09-02,
    # previously six). Without special handling, the brak variants would appear
    # identically, and be marked selected, under every selector category. A
    # "select all" in one small category could then appear to select across all
    # of them. Brak therefore receives its own category.
    BRAK_KATEGORI = "Brak"
    # The brak variant IDs (1-4, possibly more) all repeat the same pure brak
    # throughout. There is no virkemiddel or afgrøde difference between them,
    # only different internal norm-group IDs that do not matter here. Show one
    # representative example rather than one per variant ID.
    seen_brak_sequences: set[tuple[str, ...]] = set()

    by_kategori: dict[str, list[YearlyOptimizationSaedskifteOption]] = {}
    for (saedskiftevariant, variant), candidate in by_pair.items():
        crop_sequence = [
            y.year.afgrode_navn for y in candidate.years[: candidate.active_len]
        ]
        option = YearlyOptimizationSaedskifteOption(
            saedskiftevariant=saedskiftevariant,
            variant=variant,
            crop_sequence=crop_sequence,
            active_len=candidate.active_len,
        )
        kategorier = saedskifte_kategorier.kategorier_for_saedskifte(saedskiftevariant)
        if len(kategorier) > 1:
            sequence_key = tuple(crop_sequence)
            if sequence_key in seen_brak_sequences:
                continue
            seen_brak_sequences.add(sequence_key)
            by_kategori.setdefault(BRAK_KATEGORI, []).append(option)
        else:
            for kategori in kategorier:
                by_kategori.setdefault(kategori, []).append(option)

    ordered_kategorier = [BRAK_KATEGORI, *saedskifte_kategorier.list_kategorier()]
    return [
        YearlyOptimizationKategoriOption(
            kategori=kategori,
            saedskifter=sorted(
                by_kategori[kategori],
                key=lambda o: (int(o.saedskiftevariant), o.variant),
            ),
        )
        for kategori in ordered_kategorier
        if kategori in by_kategori
    ]


@router.get("/{simulation_id}/fields", response_model=list[FieldRecord])
def get_farm_simulation_fields(
    farm_id: str,
    simulation_id: str,
    user: CurrentUser,
) -> list[FieldRecord]:
    fields = list_simulation_fields(farm_id, simulation_id, user.email)

    if fields is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")

    return fields


@router.patch("/{simulation_id}/fields/{field_id}", response_model=FieldRecord)
def patch_farm_simulation_field(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    request: UpdateFieldRequest,
    user: CurrentUser,
) -> FieldRecord:
    field = update_simulation_field(farm_id, simulation_id, field_id, request, user.email)

    if field is None:
        raise HTTPException(status_code=404, detail="Mark ikke fundet")

    return field


@router.get(
    "/{simulation_id}/fields/{field_id}/candidate-detail",
    response_model=RotationCandidateEvaluation,
)
def get_farm_simulation_field_candidate_detail(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    user: CurrentUser,
) -> RotationCandidateEvaluation:
    try:
        detail = get_simulation_field_candidate_detail(farm_id, simulation_id, field_id, user.email)
    except FieldNotOptimizedError as error:
        raise HTTPException(
            status_code=422, detail="Marken er ikke optimeret endnu",
        ) from error

    if detail is None:
        raise HTTPException(status_code=404, detail="Kandidat-detalje ikke fundet")

    return detail


class RecomputeFieldRotationRequest(CamelModel):
    base_ref: RotationCandidateRef
    overrides: list[RotationPositionOverride] = Field(default_factory=list)
    start_year: int = 1


@router.post(
    "/{simulation_id}/fields/{field_id}/preview-rotation",
    response_model=RotationCandidateEvaluation,
)
def post_farm_simulation_field_preview_rotation(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    request: RecomputeFieldRotationRequest,
    user: CurrentUser,
) -> RotationCandidateEvaluation:
    """Live Phase 10 calculation of a rotation for one mark.

    Recalculates from base_ref plus any single-position overrides without
    storing anything. The "Rediger manuelt" panel uses it to show the result of
    a change before the user selects "Gem".
    """
    simulation = get_simulation(farm_id, simulation_id, user.email)
    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")

    candidates_row = get_simulation_field_candidates(
        farm_id,
        simulation_id,
        field_id,
        user.email,
    )
    if candidates_row is None:
        raise HTTPException(status_code=404, detail="Mark ikke fundet")
    field = get_simulation_field(farm_id, simulation_id, field_id, user.email)
    if field is None:
        raise HTTPException(status_code=404, detail="Mark ikke fundet")
    soil_data = get_registry_soil_data(field.imk_id)
    percolation, org_n_topsoil, s_soil = (
        soil_data if soil_data is not None else (None, None, None)
    )

    godning = simulation.godning
    candidate = evaluate_with_overrides(
        request.base_ref,
        request.overrides,
        jbnr=candidates_row.jbnr,
        driftsform=godning.driftsform,
        org_mineral_n=godning.org_mineral_n,
        mineralsk_andel_pct=godning.mineralsk_andel_pct,
        only_organic=godning.only_organic,
        n_indhold_kg_per_ton=godning.n_indhold_kg_per_ton,
        fdato=simulation.eea_fdato,
        precision_dagsbasis=simulation.eea_precision_dagsbasis,
        praecisionsjordbrug=simulation.praecisionsjordbrug,
        tidlig_saaning=simulation.tidlig_saaning,
        mellemafgrode=simulation.mellemafgrode,
        start_year=request.start_year,
        real_history=candidates_row.real_history,
        percolation_by_kategori=percolation,
        org_n_topsoil=org_n_topsoil,
        s_soil=s_soil,
    )
    if candidate is None:
        raise HTTPException(status_code=422, detail="Rotationen kunne ikke beregnes")

    return candidate


@router.post(
    "/{simulation_id}/fields/{field_id}/apply-rotation",
    response_model=FieldRecord,
)
def post_farm_simulation_field_apply_rotation(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    request: RecomputeFieldRotationRequest,
    user: CurrentUser,
) -> FieldRecord:
    """Store the result of a manual correction.

    Uses the same recalculation as preview-rotation, writes it to the mark as
    Optimér would, and locks the mark to this selection (allowed_rotation_ids)
    until the user unlocks it.
    """
    try:
        field = apply_manual_rotation(
            farm_id, simulation_id, field_id,
            request.base_ref, request.overrides, user.email, request.start_year,
        )
    except ManualRotationNotFoundError as error:
        raise HTTPException(status_code=404, detail="Simulering eller mark ikke fundet") from error

    if field is None:
        raise HTTPException(status_code=422, detail="Rotationen kunne ikke beregnes")

    return field


@router.get(
    "/{simulation_id}/yearly-summary",
    response_model=list[YearlySummaryEntryResponse],
)
def get_farm_simulation_yearly_summary(
    farm_id: str,
    simulation_id: str,
    user: CurrentUser,
) -> list[YearlySummaryEntryResponse]:
    summary = compute_yearly_summary(farm_id, simulation_id, user.email)

    if summary is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")

    return [
        YearlySummaryEntryResponse(
            year=entry.year,
            total_n_load_kg=entry.total_n_load_kg,
            total_db2=entry.total_db2,
            total_fen=entry.total_fen,
            field_count=entry.field_count,
        )
        for entry in summary
    ]
