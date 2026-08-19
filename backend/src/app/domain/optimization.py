from dataclasses import dataclass
from typing import Literal

from app.domain.rotation_candidate import RotationYear

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
