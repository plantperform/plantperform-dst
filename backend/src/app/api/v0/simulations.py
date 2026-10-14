from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import Field
from starlette.status import HTTP_204_NO_CONTENT

from app.api.v0.rotation_candidates import AfgrodeKodeOption
from app.auth import AuthenticatedUser, current_user
from app.data import economics_recalculation_store
from app.data.read_model_store import (
    get_simulation_view,
    require_simulation_view_ready,
    simulation_part,
)
from app.data.repository import (
    FieldNotOptimizedError,
    delete_simulation,
    get_simulation,
    get_simulation_field,
    get_simulation_field_candidate_detail,
    get_simulation_field_context,
    list_scenario_afgrodekoder,
    list_simulation_fields,
    list_simulations,
    update_simulation_constraints,
    update_simulation_field,
)
from app.data.simulation_store import SetupRevisionConflictError, get_result
from app.domain.base import CamelModel
from app.domain.creation import (
    CreationConflictError,
    CreationNotReadyError,
    CreationQueueUnavailableError,
    RetrySimulationCreationRequest,
)
from app.domain.economics import (
    EconomicsConflictError,
    EconomicsModuleNotFoundError,
    RecalculateEconomicsRequest,
    SelectEconomicsRequest,
)
from app.domain.field import FieldRecord, UpdateFieldRequest
from app.domain.optimization import (
    OptimizeSimulationRequest,
    SimulationResult,
    YearlyOptimizeSimulationRequest,
)
from app.domain.read_model import SimulationView
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    RotationPositionOverride,
)
from app.domain.simulation import (
    CreateSimulationRequest,
    OptimizationConstraints,
    Simulation,
    UpdateSimulationRequest,
)
from app.services.creation.jobs import retry as retry_creation
from app.services.creation.jobs import submit as submit_creation
from app.services.economics import jobs as economics_jobs
from app.services.optimization.jobs import (
    QueueUnavailableError,
    SimulationNotFoundError,
    SubmissionConflictError,
    submit,
)
from app.services.rotations import afgroede_normer
from app.services.scenario.candidate_evaluator import (
    evaluate_with_overrides,
)
from app.services.scenario.rotations import (
    ManualRotationNotFoundError,
    apply_manual_rotation,
)

NUM_ROTATION_YEARS = 8

CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]


def require_completed_creation(request: Request, user: CurrentUser):
    simulation_id = request.path_params.get("simulation_id")
    path = request.scope["route"].path
    if (
        simulation_id is None
        or (request.method in ("GET", "DELETE") and path.endswith("/{simulation_id}"))
        or path.endswith("/result")
        or path.endswith("/creation/retry")
        or path.endswith("/economics")
        or path.endswith("/economics/recalculate")
        or path.endswith("/economics/recalculate/retry")
        or path.endswith("/view")
        or path.endswith("/optimize")
        or path.endswith("/optimize-yearly")
        or (request.method == "PATCH" and path.endswith("/{simulation_id}"))
    ):
        return
    simulation = get_simulation(request.path_params["farm_id"], simulation_id, user.email)
    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")
    if simulation.creation_status != "done":
        raise HTTPException(
            status_code=409, detail="Simuleringen er ikke færdig med at blive oprettet."
        )
    if request.method not in ("GET", "DELETE"):
        require_simulation_view_ready(simulation_id, simulation.revision)


router = APIRouter(
    prefix="/farms/{farm_id}/simulations",
    tags=["simulations"],
    dependencies=[Depends(require_completed_creation)],
)


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


@router.post("", response_model=Simulation, status_code=201)
def post_farm_simulation(
    farm_id: str,
    request: CreateSimulationRequest,
    user: CurrentUser,
) -> Simulation:
    try:
        simulation = submit_creation(farm_id, request, user.email)
    except EconomicsModuleNotFoundError as error:
        raise HTTPException(status_code=404, detail="Economics module not found") from error
    except CreationConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except CreationQueueUnavailableError as error:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "QUEUE_UNAVAILABLE",
                "message": str(error),
                "simulationId": error.simulation_id,
            },
        ) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    if simulation is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    return simulation


@router.patch("/{simulation_id}", response_model=Simulation)
def patch_farm_simulation(
    farm_id: str, simulation_id: str, request: UpdateSimulationRequest, user: CurrentUser
):
    from app.data.simulation_settings_store import update_settings

    try:
        simulation = update_settings(farm_id, simulation_id, request, user.email)
    except (SetupRevisionConflictError, CreationNotReadyError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except EconomicsModuleNotFoundError as error:
        raise HTTPException(status_code=404, detail="Economics module not found") from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")
    return simulation


@router.post("/{simulation_id}/creation/retry", response_model=Simulation, status_code=200)
def post_farm_simulation_creation_retry(
    farm_id: str,
    simulation_id: str,
    user: CurrentUser,
    request: RetrySimulationCreationRequest | None = None,
) -> Simulation:
    try:
        simulation = retry_creation(
            farm_id,
            simulation_id,
            user.email,
            optimize_on_create=request.optimize_on_create if request is not None else False,
        )
    except CreationConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except CreationQueueUnavailableError as error:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "QUEUE_UNAVAILABLE",
                "message": str(error),
                "simulationId": error.simulation_id,
            },
        ) from error
    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")
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


