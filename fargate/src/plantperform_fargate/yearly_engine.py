"""CP-SAT model for "Års-optimering" (Phase 11), parallel to engine.py's solve().

It operates on per-calendar-year udledning/DB2 instead of scenarie totals. See
YearlyRotationOption and related types in optimization/models.py for why this is
a peer system rather than a rewrite of solve().
"""

import math
import os
from collections import defaultdict
from collections.abc import Mapping

from ortools.sat.python import cp_model

from app.domain.optimization import NUM_YEARS
from plantperform_fargate.models import (
    RELATIVE_GAP_LIMIT,
    AssignedRotation,
    YearlyOptimizationInput,
    YearlyOptimizationOutput,
)

SCALE = 1000
# A cap variable's domain when its opland has no cap in a solve. Far above any
# udledning a farm can reach, even scaled by SCALE.
_NO_CAP = 10**15

Caps = Mapping[int | None, tuple[float | None, ...]]


def _scale(value: float) -> int:
    return round(value * SCALE)


def _infeasible_output(
    status: str, db2_upper_bound: float | None = None
) -> YearlyOptimizationOutput:
    return YearlyOptimizationOutput(
        status=status,
        assignments=(),
        total_db2=0,
        total_n_load_kg=0,
        total_leaching_kg=0,
        total_fen=0,
        total_db2_by_year=tuple(0.0 for _ in range(NUM_YEARS)),
        total_n_load_by_year=tuple(0.0 for _ in range(NUM_YEARS)),
        db2_upper_bound=db2_upper_bound,
    )


def solve_yearly(
    input: YearlyOptimizationInput,
    hint: Mapping[str, str] | None = None,
) -> YearlyOptimizationOutput:
    """Solve "Års-optimering".

    hint maps a field id to the option key to start the search from, typically a
    neighbouring solution of a closely related model. It only guides CP-SAT; a
    hint that is infeasible for this model is repaired or ignored by the solver.
    """
    return YearlyModel(input).solve(
        input.constraints.max_n_load_by_kystvandopland_and_year,
        input.time_limit_seconds,
        hint,
        input.relative_gap_limit,
    )


