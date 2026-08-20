from math import ceil

from ortools.sat.python import cp_model

from app.domain.field import Crop
from app.domain.optimization import (
    AssignedRotation,
    FieldInput,
    OptimizationInput,
    OptimizationOutput,
    RotationOption,
)
from app.domain.rotation_library import CURRENT_ROTATION_ID
from app.services.optimization.metrics import field_db2, field_leaching, field_n_load

SCALE = 1000


def _scale(value: float) -> int:
    return round(value * SCALE)


def _crop_area_share(field: FieldInput, option: RotationOption, crop: Crop) -> float:
    return field.area_ha * (option.crops.count(crop) / len(option.crops))


def solve(input: OptimizationInput) -> OptimizationOutput:
    model = cp_model.CpModel()
    choice_vars: dict[tuple[str, str], cp_model.IntVar] = {}

    for field in input.fields:
        field_choice_vars = []
        for option in field.options:
            variable = model.NewBoolVar(f"field_{field.id}_option_{option.key}")
            choice_vars[(field.id, option.key)] = variable
            field_choice_vars.append(variable)
        model.Add(sum(field_choice_vars) == 1)

    db2_terms = []
    n_load_terms = []
    for field in input.fields:
        for option in field.options:
            variable = choice_vars[(field.id, option.key)]
            db2_terms.append(
                _scale(field_db2(field.area_ha, field.soil, option.crops, option.measures))
                * variable
            )
            n_load_terms.append(
                _scale(
                    field_n_load(
                        field.area_ha,
                        field.retention,
                        field.soil,
                        option.crops,
                        option.measures,
                    )
                )
                * variable
            )

    total_db2 = sum(db2_terms)
    total_n_load = sum(n_load_terms)
    constraints = input.constraints

    if constraints.max_n_load_kg is not None:
        model.Add(total_n_load <= _scale(constraints.max_n_load_kg))

    if constraints.max_fields_with_new_rotation is not None:
        changed_vars = []
        for field in input.fields:
            changed = model.NewBoolVar(f"field_{field.id}_changed")
            current_vars = [
                choice_vars[(field.id, option.key)]
                for option in field.options
                if option.id == CURRENT_ROTATION_ID
            ]
            if not current_vars:
                model.Add(changed == 1)
            else:
                model.Add(changed + sum(current_vars) == 1)
            changed_vars.append(changed)

        model.Add(sum(changed_vars) <= constraints.max_fields_with_new_rotation)

    total_area = sum(field.area_ha for field in input.fields)
    for crop_constraint in constraints.crop_percentages:
        crop_terms = []
        for field in input.fields:
            for option in field.options:
                crop_terms.append(
                    _scale(_crop_area_share(field, option, crop_constraint.crop))
                    * choice_vars[(field.id, option.key)]
                )

        required_area = ceil(total_area * (crop_constraint.minimum_percentage / 100) * SCALE)
        model.Add(sum(crop_terms) >= required_area)

    model.Maximize(total_db2)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = input.time_limit_seconds
    status = solver.Solve(model)

    if status == cp_model.OPTIMAL:
        output_status = "OPTIMAL"
    elif status == cp_model.FEASIBLE:
        output_status = "FEASIBLE"
    elif status == cp_model.INFEASIBLE:
        return OptimizationOutput(
            status="INFEASIBLE",
            assignments=(),
            total_db2=0,
            total_n_load_kg=0,
            total_leaching_kg=0,
        )
    else:
        return OptimizationOutput(
            status="UNKNOWN",
            assignments=(),
            total_db2=0,
            total_n_load_kg=0,
            total_leaching_kg=0,
        )

    assignments = []
    total_db2_value = 0.0
    total_n_load_value = 0.0
    total_leaching_value = 0.0
    for field in input.fields:
        for option in field.options:
            if solver.BooleanValue(choice_vars[(field.id, option.key)]):
                assignments.append(
                    AssignedRotation(
                        field_id=field.id,
                        rotation_id=option.id,
                        crops=option.crops,
                        measures=option.measures,
                    )
                )
                total_db2_value += field_db2(
                    field.area_ha,
                    field.soil,
                    option.crops,
                    option.measures,
                )
                total_n_load_value += field_n_load(
                    field.area_ha,
                    field.retention,
                    field.soil,
                    option.crops,
                    option.measures,
                )
                total_leaching_value += field_leaching(
                    field.area_ha,
                    field.soil,
                    option.crops,
                    option.measures,
                )
                break

    return OptimizationOutput(
        status=output_status,
        assignments=tuple(assignments),
        total_db2=total_db2_value,
        total_n_load_kg=total_n_load_value,
        total_leaching_kg=total_leaching_value,
    )
