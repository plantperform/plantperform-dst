import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch
from uuid import uuid4

from app.data import optimization_store
from app.domain.optimization import DeliveryOutcome, ExecutionResult
from plantperform_fargate import worker
from plantperform_fargate.deadline import (
    OptimizationDeadlineError,
    check_deadline,
    remaining_time,
    solver_time_limit,
)


class LocalExecutionTests(unittest.TestCase):
    def test_transient_errors_retry_twice_then_stop_on_success(self):
        with (
            patch.object(
                worker,
                "execute",
                side_effect=[
                    ConnectionError(),
                    ConnectionError(),
                    ExecutionResult(DeliveryOutcome.ACK),
                ],
            ) as execute,
            patch.object(worker.time, "sleep") as sleep,
            patch.object(optimization_store, "recover_run") as recover,
            self.assertLogs(worker.logger, level="ERROR"),
        ):
            worker.execute_local("sim", "run")
        self.assertEqual(execute.call_count, 3)
        self.assertEqual(sleep.call_args_list, [call(60), call(60)])
        recover.assert_not_called()
        contexts = [args.args[2] for args in execute.call_args_list]
        self.assertEqual(len({id(context) for context in contexts}), 3)
        for context in contexts:
            self.assertGreater(context.get_remaining_time_in_millis(), 3_590_000)
            self.assertLessEqual(context.get_remaining_time_in_millis(), 3_600_000)

    def test_error_before_claim_does_not_leave_run_active_after_retry_limit(self):
        with (
            patch.object(
                worker, "execute", side_effect=ConnectionError("database unavailable")
            ) as execute,
            patch.object(worker.time, "sleep") as sleep,
            patch.object(optimization_store, "recover_run") as recover,
            self.assertLogs(worker.logger, level="ERROR"),
        ):
            worker.execute_local("sim", "run")
        self.assertEqual(execute.call_count, 3)
        self.assertEqual(sleep.call_args_list, [call(60), call(60)])
        recover.assert_called_once_with("sim", "run", interrupted=True)

    def test_local_deadline_uses_elapsed_time_and_bounds_solver_budget(self):
        with patch.object(worker.time, "monotonic", return_value=100) as clock:
            context = worker._LocalExecutionContext()
            token = remaining_time.set(context.get_remaining_time_in_millis)
            try:
                self.assertEqual(context.get_remaining_time_in_millis(), 3_600_000)
                clock.return_value = 3640
                self.assertEqual(solver_time_limit(3600), 30)
                clock.return_value = 3682
                with self.assertRaises(OptimizationDeadlineError):
                    check_deadline()
                clock.return_value = 3701
                self.assertEqual(context.get_remaining_time_in_millis(), 0)
            finally:
                remaining_time.reset(token)

    def test_solver_reserves_completion_time_and_rejects_exhausted_budget(self):
        for seconds in (0, 15, 20, 30):
            token = remaining_time.set(lambda seconds=seconds: seconds * 1000)
            try:
                with self.assertRaises(OptimizationDeadlineError):
                    solver_time_limit(3600)
            finally:
                remaining_time.reset(token)
        token = remaining_time.set(lambda: 3_600_000)
        try:
            self.assertEqual(solver_time_limit(3600), 3570)
        finally:
            remaining_time.reset(token)

    def test_both_modes_ignore_legacy_duration_and_publish_feasible_result_at_solver_limit(
        self,
    ):
        for kind in ("optimize", "yearly"):
            for legacy_duration in (1, 7200):
                with self.subTest(kind=kind, duration=legacy_duration):
                    self.assert_feasible_result(kind, legacy_duration)

    def assert_feasible_result(self, kind, legacy_duration):
        run_id = str(uuid4())
        row = {
            "kind": kind,
            "input_revision": 0,
            "requested_by": "test@example.com",
            "attempts": 0,
            "parameters": {
                "expected_revision": 0,
                "run_id": run_id,
                "time_limit_seconds": legacy_duration,
                "timeLimitSeconds": legacy_duration,
            },
        }
        remaining_ms = [70_000]
        context = SimpleNamespace(get_remaining_time_in_millis=lambda: remaining_ms[0])
        snapshot = MagicMock()
        snapshot.__getitem__.side_effect = lambda index: (
            SimpleNamespace(economics_snapshot=MagicMock()) if index == 0 else []
        )
        snapshot.fields_before = []
        snapshot.setup_fields = {}

        def solve(*args, **kwargs):
            self.assertEqual(args[2], 3600)
            self.assertEqual(solver_time_limit(args[2]), 40)
            # Simulate using the whole solver budget, leaving the publication reserve.
            remaining_ms[0] = 30_000
            return SimpleNamespace(
                output=SimpleNamespace(
                    status="FEASIBLE",
                    total_db2=1,
                    total_n_load_kg=0,
                    total_leaching_kg=0,
                    total_fen=0,
                    assignments=[],
                ),
                fields=[],
                selected_candidates={},
            )

        with (
            patch.object(optimization_store, "claim", return_value=(row, "farm", "token")),
            patch.object(optimization_store, "load_snapshot", return_value=snapshot),
            patch.object(optimization_store, "finish", return_value=True) as finish,
            patch.object(worker, "prepare", return_value=snapshot),
            patch.object(worker, "hydrate", return_value={}),
            patch.object(worker, "run_optimization", side_effect=solve) as average,
            patch.object(worker, "run_yearly_optimization", side_effect=solve) as yearly,
        ):
            worker.execute("sim", run_id, context)
        (yearly if kind == "yearly" else average).assert_called_once()
        finish.assert_called_once()
        self.assertNotIn("error", finish.call_args.kwargs)
        self.assertEqual(finish.call_args.kwargs["output"]["response"]["status"], "FEASIBLE")
        self.assertIsNone(remaining_time.get())
