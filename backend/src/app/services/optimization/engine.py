from collections import defaultdict

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
    kvotegivende_n_load_terms_by_kystvand: dict[int | None, list] = defaultdict(list)
    fen_terms = []
    for field in input.fields:
        for option in field.options:
            variable = choice_vars[(field.id, option.key)]
            db2_terms.append(_scale(option.db2) * variable)
            if field.kvotegivende:
                kvotegivende_n_load_terms_by_kystvand[field.kystvand_id].append(
                    _scale(option.n_load) * variable
                )
            fen_terms.append(_scale(option.fen) * variable)

    # Locked marks are not decision variables - there is nothing to choose -
    # but their already-decided contribution still counts toward the
    # kystvandopland cap and the FEN/DB2 totals, so it is added as a plain
    # constant alongside the CP-SAT terms above.
    fixed_db2_total = 0
    fixed_fen_total = 0
    fixed_n_load_by_kystvand: dict[int | None, int] = defaultdict(int)
    for fixed in input.fixed_fields:
        fixed_db2_total += _scale(fixed.db2)
        fixed_fen_total += _scale(fixed.fen)
        if fixed.kvotegivende:
            fixed_n_load_by_kystvand[fixed.kystvand_id] += _scale(fixed.n_load)
    for kystvand_id, amount in fixed_n_load_by_kystvand.items():
        kvotegivende_n_load_terms_by_kystvand[kystvand_id].append(amount)

    total_db2 = sum(db2_terms) + fixed_db2_total
    kvotegivende_n_load_by_kystvand = {
        kystvand_id: sum(terms)
        for kystvand_id, terms in kvotegivende_n_load_terms_by_kystvand.items()
    }
    total_fen = sum(fen_terms) + fixed_fen_total
    constraints = input.constraints

    for kystvand_id, cap in constraints.max_n_load_by_kystvandopland.items():
        n_load_for_kystvand = kvotegivende_n_load_by_kystvand.get(kystvand_id)
        if cap is not None and n_load_for_kystvand is not None:
            model.Add(n_load_for_kystvand <= _scale(cap))

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
    total_db2_value = sum(fixed.db2 for fixed in input.fixed_fields)
    total_n_load_value = sum(fixed.n_load for fixed in input.fixed_fields)
    total_leaching_value = sum(fixed.leaching for fixed in input.fixed_fields)
    total_fen_value = sum(fixed.fen for fixed in input.fixed_fields)
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