class YearlyModel:
    """The "Års-optimering" CP-SAT model, built once and solved for several caps.

    Building the model is the slow part for large scenarier (tens of thousands
    of shifted options), so callers that only vary the udledning caps, like the
    kvote value curve, build it once. Every opland and year with a cap in the
    input gets a cap variable whose domain is fixed to the cap of each solve; a
    solve may change those caps or lift them (None), but not add new ones.
    """

    def __init__(self, input: YearlyOptimizationInput):
        self.input = input
        self.model = model = cp_model.CpModel()
        self.choice_vars: dict[tuple[str, str], cp_model.IntVar] = {}
        self.cap_vars: dict[tuple[int | None, int], cp_model.IntVar] = {}
        choice_vars = self.choice_vars

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

        self.total_db2_by_year = total_db2_by_year = [sum(terms) for terms in db2_terms_by_year]
        total_fen_by_year = [sum(terms) for terms in fen_terms_by_year]
        total_n_load_by_kystvand_year = {
            kystvand_id: [sum(terms) for terms in year_terms]
            for kystvand_id, year_terms in n_load_terms_by_kystvand_year.items()
        }
        kvotegivende_n_load_by_kystvand_year = {
            kystvand_id: [sum(terms) for terms in year_terms]
            for kystvand_id, year_terms in kvotegivende_n_load_terms_by_kystvand_year.items()
        }
        self.kvotegivende_oplande = set(kvotegivende_n_load_by_kystvand_year)
        self.total_n_load_by_year = [
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

        for kystvand_id, caps in constraints.max_n_load_by_kystvandopland_and_year.items():
            year_totals = kvotegivende_n_load_by_kystvand_year.get(kystvand_id)
            if year_totals is None:
                continue
            for y in range(NUM_YEARS):
                if caps[y] is not None:
                    cap = model.NewIntVar(-_NO_CAP, _NO_CAP, f"cap_{kystvand_id}_{y}")
                    self.cap_vars[(kystvand_id, y)] = cap
                    model.Add(year_totals[y] <= cap)

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

        model.Maximize(total_db2)

    def copy(self) -> "YearlyModel":
        """An independent copy, for solving in another thread at the same time.

        Every solve changes the model's caps and hint in place, so concurrent
        solves need a model each. Cloning the CP-SAT model is much cheaper than
        building it again from the options. The clone keeps every variable's
        index, so the yearly sums read after a solve, which are evaluated by
        index, are shared; the variables a solve changes are the clone's own.
        """
        clone = object.__new__(YearlyModel)
        clone.__dict__.update(self.__dict__)
        clone.model = self.model.clone()
        clone.choice_vars = {
            key: clone.model.get_bool_var_from_proto_index(variable.Index())
            for key, variable in self.choice_vars.items()
        }
        clone.cap_vars = {
            key: clone.model.get_int_var_from_proto_index(variable.Index())
            for key, variable in self.cap_vars.items()
        }
        return clone

    def _set_caps(self, caps: Caps) -> None:
        for (kystvand_id, y), variable in self.cap_vars.items():
            year_caps = caps.get(kystvand_id)
            cap = year_caps[y] if year_caps is not None else None
            low, high = (-_NO_CAP, _NO_CAP) if cap is None else (_scale(cap), _scale(cap))
            domain = self.model.Proto().variables[variable.Index()].domain
            domain.clear()
            domain.extend([low, high])
        # An opland without kvotegivende marker has no cap constraint at all, so
        # its caps are ignored, as when the model is built.
        for kystvand_id, year_caps in caps.items():
            if kystvand_id not in self.kvotegivende_oplande:
                continue
            for y, cap in enumerate(year_caps):
                if cap is not None and (kystvand_id, y) not in self.cap_vars:
                    raise ValueError(
                        f"Opland {kystvand_id} year {y} had no cap when the model was built"
                    )

    def _set_hint(self, hint: Mapping[str, str] | None) -> None:
        self.model.ClearHints()
        if not hint:
            return
        for field in self.input.fields:
            hinted_key = hint.get(field.id)
            if hinted_key is None or (field.id, hinted_key) not in self.choice_vars:
                continue
            for option in field.options:
                self.model.AddHint(
                    self.choice_vars[(field.id, option.key)], option.key == hinted_key
                )

    def solve(
        self,
        caps: Caps,
        time_limit_seconds: float,
        hint: Mapping[str, str] | None = None,
        relative_gap_limit: float = RELATIVE_GAP_LIMIT,
    ) -> YearlyOptimizationOutput:
        input = self.input
        self._set_caps(caps)
        self._set_hint(hint)

        solver = cp_model.CpSolver()
        solver.parameters.num_search_workers = int(os.getenv("OPTIMIZER_SOLVER_THREADS", "2"))
        solver.parameters.max_time_in_seconds = time_limit_seconds
        # See engine.py's solve() for why presolve is off and the gap limit is set.
        solver.parameters.cp_model_presolve = False
        solver.parameters.relative_gap_limit = relative_gap_limit
        status = solver.Solve(self.model)
        # The objective sums the scaled DB2 of every year; total_db2 is the
        # unscaled yearly average.
        bound = solver.best_objective_bound
        db2_upper_bound = bound / (SCALE * NUM_YEARS) if math.isfinite(bound) else None

        if status == cp_model.OPTIMAL:
            output_status = "OPTIMAL"
        elif status == cp_model.FEASIBLE:
            output_status = "FEASIBLE"
        elif status == cp_model.INFEASIBLE:
            return _infeasible_output("INFEASIBLE")
        else:
            return _infeasible_output("UNKNOWN", db2_upper_bound)

        assignments = []
        # Same averaging convention as the solved fields below: db2_by_year/
        # n_load_by_year/leaching_by_year hold one real calendar-year value each.
        total_db2_value = sum(sum(fixed.db2_by_year) / NUM_YEARS for fixed in input.fixed_fields)
        total_n_load_value = sum(
            sum(fixed.n_load_by_year) / NUM_YEARS for fixed in input.fixed_fields
        )
        total_leaching_value = sum(
            sum(fixed.leaching_by_year) / NUM_YEARS for fixed in input.fixed_fields
        )
        total_fen_value = sum(fixed.fen for fixed in input.fixed_fields)
        for field in input.fields:
            for option in field.options:
                if solver.BooleanValue(self.choice_vars[(field.id, option.key)]):
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
            solver.Value(self.total_db2_by_year[y]) / SCALE for y in range(NUM_YEARS)
        )
        total_n_load_by_year_value = tuple(
            solver.Value(self.total_n_load_by_year[y]) / SCALE for y in range(NUM_YEARS)
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
            db2_upper_bound=db2_upper_bound,
        )
