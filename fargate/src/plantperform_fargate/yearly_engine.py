"""CP-SAT model for "Års-optimering" (Phase 11), parallel to engine.py's solve().

It operates on per-calendar-year udledning/DB2 instead of scenarie totals. See
YearlyRotationOption and related types in optimization/models.py for why this is
a peer system rather than a rewrite of solve().
"""

import math
import os
from collections import defaultdict

from ortools.sat.python import cp_model

from app.domain.optimization import NUM_YEARS
from plantperform_fargate.models import (
    RELATIVE_GAP_LIMIT,
    AssignedRotation,
    QuotaTradeInput,
    QuotaTradeResult,
    YearlyOptimizationInput,
    YearlyOptimizationOutput,
)

SCALE = 1000


def _scale(value: float) -> int:
    return round(value * SCALE)


def _highest_kvotegivende_n_load_by_year(
    input: YearlyOptimizationInput, kystvand_id: int
) -> list[float]:
    """The most udledning an opland's kvotegivende marker can have in each year."""
    highest = [0.0] * NUM_YEARS
    for field in input.fields:
        if field.kvotegivende and field.kystvand_id == kystvand_id:
            for y in range(NUM_YEARS):
                highest[y] += max(option.n_load_by_year[y] for option in field.options)
    for fixed in input.fixed_fields:
        if fixed.kvotegivende and fixed.kystvand_id == kystvand_id:
            for y in range(NUM_YEARS):
                highest[y] += fixed.n_load_by_year[y]
    return highest


def _trade_bounds_by_year(
    input: YearlyOptimizationInput, trade: QuotaTradeInput, caps: tuple[float, ...]
) -> list[tuple[int, int]]:
    """Whole-kg bounds on one opland's trade in each year.

    Selling stops where the year's cap reaches 0. Buying stops where the cap
    covers the opland's highest possible udledning that year, as more can only
    cost; one extra kg absorbs the rounding of the scaled terms.
    """
    highest = _highest_kvotegivende_n_load_by_year(input, trade.kystvand_id)
    return [
        (-math.floor(caps[y]), max(0, math.ceil(highest[y] - caps[y])) + 1)
        for y in range(NUM_YEARS)
    ]


