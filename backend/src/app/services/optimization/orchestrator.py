from dataclasses import dataclass

from app.data import repository
from app.domain.field import (
    Crop,
    FieldMeasures,
    FieldRecord,
    UpdateFieldRequest,
    crop_allows_cover_crop,
    crop_allows_early_sowing,
)
from app.domain.optimization import (
    ConstraintsInput,
    CropPercentageInput,
    FieldInput,
    OptimizationInput,
    OptimizationOutput,
    RotationOption,
)
from app.domain.rotation import NamedRotation
from app.domain.rotation_library import CURRENT_ROTATION_ID
from app.services.optimization.engine import solve


class OptimizationNotFoundError(Exception):
    pass


class OptimizationInfeasibleError(Exception):
    pass


class OptimizationUnknownError(Exception):
    pass


@dataclass(frozen=True)
class OptimizationRunResult:
    output: OptimizationOutput
    fields: tuple[FieldRecord, ...]


def _build_options(
    field: FieldRecord,
    rotation_library: list[NamedRotation],
) -> tuple[RotationOption, ...]:
    rotations_by_id = {rotation.id: rotation for rotation in rotation_library}
    options = []

    def add_options(rotation_id: str, crops: tuple[Crop, ...]) -> None:
        crop_rotation = list(crops)
        cover_crop_years = [
            index
            for index in range(len(crop_rotation))
            if crop_allows_cover_crop(crop_rotation, index)
        ]
        early_sowing_years = [
            index for index, crop in enumerate(crops) if crop_allows_early_sowing(crop)
        ]
        for mask in range(1 << len(cover_crop_years)):
            selected_cover_years = [
                year for bit, year in enumerate(cover_crop_years) if mask & (1 << bit)
            ]
            measures = FieldMeasures(
                precision_farming=True,
                cover_crop_years=selected_cover_years,
                early_sowing_years=early_sowing_years,
            )
            cover_key = (
                "none"
                if not selected_cover_years
                else "_".join(str(year) for year in selected_cover_years)
            )
            options.append(
                RotationOption(
                    key=f"{rotation_id}:cover:{cover_key}",
                    id=rotation_id,
                    crops=crops,
                    measures=measures,
                )
            )

    for rotation_id in field.allowed_rotation_ids:
        if rotation_id == CURRENT_ROTATION_ID:
            add_options(CURRENT_ROTATION_ID, tuple(field.crop_rotation))
            continue

        rotation = rotations_by_id.get(rotation_id)
        if rotation is None:
            raise OptimizationInfeasibleError(
                f"Field {field.name} references unknown rotation {rotation_id}."
            )

        add_options(rotation.id, tuple(rotation.crops))

    return tuple(options)


def run_optimization(
    farm_id: str,
    simulation_id: str,
    time_limit_seconds: float,
) -> OptimizationRunResult:
    farm = repository.get_farm(farm_id)
    simulation = repository.get_simulation(farm_id, simulation_id)
    fields = repository.list_simulation_fields(farm_id, simulation_id)

    if farm is None or simulation is None or fields is None:
        raise OptimizationNotFoundError

    if not fields:
        raise OptimizationInfeasibleError("Simulation has no fields to optimize.")

    field_inputs = []
    for field in fields:
        options = _build_options(field, farm.rotation_library)
        if not options:
            raise OptimizationInfeasibleError(f"Field {field.name} has no allowed rotations.")

        field_inputs.append(
            FieldInput(
                id=field.id,
                area_ha=field.area_ha,
                retention=field.retention,
                soil=field.soil,
                original_rotation=tuple(field.crop_rotation),
                options=options,
            )
        )

    output = solve(
        input=OptimizationInput(
            fields=tuple(field_inputs),
            constraints=ConstraintsInput(
                max_n_load_kg=simulation.constraints.max_n_load_kg,
                max_fields_with_new_rotation=simulation.constraints.max_fields_with_new_rotation,
                crop_percentages=tuple(
                    CropPercentageInput(
                        crop=constraint.crop,
                        minimum_percentage=constraint.minimum_percentage,
                    )
                    for constraint in simulation.constraints.crop_percentages
                ),
            ),
            time_limit_seconds=time_limit_seconds,
        )
    )

    if output.status == "INFEASIBLE":
        raise OptimizationInfeasibleError(
            "No feasible crop rotation assignment satisfies the saved constraints."
        )

    if output.status == "UNKNOWN":
        raise OptimizationUnknownError("Optimization did not find a feasible solution in time.")

    updated_fields = []
    for assignment in output.assignments:
        updated_field = repository.update_simulation_field(
            farm_id,
            simulation_id,
            assignment.field_id,
            UpdateFieldRequest(
                crop_rotation=list(assignment.crops),
                measures=assignment.measures,
            ),
        )
        if updated_field is None:
            raise OptimizationNotFoundError
        updated_fields.append(updated_field)

    return OptimizationRunResult(output=output, fields=tuple(updated_fields))
