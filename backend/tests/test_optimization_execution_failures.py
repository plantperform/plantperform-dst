"""Terminal run state lives in the existing result, independently of SQS delivery."""

import importlib.util
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock, patch

from ortools.sat.python import cp_model
from sqlalchemy import update
from test_optimizer_lifecycle import CONTEXT, EMAIL, DatabaseTests

from app.data import optimization_store, simulation_store
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.domain.optimization import DeliveryOutcome, OptimizationLeaseActiveError
from optimizer import worker
from optimizer.consumer import Consumer

FAILURE = {"code": "OUT_OF_MEMORY", "message": "Optimeringen løb tør for hukommelse."}


class ExecutionFailureTests(DatabaseTests):
    def submit_and_execute(self):
        run = self.submit()
        worker.execute("sim", run.run_id, CONTEXT)
        self.assertEqual(self.row().status, "completed")

    def test_every_permanent_failure_clears_lease_and_retains_previous_output(self):
        self.submit_and_execute()
        previous = self.row().output
        for error, code in (
            (MemoryError(), "OUT_OF_MEMORY"),
            (RuntimeError("bug"), "WORKER_ERROR"),
            (ValueError("invalid"), "INVALID_INPUT"),
            (worker.OptimizationDeadlineError("timeout"), "TIMEOUT"),
        ):
            with self.subTest(code=code):
                run = self.submit()
                with (
                    patch.object(worker, "run_optimization", side_effect=error),
                    self.assertLogs(worker.logger, "ERROR"),
                ):
                    result = worker.execute("sim", run.run_id, CONTEXT, sqs_delivery=True)
                self.assertEqual(result.outcome, DeliveryOutcome.DEAD_LETTER)
                self.assertEqual(result.error["code"], code)
                self.assertEqual((self.row().status, self.row().attempts), ("failed", 1))
                self.assertIsNone(self.row().lease_token)
                self.assertIsNone(self.row().lease_expires_at)
                self.assertIsNotNone(self.row().finished_at)
                self.assertEqual(self.row().output, previous)
                self.assertEqual(self.row().error, result.error)
                self.assertEqual(
                    optimization_store.delivery_result("sim", run.run_id, "farm"), result
                )
                self.assertEqual(self.row().attempts, 1)

    def test_search_without_a_plan_is_saved_and_acknowledged_on_redelivery(self):
        self.submit_and_execute()
        previous = self.row().output
        budgets = ((7_200_000, "1 time"), (70_000, "den tilgængelige søgetid"))
        for kind in ("optimize", "yearly"):
            for remaining_ms, duration in budgets:
                with self.subTest(kind=kind, duration=duration):
                    run = self.submit(self.request(yearly=kind == "yearly"), kind)
                    context = Mock()
                    context.get_remaining_time_in_millis.return_value = remaining_ms

                    with patch.object(cp_model.CpSolver, "solve", return_value=cp_model.UNKNOWN):
                        first = worker.execute("sim", run.run_id, context, sqs_delivery=True)
                    redelivery = optimization_store.delivery_result("sim", run.run_id, "farm")

                    self.assertEqual(first.outcome, DeliveryOutcome.ACK)
                    self.assertEqual(redelivery, first)
                    self.assertEqual(self.row().status, "infeasible")
                    self.assertEqual(
                        self.row().error,
                        {
                            "code": "NO_SOLUTION_WITHIN_TIME_LIMIT",
                            "message": "Optimeringen fandt ingen løsning, der opfylder reglerne, "
                            f"inden for {duration}.",
                        },
                    )
                    self.assertEqual(self.row().output, previous)

    def test_feasible_assignments_survive_the_full_search_hour(self):
        solve = cp_model.CpSolver.solve
        context = Mock()

        def timed_solve(solver, model):
            self.assertEqual(solver.parameters.max_time_in_seconds, 3600)
            self.assertEqual(solve(solver, model), cp_model.OPTIMAL)
            context.get_remaining_time_in_millis.return_value -= 3_600_000
            return cp_model.FEASIBLE

        bound = property(lambda solver: 1.025 * solver.objective_value)
        for kind in ("optimize", "yearly"):
            with self.subTest(kind=kind):
                run = self.submit(self.request(yearly=kind == "yearly"), kind)
                context.get_remaining_time_in_millis.return_value = 7_200_000

                with (
                    patch.object(cp_model.CpSolver, "solve", timed_solve),
                    patch.object(cp_model.CpSolver, "best_objective_bound", bound),
                ):
                    delivery = worker.execute("sim", run.run_id, context, sqs_delivery=True)

                self.assertEqual(delivery.outcome, DeliveryOutcome.ACK)
                result = self.result()
                self.assertEqual(result.status, "completed")
                self.assertEqual(result.response.status, "FEASIBLE")
                self.assertEqual(len(result.response.assignments), 2)
                self.assertAlmostEqual(result.response.optimality_gap_pct, 2.5)

    def test_infeasible_run_preserves_the_previous_success_and_exposes_the_reason(self):
        self.submit_and_execute()
        previous = self.row().output
        run = self.submit()
        reason = "Marken er låst til et sædskifte, som ikke findes."

        with patch.object(
            worker, "run_optimization", side_effect=worker.OptimizationInfeasibleError(reason)
        ):
            worker.execute("sim", run.run_id, CONTEXT, sqs_delivery=True)

        result = simulation_store.get_result("farm", "sim", EMAIL, include_output=False)
        self.assertEqual(
            (result.status, result.error.code, result.error.message),
            ("infeasible", "INFEASIBLE", reason),
        )
        self.assertEqual(self.row().output, previous)

    def test_infeasible_redelivery_removes_the_source_message_without_a_dlq_send(self):
        run = self.submit()
        body = self.queue.send_message.call_args.kwargs["MessageBody"]
        with patch.object(
            worker,
            "run_optimization",
            side_effect=worker.OptimizationInfeasibleError("Ingen løsning"),
        ):
            worker.execute("sim", run.run_id, CONTEXT, sqs_delivery=True)
        self.queue.reset_mock()
        self.queue.receive_message.side_effect = [
            {"Messages": [{"Body": body, "MessageId": "source", "ReceiptHandle": "receipt"}]},
            {},
        ]
        with patch.dict(os.environ, {"OPTIMIZER_DLQ_URL": "test-dlq"}):
            consumer = Consumer(self.queue, Mock(), optimization_store, Mock(), Event())

        consumer.run()

        self.queue.delete_message.assert_called_once_with(
            QueueUrl="test-queue", ReceiptHandle="receipt"
        )
        self.queue.send_message.assert_not_called()

    def test_legacy_infeasibility_is_acknowledged_on_redelivery(self):
        run = self.submit()
        with self.sessions.begin() as session:
            session.execute(
                update(results)
                .where(results.c.run_id == run.run_id)
                .values(
                    status="failed", error={"code": "INFEASIBLE", "message": "Ingen mulig løsning."}
                )
            )

        delivery = optimization_store.delivery_result("sim", run.run_id, "farm")

        self.assertEqual(delivery.outcome, DeliveryOutcome.ACK)
        self.assertEqual(self.result().status, "infeasible")
        self.assertEqual(
            simulation_store.list_simulations("farm", EMAIL)[0].result.status, "infeasible"
        )

    def test_transient_errors_retry_only_until_third_execution(self):
        run = self.submit()
        self.assertIsNone(optimization_store.delivery_result("sim", run.run_id, "farm"))
        with (
            patch.object(worker, "run_optimization", side_effect=ConnectionError("connection")),
            self.assertLogs(worker.logger, "ERROR"),
        ):
            for attempt in (1, 2, 3):
                result = worker.execute("sim", run.run_id, CONTEXT, sqs_delivery=True)
                self.assertEqual(result.outcome, "retry" if attempt < 3 else "dead_letter")
                self.assertEqual(self.row().attempts, attempt)
                self.assertEqual(self.row().status, "queued" if attempt < 3 else "failed")
        for _ in range(5):
            redelivery = optimization_store.delivery_result("sim", run.run_id, "farm")
            self.assertEqual(redelivery.outcome, DeliveryOutcome.DEAD_LETTER)
            self.assertEqual(redelivery.error, result.error)
        self.assertEqual(self.row().attempts, 3)

    def test_stopped_child_can_fail_expired_lease_but_cannot_overwrite_new_owner(self):
        run = self.submit()
        row, _, token = optimization_store.claim("sim", run.run_id)
        with self.sessions.begin() as session:
            session.execute(
                update(results).values(lease_expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
        self.assertTrue(
            optimization_store.finish(
                "sim", run.run_id, token, row["input_revision"], error=FAILURE, stopped=True
            )
        )
        replacement = self.submit()
        claimed = optimization_store.claim("sim", replacement.run_id)
        self.assertFalse(
            optimization_store.finish("sim", run.run_id, token, 0, error=FAILURE, stopped=True)
        )
        self.assertFalse(
            optimization_store.finish(
                "sim", replacement.run_id, token, 0, error=FAILURE, stopped=True
            )
        )
        self.assertEqual(self.row().lease_token, claimed[2])

    def test_startup_failure_and_redelivery_cannot_take_an_active_lease(self):
        run = self.submit()
        optimization_store.claim("sim", run.run_id)
        with self.assertRaises(OptimizationLeaseActiveError):
            optimization_store.fail_unclaimed("sim", run.run_id, "farm", FAILURE)
        with self.assertRaises(OptimizationLeaseActiveError):
            optimization_store.delivery_result("sim", run.run_id, "farm")
        self.assertEqual((self.row().status, self.row().attempts), ("in_progress", 1))

    def test_unclaimed_failure_does_not_overwrite_existing_error_or_replacement(self):
        run = self.submit()
        self.assertEqual(
            optimization_store.fail_unclaimed("sim", run.run_id, "farm", FAILURE), FAILURE
        )
        self.assertEqual(
            optimization_store.fail_unclaimed("sim", run.run_id, "farm", {"code": "OTHER"}),
            FAILURE,
        )
        replacement = self.submit()
        self.assertIsNone(optimization_store.fail_unclaimed("sim", run.run_id, "farm", FAILURE))
        self.assertEqual((self.row().status, self.row().run_id), ("queued", replacement.run_id))

    def test_replaced_and_deleted_failed_runs_are_acknowledged(self):
        run = self.submit()
        optimization_store.fail_unclaimed("sim", run.run_id, "farm", FAILURE)
        replacement = self.submit()
        self.assertEqual(
            optimization_store.delivery_result("sim", run.run_id, "farm").outcome,
            DeliveryOutcome.ACK,
        )
        self.assertEqual((self.row().status, self.row().run_id), ("queued", replacement.run_id))
        simulation_store.delete_simulation("farm", "sim", EMAIL)
        self.assertEqual(
            optimization_store.delivery_result("sim", run.run_id, "farm").outcome,
            DeliveryOutcome.ACK,
        )

    def test_outdated_failed_run_is_acknowledged(self):
        run = self.submit()
        optimization_store.fail_unclaimed("sim", run.run_id, "farm", FAILURE)
        with self.sessions.begin() as session:
            session.execute(update(setups).values(revision=1))
        self.assertEqual(
            optimization_store.delivery_result("sim", run.run_id, "farm").outcome,
            DeliveryOutcome.ACK,
        )

    def test_completed_run_is_acknowledged_without_changing_saved_results(self):
        self.submit_and_execute()
        before = self.row()
        self.assertEqual(
            optimization_store.delivery_result("sim", before.run_id, "farm").outcome,
            DeliveryOutcome.ACK,
        )
        self.assertIsNone(optimization_store.fail_unclaimed("sim", before.run_id, "farm", FAILURE))
        self.assertEqual(self.row(), before)

    def test_wrong_farm_request_is_dead_lettered_without_mutating_the_run(self):
        run = self.submit()
        before = self.row()
        result = optimization_store.delivery_result("sim", run.run_id, "another-farm")
        self.assertEqual(result.outcome, DeliveryOutcome.DEAD_LETTER)
        self.assertEqual(result.error["code"], "INVALID_INPUT")
        self.assertEqual(self.row(), before)

    def test_manual_recovery_defaults_to_preview_and_guards_the_matching_claim(self):
        path = Path(__file__).parents[1] / "database/scripts/recover_optimization_oom.py"
        spec = importlib.util.spec_from_file_location("recover_oom", path)
        recovery = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(recovery)
        self.submit_and_execute()
        previous = self.row().output
        run = self.submit()
        row, _, token = optimization_store.claim("sim", run.run_id)
        args = SimpleNamespace(
            simulation_id="sim",
            run_id=run.run_id,
            execute=False,
            confirm_worker_stopped=False,
            expected_revision=row["input_revision"],
            expected_lease_token=token,
        )
        with patch.object(recovery, "SessionLocal", self.sessions), patch("builtins.print"):
            recovery.recover(args)
            self.assertEqual(self.row().status, "in_progress")
            args.execute = True
            with self.assertRaisesRegex(ValueError, "confirm-worker-stopped"):
                recovery.recover(args)
            args.confirm_worker_stopped = True
            args.expected_lease_token = "wrong"
            with self.assertRaisesRegex(ValueError, "lease changed"):
                recovery.recover(args)
            self.assertEqual(self.row().status, "in_progress")
            args.expected_lease_token = token
            recovery.recover(args)
            with self.assertRaisesRegex(ValueError, "lease changed"):
                recovery.recover(args)
        self.assertEqual(self.row().status, "failed")
        self.assertEqual(self.row().error["code"], "OUT_OF_MEMORY")
        self.assertEqual(self.row().output, previous)
        self.assertEqual(
            optimization_store.delivery_result("sim", run.run_id, "farm").error, FAILURE
        )
