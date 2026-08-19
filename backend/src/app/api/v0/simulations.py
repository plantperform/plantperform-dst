from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import Field
from starlette.status import HTTP_204_NO_CONTENT

from app.data.repository import (
    FieldNotOptimizedError,
    create_simulation,
    delete_simulation,
    get_simulation,
    get_simulation_field_candidate_detail,
    list_simulation_fields,
    list_simulations,
    update_simulation_constraints,
    update_simulation_field,
)
from app.domain.base import CamelModel
from app.domain.field import FieldRecord, UpdateFieldRequest
from app.domain.rotation_candidate import RotationCandidateEvaluation
from app.domain.simulation import (
    CreateSimulationRequest,
    OptimizationConstraints,
    Simulation,
)
from app.services.optimization.orchestrator import (
    OptimizationInfeasibleError,
    OptimizationNotFoundError,
    OptimizationUnknownError,
    compute_yearly_summary,
    run_optimization,
)

router = APIRouter(prefix="/farms/{farm_id}/simulations", tags=["simulations"])


class OptimizeSimulationRequest(CamelModel):
    time_limit_seconds: float = Field(default=5, gt=0, le=60)


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
async def get_farm_simulations(farm_id: str) -> list[Simulation]:
    simulations = list_simulations(farm_id)

    if simulations is None:
        raise HTTPException(status_code=404, detail="Farm not found")

    return simulations


@router.post("", response_model=Simulation)
async def post_farm_simulation(farm_id: str, request: CreateSimulationRequest) -> Simulation:
    simulation = create_simulation(farm_id, request)

    if simulation is None:
        raise HTTPException(status_code=404, detail="Farm not found")

    return simulation


@router.get("/{simulation_id}", response_model=Simulation)
async def get_farm_simulation(farm_id: str, simulation_id: str) -> Simulation:
    simulation = get_simulation(farm_id, simulation_id)

    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulation not found")

    return simulation


@router.delete("/{simulation_id}", status_code=HTTP_204_NO_CONTENT)
async def delete_farm_simulation(farm_id: str, simulation_id: str) -> None:
    deleted = delete_simulation(farm_id, simulation_id)

    if deleted is None:
        raise HTTPException(status_code=404, detail="Farm not found")

    if not deleted:
        raise HTTPException(status_code=404, detail="Simulation not found")


@router.patch("/{simulation_id}/constraints", response_model=Simulation)
async def patch_farm_simulation_constraints(
    farm_id: str,
    simulation_id: str,
    request: OptimizationConstraints,
) -> Simulation:
    try:
        simulation = update_simulation_constraints(farm_id, simulation_id, request)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulation not found")

    return simulation


@router.post("/{simulation_id}/optimize", response_model=OptimizeSimulationResponse)
async def post_farm_simulation_optimization(
    farm_id: str,
    simulation_id: str,
    request: OptimizeSimulationRequest | None = None,
) -> OptimizeSimulationResponse:
    optimization_request = request or OptimizeSimulationRequest()

    try:
        result = run_optimization(
            farm_id,
            simulation_id,
            optimization_request.time_limit_seconds,
        )
    except OptimizationNotFoundError as error:
        raise HTTPException(status_code=404, detail="Simulation not found") from error
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


@router.get("/{simulation_id}/fields", response_model=list[FieldRecord])
async def get_farm_simulation_fields(farm_id: str, simulation_id: str) -> list[FieldRecord]:
    fields = list_simulation_fields(farm_id, simulation_id)

    if fields is None:
        raise HTTPException(status_code=404, detail="Simulation not found")

    return fields


@router.patch("/{simulation_id}/fields/{field_id}", response_model=FieldRecord)
async def patch_farm_simulation_field(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    request: UpdateFieldRequest,
) -> FieldRecord:
    field = update_simulation_field(farm_id, simulation_id, field_id, request)

    if field is None:
        raise HTTPException(status_code=404, detail="Field not found")

    return field


@router.get(
    "/{simulation_id}/fields/{field_id}/candidate-detail",
    response_model=RotationCandidateEvaluation,
)
async def get_farm_simulation_field_candidate_detail(
    farm_id: str, simulation_id: str, field_id: str,
) -> RotationCandidateEvaluation:
    try:
        detail = get_simulation_field_candidate_detail(farm_id, simulation_id, field_id)
    except FieldNotOptimizedError as error:
        raise HTTPException(
            status_code=422, detail="Field has not been optimized yet",
        ) from error

    if detail is None:
        raise HTTPException(status_code=404, detail="Candidate detail not found")

    return detail


@router.get(
    "/{simulation_id}/yearly-summary",
    response_model=list[YearlySummaryEntryResponse],
)
async def get_farm_simulation_yearly_summary(
    farm_id: str, simulation_id: str,
) -> list[YearlySummaryEntryResponse]:
    summary = compute_yearly_summary(farm_id, simulation_id)

    if summary is None:
        raise HTTPException(status_code=404, detail="Simulation not found")

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
