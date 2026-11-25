"""CP-SAT search settings shared by the average and yearly models."""

import logging
import math
import os

from ortools.sat.python import cp_model

from app.domain.optimization import NO_SOLUTION_WITHIN_TIME_LIMIT
from optimizer.deadline import SOLVER_TIME_LIMIT_SECONDS, solver_time_limit

logger = logging.getLogger(__name__)
PROGRESS_AFTER_SECONDS = 10 * 60


class _SearchProgress(cp_model.CpSolverSolutionCallback):
    def __init__(self, units_per_dkk_year: int):
        super().__init__()
        self.units_per_dkk_year = units_per_dkk_year
        self.best = -math.inf

    def on_solution_callback(self):
        objective = self.objective_value
        if objective <= self.best:
            return
        self.best = objective
        elapsed = self.wall_time
        if elapsed >= PROGRESS_AFTER_SECONDS:
            gap = optimality_gap_pct(self)
            logger.info(
                "elapsed_seconds=%.1f net_db2_dkk_per_year=%s%s",
                elapsed,
                objective / self.units_per_dkk_year,
                f" optimality_gap_pct={gap:.2f}" if gap is not None else "",
            )


class OptimizationUnknownError(Exception):
    code = NO_SOLUTION_WITHIN_TIME_LIMIT


def search(
    model: cp_model.CpModel,
    seconds: float,
    relative_gap: float,
    *,
    require_solution: bool,
    objective_units_per_dkk_year: int | None = None,
) -> tuple[cp_model.CpSolver, cp_model.CpSolverStatus]:
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = int(os.getenv("OPTIMIZER_SOLVER_THREADS", "2"))
    # Presolve spends most of its time comparing near-identical rotation options.
    solver.parameters.cp_model_presolve = False
    solver.parameters.relative_gap_limit = relative_gap
    # A simulation job must publish a plan or a reason. Quota analysis manages
    # its own per-point budgets and can use an UNKNOWN point's objective bound.
    progress = None
    if require_solution:
        seconds = solver_time_limit(seconds)
        if objective_units_per_dkk_year is not None:
            progress = _SearchProgress(objective_units_per_dkk_year)
    solver.parameters.max_time_in_seconds = seconds
    status = solver.solve(model, progress)
    if status == cp_model.MODEL_INVALID:
        raise RuntimeError(f"Invalid optimization model: {solver.solution_info()}")
    if status == cp_model.UNKNOWN and require_solution:
        duration = "1 time" if seconds == SOLVER_TIME_LIMIT_SECONDS else "den tilgængelige søgetid"
        raise OptimizationUnknownError(
            f"Optimeringen fandt ingen løsning, der opfylder reglerne, inden for {duration}."
        )
    return solver, status


def optimality_gap_pct(
    solver: cp_model.CpSolver | cp_model.CpSolverSolutionCallback,
) -> float | None:
    """CP-SAT's relative gap in percent, using its original scaled objective."""
    bound, objective = solver.best_objective_bound, solver.objective_value
    if not (math.isfinite(bound) and math.isfinite(objective)):
        return None
    return 100 * abs(bound - objective) / max(1, abs(objective))
