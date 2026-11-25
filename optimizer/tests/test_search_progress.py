import math
import unittest
from unittest.mock import patch

from ortools.sat.python import cp_model

from optimizer import search


class SearchProgressTests(unittest.TestCase):
    def setUp(self):
        self.progress = search._SearchProgress(units_per_dkk_year=1000)

    def solution(self, seconds, objective, bound=2200):
        with patch.multiple(
            cp_model.CpSolverSolutionCallback,
            wall_time=seconds,
            objective_value=objective,
            best_objective_bound=bound,
        ):
            self.progress.on_solution_callback()

    def test_improvement_before_ten_minutes_is_silent(self):
        with self.assertNoLogs(search.logger, level="INFO"):
            self.solution(599.99, 1000)

    def test_logs_each_improvement_from_ten_minutes_onward(self):
        self.solution(590, 500)

        with self.assertLogs(search.logger, level="INFO") as logs:
            self.solution(600, 1000)
            self.solution(610, 2000)

        self.assertEqual(
            [record.getMessage() for record in logs.records],
            [
                "elapsed_seconds=600.0 net_db2_dkk_per_year=1.0 optimality_gap_pct=120.00",
                "elapsed_seconds=610.0 net_db2_dkk_per_year=2.0 optimality_gap_pct=10.00",
            ],
        )

    def test_equal_or_worse_solutions_after_ten_minutes_are_silent(self):
        self.solution(590, 2000)

        with self.assertNoLogs(search.logger, level="INFO"):
            self.solution(600, 2000)
            self.solution(610, 1000)

    def test_late_first_solution_logs_without_a_finite_bound(self):
        with self.assertLogs(search.logger, level="INFO") as logs:
            self.solution(620, -1000, bound=math.inf)

        self.assertEqual(
            logs.records[0].getMessage(), "elapsed_seconds=620.0 net_db2_dkk_per_year=-1.0"
        )

    def test_quota_search_is_silent(self):
        model = cp_model.CpModel()
        model.maximize(model.new_bool_var("choose"))

        with patch.object(search, "PROGRESS_AFTER_SECONDS", 0), self.assertNoLogs(search.logger):
            search.search(
                model, 5, 0.003, require_solution=False, objective_units_per_dkk_year=1000
            )
