"""Kvotehandel: the value of buying or selling N kvote, per kystvandopland."""

import math
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from app.domain.base import CamelModel
from app.domain.optimization import ResultError
from app.domain.rotation_candidate import RotationCandidateRef, RotationPositionOverride
from app.domain.simulation import Simulation

QuotaValueStatus = Literal["not_started", "queued", "in_progress", "completed", "failed"]
QuotaPointStatus = Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN"]

# A chosen range may ask for at most this many trades besides no trade; each is
# a solve, and the whole curve must finish within one job.
MAX_RANGE_TRADES = 40
MAX_RANGE_KG = 100_000


class QuotaTradeRange(CamelModel):
    """The trades to solve instead of the default window ("interval for handel").

    Trades are laid out from no trade in steps of step_kg, so they line up with
    0, and the ends of the range are always included. The same range applies to
    every opland.
    """

    min_kg: float = Field(ge=-MAX_RANGE_KG, le=MAX_RANGE_KG)
    max_kg: float = Field(ge=-MAX_RANGE_KG, le=MAX_RANGE_KG)
    step_kg: float = Field(gt=0, le=MAX_RANGE_KG)

    @model_validator(mode="after")
    def _check(self):
        if self.min_kg >= self.max_kg:
            raise ValueError("Intervallets start skal være mindre end dets slutning.")
        # (max - min) / step bounds the count, so a tiny step is rejected before
        # its trades are listed.
        too_many = ValueError(
            f"Intervallet giver mere end {MAX_RANGE_TRADES} handler. "
            "Vælg en større afstand eller et mindre interval."
        )
        if (self.max_kg - self.min_kg) / self.step_kg > MAX_RANGE_TRADES + 1:
            raise too_many
        if len(self.trades()) > MAX_RANGE_TRADES:
            raise too_many
        return self

    def trades(self) -> list[float]:
        """Every trade in the range except no trade, ascending."""
        first = math.ceil(self.min_kg / self.step_kg - 1e-9)
        last = math.floor(self.max_kg / self.step_kg + 1e-9)
        steps = {round(k * self.step_kg, 6) for k in range(first, last + 1)}
        return sorted(t for t in steps | {self.min_kg, self.max_kg} if t != 0)


class QuotaValueRequest(CamelModel):
    expected_revision: int = Field(ge=0)
    run_id: UUID
    # The price the gains are compared at: it decides which points are solved
    # again more precisely, and the interaction check between oplande. The
    # frontend can still apply any price to the curve afterwards.
    price_kr_per_kg: float = Field(ge=0, le=10_000)
    # None solves the default window around the no-trade cap.
    trade_range: QuotaTradeRange | None = None


class QuotaFieldChange(CamelModel):
    field_id: str
    field_name: str
    from_rotation_id: str
    to_rotation_id: str
    from_crops: list[str]
    to_crops: list[str]


class QuotaFieldRotation(CamelModel):
    """A mark's rotation in a point's plan, in the form "Rediger manuelt" applies."""

    field_id: str
    base_ref: RotationCandidateRef
    overrides: list[RotationPositionOverride] = Field(default_factory=list)
    start_year: int = 1


class QuotaValuePoint(CamelModel):
    # kg N per year added to (positive, bought) or removed from (negative, sold)
    # the opland's cap in every capped year.
    trade_kg: float
    status: QuotaPointStatus
    # Best yearly DB2 with the traded cap, V(t); None when infeasible.
    db2: float | None = None
    # Proven upper bound on V(t): the true best DB2 lies between db2 and this.
    # None when nothing bounds it (infeasible, or a curve saved before bounds).
    db2_upper_bound: float | None = None
    # Set when the solver found nothing better here within its time limit than
    # this smaller trade's solution, which also meets the larger cap (V(t) can
    # only rise with more kvote). The value is then a lower bound.
    solution_from_trade_kg: float | None = None
    n_load_by_year: dict[int, float] = Field(default_factory=dict)
    cap_by_year: dict[int, float | None] = Field(default_factory=dict)
    feed_units_by_year: dict[int, float] = Field(default_factory=dict)
    changed_fields: list[QuotaFieldChange] = Field(default_factory=list)
    # Every mark's rotation in this point's plan, to create it as a simulering;
    # empty when infeasible or in curves computed before this was stored.
    rotations: list[QuotaFieldRotation] = Field(default_factory=list)


class QuotaValueCurve(CamelModel):
    kystvand_id: int
    base_cap_by_year: dict[int, float | None]
    unconstrained_trade_kg: float
    points: list[QuotaValuePoint]


class QuotaValueInteraction(CamelModel):
    price_kr_per_kg: float
    trades_kg: dict[int, float]
    separate_gain: float
    combined_status: QuotaPointStatus
    combined_gain: float | None = None


class QuotaValueOutput(CamelModel):
    base_db2: float
    base_feed_units_by_year: dict[int, float]
    min_fen: float | None = None
    max_fen: float | None = None
    curves: list[QuotaValueCurve]
    interaction: QuotaValueInteraction | None = None


QuotaProgressStepKey = Literal[
    "base", "uncapped", "buying", "selling", "selling_limit", "refinement", "interaction"
]
QuotaProgressStepState = Literal["pending", "running", "done", "skipped"]


class QuotaProgressStep(CamelModel):
    """One step of a running curve, in the order the steps are solved."""

    key: QuotaProgressStepKey
    # The opland the step belongs to; None for steps shared by all of them.
    kystvand_id: int | None = None
    state: QuotaProgressStepState = "pending"
    done: int = 0
    # Solves the step needs; None while that is not yet known.
    total: int | None = None


class QuotaValueResult(CamelModel):
    status: QuotaValueStatus = "not_started"
    run_id: str | None = None
    # The completed "Års-optimering" run the curve was computed from.
    base_run_id: str | None = None
    input_revision: int | None = None
    # The scenarie or its optimization changed after the curve was computed.
    outdated: bool = False
    price_kr_per_kg: float | None = None
    # The chosen range the curve was computed for; None for the default window.
    trade_range: QuotaTradeRange | None = None
    queued_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: ResultError | None = None
    output: QuotaValueOutput | None = None
    # Steps of a queued or running curve; None before the first one starts.
    progress: list[QuotaProgressStep] | None = None


class QuotaTradeSimulationRequest(CamelModel):
    """Create one point of a curve as its own simulering ("Opret som simulering")."""

    kystvand_id: int
    trade_kg: float
    name: str = Field(min_length=1, max_length=200)
    # The price the trade was chosen at, kept on the simulering with the trade.
    price_kr_per_kg: float = Field(ge=0, le=10_000)
    kystvand_navn: str | None = Field(default=None, max_length=200)


class QuotaTradeSimulationResponse(CamelModel):
    # Its saved settings are the curve's Års-optimering with the traded caps, so
    # the caller starts that run on it as on any other simulering.
    simulation: Simulation
    # Marker that could not be given the plan's rotation; a normal run decides
    # theirs.
    unmatched_fields: list[str] = Field(default_factory=list)
