import math
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from app.domain.base import CamelModel
from app.domain.economics import EconomicsSnapshot
from app.domain.field import FieldRecord
from app.domain.rotation_candidate import RotationCandidateEvaluation

NUM_YEARS = 8
MAX_JOB_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 60
EXECUTION_TIMEOUT_SECONDS = 3600
LEASE_DURATION_SECONDS = 3660

ResultStatus = Literal["not_started", "queued", "in_progress", "completed", "failed", "outdated"]
OptimizationKind = Literal["optimize", "yearly"]


class DeliveryOutcome(StrEnum):
    ACK = "ack"
    RETRY = "retry"
    DEAD_LETTER = "dead_letter"
    INTERRUPTED = "interrupted"


@dataclass(frozen=True)
class ExecutionResult:
    outcome: DeliveryOutcome
    retry_after: int | None = None
    error: dict | None = None


class OptimizationTerminalError(RuntimeError):
    def __init__(self, error):
        self.error = (
            error if isinstance(error, dict) else {"code": "WORKER_ERROR", "message": str(error)}
        )
        super().__init__(self.error["message"])


class OptimizationLeaseActiveError(RuntimeError):
    def __init__(self, expires_at: datetime):
        super().__init__("The optimization run already has an active execution lease")
        self.expires_at = expires_at


class OptimizationAttemptsExhaustedError(OptimizationTerminalError):
    """An exhausted run must be dead-lettered without executing again."""


class OptimizeSimulationRequest(CamelModel):
    expected_revision: int = Field(ge=0)
    run_id: UUID
    excluded_afgrodekoder: list[int] = Field(default_factory=list)


class KystvandoplandYearlyNLoadCaps(CamelModel):
    kystvand_id: int | None = None
    max_n_load_by_year: dict[int, float] = Field(default_factory=dict)


class QuotaTradeSetting(CamelModel):
    """Kvotehandel at a fixed price for one kystvandopland in Års-optimering.

    The run chooses one trade in whole kg N that moves the opland's cap by the
    same amount in every year, and pays price_kr_per_kg for each kg per year.
    """

    kystvand_id: int
    price_kr_per_kg: float = Field(ge=0, allow_inf_nan=False)


class YearlyOptimizeSimulationRequest(OptimizeSimulationRequest):
    max_n_load_by_kystvandopland: list[KystvandoplandYearlyNLoadCaps] = Field(default_factory=list)
    db2_swing_pct: float | None = Field(default=None, ge=0)
    quota_trades: list[QuotaTradeSetting] = Field(default_factory=list)


def untradable_quota_reason(
    caps: KystvandoplandYearlyNLoadCaps | None, has_kvotegivende_marker: bool
) -> str | None:
    """Why an opland cannot trade kvote, or None when it can.

    An opland without saved yearly caps uses its marker's kvote in every year.
    A saved year left out has "Ingen grænse".
    """
    if not has_kvotegivende_marker:
        return "Ingen kvotegivende marker"
    if caps is not None and len(caps.max_n_load_by_year) < NUM_YEARS:
        return "Ikke grænse i alle år"
    return None


class OptimizationSettings(CamelModel):
    kind: OptimizationKind = "optimize"
    excluded_afgrodekoder: list[int] = Field(default_factory=list)
    max_n_load_by_kystvandopland: list[KystvandoplandYearlyNLoadCaps] = Field(default_factory=list)
    db2_swing_pct: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    # Used by Års-optimering only.
    quota_trades: list[QuotaTradeSetting] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_yearly_caps(self):
        for cap in self.max_n_load_by_kystvandopland:
            if any(
                not math.isfinite(value) or value < 0 for value in cap.max_n_load_by_year.values()
            ):
                raise ValueError("Årlige udledningslofter skal være tal på mindst 0")
        return self

    @model_validator(mode="after")
    def validate_quota_trades(self):
        ids = [trade.kystvand_id for trade in self.quota_trades]
        if len(ids) != len(set(ids)):
            raise ValueError("Et kystvandopland kan kun have én kvotehandel")
        caps = {cap.kystvand_id: cap for cap in self.max_n_load_by_kystvandopland}
        for kystvand_id in ids:
            # Marker are only known at run time; the run checks them.
            if untradable_quota_reason(caps.get(kystvand_id), True) is not None:
                raise ValueError(
                    "Kvotehandel kræver en udledningsgrænse i alle år i kystvandoplandet"
                )
        return self


class RotationAssignmentResponse(CamelModel):
    field_id: str
    rotation_id: str


class SimulationQuotaTrade(CamelModel):
    """A kvotehandel a run chose: trade_kg > 0 buys, < 0 sells, in every year."""

    kystvand_id: int
    kystvand_navn: str | None = None
    trade_kg: int
    price_kr_per_kg: float
    # Per year, like objective_db2; negative when the trade sells.
    payment_kr_per_year: float


class OptimizeSimulationResponse(CamelModel):
    status: Literal["OPTIMAL", "FEASIBLE"]
    # The crops' DB2 alone; subtract the quota_trades' payments to include them.
    objective_db2: float
    total_n_load_kg: float
    total_leaching_kg: float
    total_fen: float
    fields: list[FieldRecord]
    assignments: list[RotationAssignmentResponse]
    total_db2_by_year: dict[int, float] = Field(default_factory=dict)
    total_n_load_by_year: dict[int, float] = Field(default_factory=dict)
    quota_trades: list[SimulationQuotaTrade] = Field(default_factory=list)


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
    economics_snapshot: EconomicsSnapshot = Field(default_factory=EconomicsSnapshot)
    parameters: dict = Field(default_factory=dict)
    response: OptimizeSimulationResponse | None = None
    fields_before: list[FieldRecord] = Field(default_factory=list)
    selected_candidates: dict[str, RotationCandidateEvaluation] = Field(default_factory=dict)
