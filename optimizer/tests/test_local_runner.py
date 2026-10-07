import unittest
from unittest.mock import call, patch

from app.data import optimization_store
from plantperform_optimizer import worker
from plantperform_optimizer.deadline import (
    OptimizationDeadlineError,
    check_deadline,
    remaining_time,
    solver_time_limit,
)


class LocalExecutionTests(unittest.TestCase):
    def test_transient_errors_retry_twice_then_stop_on_success(self):
        with (
            patch.object(
                worker, "execute", side_effect=[RuntimeError(), RuntimeError(), None]
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
            self.assertGreater(context.get_remaining_time_in_millis(), 890_000)
            self.assertLessEqual(context.get_remaining_time_in_millis(), 900_000)

    def test_error_before_claim_does_not_leave_run_active_after_retry_limit(self):
        with (
            patch.object(
                worker, "execute", side_effect=RuntimeError("database unavailable")
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
                self.assertEqual(context.get_remaining_time_in_millis(), 900_000)
                clock.return_value = 940
                self.assertEqual(solver_time_limit(100), 45)
                clock.return_value = 982
                with self.assertRaises(OptimizationDeadlineError):
                    check_deadline()
                clock.return_value = 1001
                self.assertEqual(context.get_remaining_time_in_millis(), 0)
            finally:
                remaining_time.reset(token)
