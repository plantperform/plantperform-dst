from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.domain.base import CamelModel
from app.domain.field import FieldRecord
from app.domain.rotation_candidate import RotationCandidateEvaluation

NUM_YEARS = 8
MAX_JOB_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 60
EXECUTION_TIMEOUT_SECONDS = 900
LEASE_DURATION_SECONDS = 960

ResultStatus = Literal["not_started", "queued", "in_progress", "completed", "failed", "outdated"]
OptimizationKind = Literal["optimize", "yearly"]


class OptimizationLeaseActiveError(RuntimeError):
    def __init__(self, expires_at: datetime):
        super().__init__("The optimization run already has an active execution lease")
        self.expires_at = expires_at


class OptimizationAttemptsExhaustedError(RuntimeError):
    """Leave an exhausted SQS delivery unacknowledged for dead-lettering."""


class OptimizeSimulationRequest(CamelModel):
    expected_revision: int = Field(ge=0)
    run_id: UUID
    time_limit_seconds: float = Field(default=15, gt=0, le=600)
    excluded_afgrodekoder: list[int] = Field(default_factory=list)


class KystvandoplandYearlyNLoadCaps(CamelModel):
    kystvand_id: int | None = None
    max_n_load_by_year: dict[int, float] = Field(default_factory=dict)


class YearlyOptimizeSimulationRequest(OptimizeSimulationRequest):
    time_limit_seconds: float = Field(default=20, gt=0, le=600)
    max_n_load_by_kystvandopland: list[KystvandoplandYearlyNLoadCaps] = Field(default_factory=list)
    db2_swing_pct: float | None = Field(default=None, ge=0)


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
    total_db2_by_year: dict[int, float] = Field(default_factory=dict)
    total_n_load_by_year: dict[int, float] = Field(default_factory=dict)


class ResultError(CamelModel):
    code: str
    message: str
    detail: dict | list | str | None = None


class SimulationResultSummary(CamelModel):
    status: ResultStatus = "not_started"
    run_id: str | None = None
    kind: OptimizationKind | None = None
    input_revision: int | None = None
    result_revision: int | None = None
    queued_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: ResultError | None = None


class SimulationResult(SimulationResultSummary):
    parameters: dict = Field(default_factory=dict)
    response: OptimizeSimulationResponse | None = None
    fields_before: list[FieldRecord] = Field(default_factory=list)
    selected_candidates: dict[str, RotationCandidateEvaluation] = Field(default_factory=dict)
