from dataclasses import dataclass
from typing import Literal

from app.domain.rotation_candidate import RotationCandidateEvaluation, RotationYear

OptimizationStatus = Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN"]


@dataclass(frozen=True)
class RotationOption:
    key: str
    id: str
    years: tuple[RotationYear, ...]
    db2: float
    n_load: float
    leaching: float
    fen: float


@dataclass(frozen=True)
class FieldInput:
    id: str
    area_ha: float
    kystvand_id: int | None
    options: tuple[RotationOption, ...]


@dataclass(frozen=True)
class ConstraintsInput:
    # Udledning cap per kystvandopland (key=kystvand_id, None for marker without
    # an associated opland). The bekendtgørelse calculates udledning per opland,
    # never across oplande; see FarmSidebar's corresponding Aktuel visning. An
    # opland absent here is unlimited. A cap is enforced only for oplande that
    # actually contain marker in this simulering.
    max_n_load_by_kystvandopland: dict[int | None, float]
    min_fen: float | None
    max_fen: float | None


@dataclass(frozen=True)
class OptimizationInput:
    fields: tuple[FieldInput, ...]
    constraints: ConstraintsInput
    time_limit_seconds: float


@dataclass(frozen=True)
class AssignedRotation:
    field_id: str
    rotation_id: str
    years: tuple[RotationYear, ...]
    db2: float
    n_load: float
    leaching: float
    fen: float


@dataclass(frozen=True)
class OptimizationOutput:
    status: OptimizationStatus
    assignments: tuple[AssignedRotation, ...]
    total_db2: float
    total_n_load_kg: float
    total_leaching_kg: float
    total_fen: float


# Phase 11, "Års-optimering": per-calendar-year udledning cap, DB fluctuation
# limit, and automatic rotation offset (start_year) as an additional decision
# variable. This is an additive peer system to RotationOption,
# ConstraintsInput, and solve() above; it does not alter the existing system.

@dataclass(frozen=True)
class YearlyRotationOption:
    key: str
    id: str
    candidate: RotationCandidateEvaluation
    years: tuple[RotationYear, ...]
    db2_by_year: tuple[float, ...]
    n_load_by_year: tuple[float, ...]
    leaching_by_year: tuple[float, ...]
    fen: float


@dataclass(frozen=True)
class YearlyFieldInput:
    id: str
    area_ha: float
    kystvand_id: int | None
    options: tuple[YearlyRotationOption, ...]


@dataclass(frozen=True)
class YearlyConstraintsInput:
    # Same per-kystvandopland principle as ConstraintsInput, but with an
    # eight-item per-calendar-year cap tuple per opland instead of one value.
    max_n_load_by_kystvandopland_and_year: dict[int | None, tuple[float | None, ...]]
    db2_swing_pct: float | None
    min_fen: float | None
    max_fen: float | None


@dataclass(frozen=True)
class YearlyOptimizationInput:
    fields: tuple[YearlyFieldInput, ...]
    constraints: YearlyConstraintsInput
    time_limit_seconds: float


@dataclass(frozen=True)
class YearlyOptimizationOutput:
    status: OptimizationStatus
    assignments: tuple[AssignedRotation, ...]
    total_db2: float
    total_n_load_kg: float
    total_leaching_kg: float
    total_fen: float
    total_db2_by_year: tuple[float, ...]
    total_n_load_by_year: tuple[float, ...]