def _same_trade_bounds(bounds_by_year: list[tuple[int, int]]) -> tuple[int, int]:
    """Bounds on a trade that is the same in every year: within every year's."""
    return (
        max(lower for lower, _ in bounds_by_year),
        max(upper for _, upper in bounds_by_year),
    )


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
    n_load_terms_by_kystvand_year: dict[int | None, list[list]] = defaultdict(
        lambda: [[] for _ in range(NUM_YEARS)]
    )
    kvotegivende_n_load_terms_by_kystvand_year: dict[int | None, list[list]] = defaultdict(
        lambda: [[] for _ in range(NUM_YEARS)]
    )
    fen_terms_by_year: list[list] = [[] for _ in range(NUM_YEARS)]
    for field in input.fields:
        year_terms = n_load_terms_by_kystvand_year[field.kystvand_id]
        kvotegivende_year_terms = (
            kvotegivende_n_load_terms_by_kystvand_year[field.kystvand_id]
            if field.kvotegivende
            else None
        )
        for option in field.options:
            variable = choice_vars[(field.id, option.key)]
            for y in range(NUM_YEARS):
                db2_terms_by_year[y].append(_scale(option.db2_by_year[y]) * variable)
                n_load_term = _scale(option.n_load_by_year[y]) * variable
                year_terms[y].append(n_load_term)
                if kvotegivende_year_terms is not None:
                    kvotegivende_year_terms[y].append(n_load_term)
                fen_terms_by_year[y].append(_scale(option.fen_by_year[y]) * variable)

    # Locked marks are not decision variables - there is nothing to choose -
    # but their already-decided per-year contribution still counts toward
    # the per-year kystvandopland cap, the db2_swing_pct stability check, the
    # per-year FEN bounds and the DB2 total, so it is added as a plain
    # constant per year alongside the CP-SAT terms above.
    for fixed in input.fixed_fields:
        year_terms = n_load_terms_by_kystvand_year[fixed.kystvand_id]
        kvotegivende_year_terms = (
            kvotegivende_n_load_terms_by_kystvand_year[fixed.kystvand_id]
            if fixed.kvotegivende
            else None
        )
        for y in range(NUM_YEARS):
            db2_terms_by_year[y].append(_scale(fixed.db2_by_year[y]))
            n_load_term = _scale(fixed.n_load_by_year[y])
            year_terms[y].append(n_load_term)
            if kvotegivende_year_terms is not None:
                kvotegivende_year_terms[y].append(n_load_term)
            fen_terms_by_year[y].append(_scale(fixed.fen_by_year[y]))

    total_db2_by_year = [sum(terms) for terms in db2_terms_by_year]
    total_fen_by_year = [sum(terms) for terms in fen_terms_by_year]
    total_n_load_by_kystvand_year = {
        kystvand_id: [sum(terms) for terms in year_terms]
        for kystvand_id, year_terms in n_load_terms_by_kystvand_year.items()
    }
    kvotegivende_n_load_by_kystvand_year = {
        kystvand_id: [sum(terms) for terms in year_terms]
        for kystvand_id, year_terms in kvotegivende_n_load_terms_by_kystvand_year.items()
    }
    total_n_load_by_year = [
        sum(
            total_n_load_by_kystvand_year[kystvand_id][y]
            for kystvand_id in total_n_load_by_kystvand_year
        )
        for y in range(NUM_YEARS)
    ]
    total_db2 = sum(total_db2_by_year)

    constraints = input.constraints

    for limit in constraints.crop_area_limits:
        for year in range(NUM_YEARS):
            chosen_area = sum(
                _scale(field.area_ha) * choice_vars[(field.id, option.key)]
                for field in input.fields
                for option in field.options
                if option.candidate.years[year].year.afgrode_kode == limit.afgrode_kode
            )
            fixed_area = sum(
                _scale(fixed.area_ha)
                for fixed in input.fixed_fields
                if fixed.crop_codes_by_year[year] == limit.afgrode_kode
            )
            total_area = chosen_area + fixed_area
            if limit.min_area_ha is not None:
                model.Add(total_area >= _scale(limit.min_area_ha))
            if limit.max_area_ha is not None:
                model.Add(total_area <= _scale(limit.max_area_ha))

    caps_by_kystvand = constraints.max_n_load_by_kystvandopland_and_year
    trades = {trade.kystvand_id: trade for trade in constraints.quota_trades}
    for trade in trades.values():
        caps = caps_by_kystvand.get(trade.kystvand_id)
        if caps is None or any(cap is None for cap in caps):
            raise ValueError(
                f"Kvotehandel needs a cap in every year for kystvandopland {trade.kystvand_id}"
            )
        if trade.kystvand_id not in kvotegivende_n_load_by_kystvand_year:
            raise ValueError(
                f"Kvotehandel needs kvotegivende marker in kystvandopland {trade.kystvand_id}"
            )

    # One trade variable per year; a trade that is the same each year uses one
    # variable for all of them.
    trade_vars_by_year: dict[int, list[cp_model.IntVar]] = {}
    for kystvand_id, caps in caps_by_kystvand.items():
        year_totals = kvotegivende_n_load_by_kystvand_year.get(kystvand_id)
        if year_totals is None:
            continue
        trade = trades.get(kystvand_id)
        if trade is not None:
            bounds = _trade_bounds_by_year(input, trade, caps)
            if trade.same_each_year:
                lower, upper = _same_trade_bounds(bounds)
                trade_var = model.NewIntVar(lower, upper, f"quota_trade_{kystvand_id}")
                trade_vars_by_year[kystvand_id] = [trade_var] * NUM_YEARS
            else:
                trade_vars_by_year[kystvand_id] = [
                    model.NewIntVar(lower, upper, f"quota_trade_{kystvand_id}_{y}")
                    for y, (lower, upper) in enumerate(bounds)
                ]
        for y in range(NUM_YEARS):
            cap = caps[y]
            if cap is None:
                continue
            if trade is None:
                model.Add(year_totals[y] <= _scale(cap))
            else:
                model.Add(
                    year_totals[y] <= _scale(cap) + SCALE * trade_vars_by_year[kystvand_id][y]
                )

    if constraints.db2_swing_pct is not None:
        pct = constraints.db2_swing_pct
        upper = round(100 + pct)
        lower = round(max(0, 100 - pct))
        for y in range(NUM_YEARS):
            model.Add(total_db2_by_year[y] * NUM_YEARS * 100 <= total_db2 * upper)
            model.Add(total_db2_by_year[y] * NUM_YEARS * 100 >= total_db2 * lower)

    # Unlike the scenarie-average bound in engine.py's solve(), min_fen/max_fen
    # hold in every calendar year: a herd needs its foderenheder each year, so a
    # surplus in one year cannot make up for a shortfall in another.
    for y in range(NUM_YEARS):
        if constraints.min_fen is not None:
            model.Add(total_fen_by_year[y] >= _scale(constraints.min_fen))
        if constraints.max_fen is not None:
            model.Add(total_fen_by_year[y] <= _scale(constraints.max_fen))

    # total_db2 adds up all NUM_YEARS years, and each year's trade is paid in
    # that year. The swing limit above stays on the crops' DB2, also when the
    # trade varies by year: the limit is about the crops' income varying.
    quota_payment = sum(
        _scale(trades[kystvand_id].price_kr_per_kg) * sum(year_vars)
        for kystvand_id, year_vars in trade_vars_by_year.items()
    )
    model.Maximize(total_db2 - quota_payment)

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = int(os.getenv("OPTIMIZER_SOLVER_THREADS", "2"))
    solver.parameters.max_time_in_seconds = input.time_limit_seconds
    # See engine.py's solve() for why presolve is off and the gap limit is set.
    solver.parameters.cp_model_presolve = False
    solver.parameters.relative_gap_limit = RELATIVE_GAP_LIMIT
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
    # Same averaging convention as the solved fields below: db2_by_year/
    # n_load_by_year/leaching_by_year hold one real calendar-year value each.
    total_db2_value = sum(sum(fixed.db2_by_year) / NUM_YEARS for fixed in input.fixed_fields)
    total_n_load_value = sum(sum(fixed.n_load_by_year) / NUM_YEARS for fixed in input.fixed_fields)
    total_leaching_value = sum(
        sum(fixed.leaching_by_year) / NUM_YEARS for fixed in input.fixed_fields
    )
    total_fen_value = sum(fixed.fen for fixed in input.fixed_fields)
    for field in input.fields:
        for option in field.options:
            if solver.BooleanValue(choice_vars[(field.id, option.key)]):
                # db2_by_year/n_load_by_year/leaching_by_year hold one real
                # calendar-year value each (8 entries) — summing all 8 gives
                # a whole rotation-cycle total, 8x too large compared to what
                # every other code path (engine.py's solve(), _build_options,
                # apply_manual_rotation) treats a field's db2/n_load/leaching
                # as: one representative year. Average, don't sum, to match.
                db2_value = sum(option.db2_by_year) / NUM_YEARS
                n_load_value = sum(option.n_load_by_year) / NUM_YEARS
                leaching_value = sum(option.leaching_by_year) / NUM_YEARS
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

    quota_trades = []
    for kystvand_id in trade_vars_by_year:
        trade = trades[kystvand_id]
        caps = caps_by_kystvand[kystvand_id]
        year_totals = kvotegivende_n_load_by_kystvand_year[kystvand_id]
        bounds = _trade_bounds_by_year(input, trade, caps)
        # Within the gap limit the solver may keep a few kg of trade the plan
        # does not use. The smallest trade that still covers the chosen plan
        # always pays less, so report that one.
        needed = [
            -((_scale(caps[y]) - solver.Value(year_totals[y])) // SCALE) for y in range(NUM_YEARS)
        ]
        if trade.same_each_year:
            trade_kg = max(max(needed), _same_trade_bounds(bounds)[0])
            trade_kg_by_year = (trade_kg,) * NUM_YEARS
        else:
            trade_kg_by_year = tuple(max(needed[y], bounds[y][0]) for y in range(NUM_YEARS))
        quota_trades.append(
            QuotaTradeResult(
                kystvand_id=kystvand_id,
                trade_kg_by_year=trade_kg_by_year,
                price_kr_per_kg=trade.price_kr_per_kg,
                same_each_year=trade.same_each_year,
                payment_kr_per_year=trade.price_kr_per_kg * sum(trade_kg_by_year) / NUM_YEARS,
            )
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
        quota_trades=tuple(quota_trades),
    )
