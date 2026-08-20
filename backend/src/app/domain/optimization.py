from dataclasses import dataclass
from typing import Literal

from app.domain.field import Crop, FieldMeasures, Soil

OptimizationStatus = Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN"]


@dataclass(frozen=True)
class RotationOption:
    key: str
    id: str
    crops: tuple[Crop, ...]
    measures: FieldMeasures


@dataclass(frozen=True)
class FieldInput:
    id: str
    area_ha: float
    retention: float | None
    soil: Soil
    original_rotation: tuple[Crop, ...]
    options: tuple[RotationOption, ...]


@dataclass(frozen=True)
class CropPercentageInput:
    crop: Crop
    minimum_percentage: float


@dataclass(frozen=True)
class ConstraintsInput:
    max_n_load_kg: float | None
    max_fields_with_new_rotation: int | None
    crop_percentages: tuple[CropPercentageInput, ...]


@dataclass(frozen=True)
class OptimizationInput:
    fields: tuple[FieldInput, ...]
    constraints: ConstraintsInput
    time_limit_seconds: float


@dataclass(frozen=True)
class AssignedRotation:
    field_id: str
    rotation_id: str
    crops: tuple[Crop, ...]
    measures: FieldMeasures


@dataclass(frozen=True)
class OptimizationOutput:
    status: OptimizationStatus
    assignments: tuple[AssignedRotation, ...]
    total_db2: float
    total_n_load_kg: float
    total_leaching_kg: float
