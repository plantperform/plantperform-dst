"""CP-SAT-model for "Års-optimering" (Fase 11) — parallel til engine.py's
solve(), men arbejder med pr.-kalenderår udledning/DB2 i stedet for
scenarie-totaler. Se domain/optimization.py's YearlyRotationOption m.fl.
for hvorfor dette er et sideordnet system, ikke en ombygning af solve().
"""
from ortools.sat.python import cp_model

from app.domain.optimization import (
    AssignedRotation,
    YearlyOptimizationInput,
    YearlyOptimizationOutput,
)

SCALE = 1000
NUM_YEARS = 8


def _scale(value: float) -> int:
    return round(value * SCALE)


def _infeasible_output(status: str) -> YearlyOptimizationOutput:
    return YearlyOptimizationOutput(
        status=status,
        assignments=(),
        total_db2=0,
        total_n_load_kg=0,
        total_leaching_kg=0,
        total_fen=0,
        total_db2_by_year=tuple(0.0 for _ in range(NUM_YEARS)),
        total_n_load_by_year=tuple(0.0 for _ in range(NUM_YEARS)),
    )


def solve_yearly(input: YearlyOptimizationInput) -> YearlyOptimizationOutput:
    model = cp_model.CpModel()
    choice_vars: dict[tuple[str, str], cp_model.IntVar] = {}

    for field in input.fields:
        field_choice_vars = []
        for option in field.options:
            variable = model.NewBoolVar(f"field_{field.id}_option_{option.key}")
            choice_vars[(field.id, option.key)] = variable
            field_choice_vars.append(variable)
        model.Add(sum(field_choice_vars) == 1)

    db2_terms_by_year: list[list] = [[] for _ in range(NUM_YEARS)]
    n_load_terms_by_year: list[list] = [[] for _ in range(NUM_YEARS)]
    fen_terms = []
    for field in input.fields:
        for option in field.options:
            variable = choice_vars[(field.id, option.key)]
            for y in range(NUM_YEARS):
                db2_terms_by_year[y].append(_scale(option.db2_by_year[y]) * variable)
                n_load_terms_by_year[y].append(_scale(option.n_load_by_year[y]) * variable)
            fen_terms.append(_scale(option.fen) * variable)

    total_db2_by_year = [sum(terms) for terms in db2_terms_by_year]
    total_n_load_by_year = [sum(terms) for terms in n_load_terms_by_year]
    total_db2 = sum(total_db2_by_year)
    total_fen = sum(fen_terms)

    constraints = input.constraints

    for y in range(NUM_YEARS):
        cap = constraints.max_n_load_by_year[y]
        if cap is not None:
            model.Add(total_n_load_by_year[y] <= _scale(cap))

    if constraints.db2_swing_pct is not None:
        pct = constraints.db2_swing_pct
        upper = round(100 + pct)
        lower = round(max(0, 100 - pct))
        for y in range(NUM_YEARS):
            model.Add(total_db2_by_year[y] * NUM_YEARS * 100 <= total_db2 * upper)
            model.Add(total_db2_by_year[y] * NUM_YEARS * 100 >= total_db2 * lower)

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
        return _infeasible_output("INFEASIBLE")
    else:
        return _infeasible_output("UNKNOWN")

    assignments = []
    total_db2_value = 0.0
    total_n_load_value = 0.0
    total_leaching_value = 0.0
    total_fen_value = 0.0
    for field in input.fields:
        for option in field.options:
            if solver.BooleanValue(choice_vars[(field.id, option.key)]):
                db2_value = sum(option.db2_by_year)
                n_load_value = sum(option.n_load_by_year)
                leaching_value = sum(option.leaching_by_year)
                assignments.append(
                    AssignedRotation(
                        field_id=field.id,
                        rotation_id=option.id,
                        years=option.years,
                        db2=db2_value,
                        n_load=n_load_value,
                        leaching=leaching_value,
                        fen=option.fen,
                    )
                )
                total_db2_value += db2_value
                total_n_load_value += n_load_value
                total_leaching_value += leaching_value
                total_fen_value += option.fen
                break

    total_db2_by_year_value = tuple(
        solver.Value(total_db2_by_year[y]) / SCALE for y in range(NUM_YEARS)
    )
    total_n_load_by_year_value = tuple(
        solver.Value(total_n_load_by_year[y]) / SCALE for y in range(NUM_YEARS)
    )

    return YearlyOptimizationOutput(
        status=output_status,
        assignments=tuple(assignments),
        total_db2=total_db2_value,
        total_n_load_kg=total_n_load_value,
        total_leaching_kg=total_leaching_value,
        total_fen=total_fen_value,
        total_db2_by_year=total_db2_by_year_value,
        total_n_load_by_year=total_n_load_by_year_value,
    )
