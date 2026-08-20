from pydantic import Field, field_validator, model_validator

from app.domain.base import CamelModel
from app.domain.field import Crop


class CropPercentageConstraint(CamelModel):
    crop: Crop
    minimum_percentage: float = Field(ge=0, le=100)


class OptimizationConstraints(CamelModel):
    max_n_load_kg: float | None = Field(default=None, ge=0)
    max_fields_with_new_rotation: int | None = Field(default=None, ge=0)
    crop_percentages: list[CropPercentageConstraint] = Field(default_factory=list)
    # UI-only memory of the last globally-applied allowed-rotation selection
    # from the simulation field list. The solver does not read this; it exists
    # purely so the checklist reloads in the same state next time the user
    # opens the simulation. `None` means "never applied".
    globally_allowed_rotation_ids: list[str] | None = None

    @field_validator("crop_percentages")
    @classmethod
    def validate_crop_percentages(
        cls,
        value: list[CropPercentageConstraint],
    ) -> list[CropPercentageConstraint]:
        crops = [constraint.crop for constraint in value]
        if len(crops) != len(set(crops)):
            raise ValueError("Crop percentage constraints cannot contain duplicate crops")

        return value

    @field_validator("globally_allowed_rotation_ids")
    @classmethod
    def validate_globally_allowed_rotation_ids(
        cls,
        value: list[str] | None,
    ) -> list[str] | None:
        if value is None:
            return value
        if len(set(value)) != len(value):
            raise ValueError("Globally allowed rotation ids must be unique")
        return value

    @model_validator(mode="after")
    def validate_percentage_sum(self) -> "OptimizationConstraints":
        total_percentage = sum(
            constraint.minimum_percentage for constraint in self.crop_percentages
        )
        if total_percentage > 100:
            raise ValueError("Crop percentage constraints cannot exceed 100 percent")

        return self


class Simulation(CamelModel):
    id: str
    farm_id: str
    name: str
    created_at: str
    constraints: OptimizationConstraints = Field(default_factory=OptimizationConstraints)


class CreateSimulationRequest(CamelModel):
    name: str = Field(min_length=1)
