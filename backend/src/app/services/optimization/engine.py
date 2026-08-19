from ortools.sat.python import cp_model

from app.domain.optimization import (
    AssignedRotation,
    OptimizationInput,
    OptimizationOutput,
)

SCALE = 1000


def _scale(value: float) -> int:
    return round(value * SCALE)


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
    fen_terms = []
    for field in input.fields:
        for option in field.options:
            variable = choice_vars[(field.id, option.key)]
            db2_terms.append(_scale(option.db2) * variable)
            n_load_terms.append(_scale(option.n_load) * variable)
            fen_terms.append(_scale(option.fen) * variable)

    total_db2 = sum(db2_terms)
    total_n_load = sum(n_load_terms)
    total_fen = sum(fen_terms)
    constraints = input.constraints

    if constraints.max_n_load_kg is not None:
        model.Add(total_n_load <= _scale(constraints.max_n_load_kg))

    if constraints.min_fen is not None:
        model.Add(total_fen >= _scale(constraints.min_fen))

    if constraints.max_fen is not None:
        model.Add(total_fen <= _scale(constraints.max_fen))

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
            total_fen=0,
        )
    else:
        return OptimizationOutput(
            status="UNKNOWN",
            assignments=(),
            total_db2=0,
            total_n_load_kg=0,
            total_leaching_kg=0,
            total_fen=0,
        )

    assignments = []
    total_db2_value = 0.0
    total_n_load_value = 0.0
    total_leaching_value = 0.0
    total_fen_value = 0.0
    for field in input.fields:
        for option in field.options:
            if solver.BooleanValue(choice_vars[(field.id, option.key)]):
                assignments.append(
                    AssignedRotation(
                        field_id=field.id,
                        rotation_id=option.id,
                        years=option.years,
                        db2=option.db2,
                        n_load=option.n_load,
                        leaching=option.leaching,
                        fen=option.fen,
                    )
                )
                total_db2_value += option.db2
                total_n_load_value += option.n_load
                total_leaching_value += option.leaching
                total_fen_value += option.fen
                break

    return OptimizationOutput(
        status=output_status,
        assignments=tuple(assignments),
        total_db2=total_db2_value,
        total_n_load_kg=total_n_load_value,
        total_leaching_kg=total_leaching_value,
        total_fen=total_fen_value,
    )
