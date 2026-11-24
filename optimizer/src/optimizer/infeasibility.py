"""Explain a proven infeasible result using the user-facing rules in its CP-SAT model."""

import logging
import time

from ortools.sat.python import cp_model

from optimizer.deadline import RESULT_RESERVE_SECONDS, remaining_time

UNIDENTIFIED_CONFLICT = (
    "Ingen sædskiftefordeling kan opfylde de gemte krav. "
    "Det var ikke muligt at udpege de præcise regler, der er i konflikt."
)


def catchment_label(catchment_id: int | None) -> str:
    if catchment_id is None:
        return "marker uden kystvandopland"
    return f"kystvandopland {catchment_id}"


def number(value: float) -> str:
    return f"{value:,.3f}".rstrip("0").rstrip(".").translate(str.maketrans(",.", ".,"))


def explain_conflict(model: cp_model.CpModel) -> str:
    budget = 5.0
    remaining = remaining_time.get()
    if remaining is not None:
        budget = min(budget, remaining() / 1000 - RESULT_RESERVE_SECONDS)
    if budget <= 0:
        return UNIDENTIFIED_CONFLICT
    deadline = time.monotonic() + budget
    try:
        return _explain_with_assumptions(model, deadline)
    except Exception:
        # The primary solve already proved infeasibility. A diagnostic failure
        # must not turn it into a worker failure or discard the saved outcome.
        logging.getLogger(__name__).exception("optimizer_conflict_diagnostics_failed")
        return UNIDENTIFIED_CONFLICT


def _explain_with_assumptions(model: cp_model.CpModel, deadline: float) -> str:
    diagnostic = model.clone()
    diagnostic.clear_objective()
    diagnostic.clear_hints()

    # Structural constraints always hold. Each named rule can be switched off
    # in this copy; two bounds implementing the same rule share an assumption.
    assumptions = {}
    for constraint in diagnostic.proto.constraints:
        if time.monotonic() >= deadline:
            return UNIDENTIFIED_CONFLICT
        if constraint.name:
            label = constraint.name
            if label not in assumptions:
                flag = diagnostic.new_bool_var(label)
                diagnostic.add_assumption(flag)
                assumptions[label] = flag.index
            constraint.enforcement_literal.append(assumptions[label])
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    seconds = deadline - time.monotonic()
    if seconds <= 0 or not assumptions:
        return UNIDENTIFIED_CONFLICT
    solver.parameters.max_time_in_seconds = seconds
    if solver.solve(diagnostic) != cp_model.INFEASIBLE:
        return UNIDENTIFIED_CONFLICT
    core = set(solver.sufficient_assumptions_for_infeasibility())
    rules = [label for label, index in assumptions.items() if index in core]
    if not rules:
        return UNIDENTIFIED_CONFLICT
    if len(rules) == 1:
        return f"De valgte sædskifter kan ikke opfylde kravet om {rules[0]}."
    return "De valgte sædskifter kan ikke opfylde følgende regler samtidig.\n• " + "\n• ".join(
        rules
    )
