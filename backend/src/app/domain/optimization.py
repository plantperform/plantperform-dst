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
    options: tuple[RotationOption, ...]


@dataclass(frozen=True)
class ConstraintsInput:
    max_n_load_kg: float | None
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


# ── Fase 11 — "Års-optimering": pr.-kalenderår udledningsloft, DB-udsvings-
# grænse, og automatisk rotations-forskydning (start_year) som ekstra
# beslutningsvariabel. Additivt sideordnet system til RotationOption/
# ConstraintsInput/solve() ovenfor — rører intet af det eksisterende.

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
    options: tuple[YearlyRotationOption, ...]


@dataclass(frozen=True)
class YearlyConstraintsInput:
    max_n_load_by_year: tuple[float | None, ...]
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