@router.get("/{simulation_id}/view", response_model=SimulationView)
def get_simulation_display(
    farm_id: str,
    simulation_id: str,
    user: CurrentUser,
    include_data: bool = True,
):
    view = get_simulation_view(farm_id, simulation_id, user.email, include_data=include_data)
    if view is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")
    return view


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
    except (CreationNotReadyError, SetupRevisionConflictError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
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


class CropAreaRangeResponse(CamelModel):
    afgrode_kode: int
    min_average_ha: float
    max_average_ha: float
    min_ha_by_year: list[float]
    max_ha_by_year: list[float]
    yearly_max_average_ha: float


@router.get("/{simulation_id}/crop-area-ranges", response_model=list[CropAreaRangeResponse])
def get_farm_simulation_crop_area_ranges(
    farm_id: str,
    simulation_id: str,
    user: CurrentUser,
) -> list[CropAreaRangeResponse]:
    ranges = simulation_part(farm_id, simulation_id, user.email, "crop_area_ranges")
    if ranges is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")
    return [CropAreaRangeResponse.model_validate(value) for value in ranges]


def _submit_optimization(farm_id, simulation_id, user, kind, request, background_tasks):
    try:
        return submit(
            farm_id, simulation_id, user.email, kind, request, background_tasks=background_tasks
        )
    except SimulationNotFoundError as error:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet") from error
    except (SubmissionConflictError, CreationNotReadyError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except QueueUnavailableError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.post("/{simulation_id}/optimize", response_model=SimulationResult, status_code=202)
def post_farm_simulation_optimization(
    farm_id: str,
    simulation_id: str,
    user: CurrentUser,
    request: OptimizeSimulationRequest,
    background_tasks: BackgroundTasks,
) -> SimulationResult:
    return _submit_optimization(farm_id, simulation_id, user, "optimize", request, background_tasks)


@router.post("/{simulation_id}/optimize-yearly", response_model=SimulationResult, status_code=202)
def post_farm_simulation_yearly_optimization(
    farm_id: str,
    simulation_id: str,
    user: CurrentUser,
    request: YearlyOptimizeSimulationRequest,
    background_tasks: BackgroundTasks,
) -> SimulationResult:
    return _submit_optimization(farm_id, simulation_id, user, "yearly", request, background_tasks)


@router.get("/{simulation_id}/result", response_model=SimulationResult)
def get_farm_simulation_result(
    farm_id: str, simulation_id: str, user: CurrentUser, include_output: bool = True
):
    result = get_result(farm_id, simulation_id, user.email, include_output=include_output)
    if result is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")
    return result


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
    from app.services.scenario.options import catalog

    simulation = get_simulation(farm_id, simulation_id, user.email)
    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")
    return [YearlyOptimizationKategoriOption.model_validate(value) for value in catalog(simulation)]


@router.get("/{simulation_id}/fields", response_model=list[FieldRecord])
def get_farm_simulation_fields(
    farm_id: str,
    simulation_id: str,
    user: CurrentUser,
) -> list[FieldRecord]:
    try:
        fields = list_simulation_fields(farm_id, simulation_id, user.email)
    except CreationNotReadyError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
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
    try:
        field = update_simulation_field(farm_id, simulation_id, field_id, request, user.email)
    except (CreationNotReadyError, SetupRevisionConflictError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error

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
    except (CreationNotReadyError, SetupRevisionConflictError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except FieldNotOptimizedError as error:
        raise HTTPException(
            status_code=422,
            detail="Marken er ikke optimeret endnu",
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

    try:
        candidates_row = get_simulation_field_context(
            farm_id,
            simulation_id,
            field_id,
            user.email,
        )
        if candidates_row is None:
            raise HTTPException(status_code=404, detail="Mark ikke fundet")
        field = get_simulation_field(farm_id, simulation_id, field_id, user.email)
    except (CreationNotReadyError, SetupRevisionConflictError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    if field is None:
        raise HTTPException(status_code=404, detail="Mark ikke fundet")
    soil_data = candidates_row.soil_data
    percolation, org_n_topsoil, s_soil = soil_data if soil_data is not None else (None, None, None)

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
        economics_key=simulation.economics_snapshot.overrides.cache_key(),
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
            farm_id,
            simulation_id,
            field_id,
            request.base_ref,
            request.overrides,
            user.email,
            request.start_year,
        )
    except (SetupRevisionConflictError, CreationNotReadyError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
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
    summary = simulation_part(farm_id, simulation_id, user.email, "yearly_summary")
    if summary is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")
    return [YearlySummaryEntryResponse.model_validate(value) for value in summary]


def _economics_action(action, *args):
    try:
        simulation = action(*args)
    except EconomicsModuleNotFoundError as error:
        raise HTTPException(status_code=404, detail="Economics module not found") from error
    except (EconomicsConflictError, CreationNotReadyError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except CreationQueueUnavailableError as error:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "QUEUE_UNAVAILABLE",
                "message": str(error),
                "simulationId": error.simulation_id,
            },
        ) from error
    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return simulation


@router.patch("/{simulation_id}/economics", response_model=Simulation)
def patch_simulation_economics(
    farm_id: str, simulation_id: str, request: SelectEconomicsRequest, user: CurrentUser
):
    return _economics_action(
        economics_recalculation_store.select_module, farm_id, simulation_id, request, user.email
    )


@router.post("/{simulation_id}/economics/recalculate", response_model=Simulation, status_code=200)
def recalculate_simulation_economics(
    farm_id: str,
    simulation_id: str,
    request: RecalculateEconomicsRequest,
    user: CurrentUser,
):
    return _economics_action(economics_jobs.submit, farm_id, simulation_id, request, user.email)


@router.post(
    "/{simulation_id}/economics/recalculate/retry", response_model=Simulation, status_code=200
)
def retry_simulation_economics(farm_id: str, simulation_id: str, user: CurrentUser):
    return _economics_action(economics_jobs.retry, farm_id, simulation_id, user.email)
