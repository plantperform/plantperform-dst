"""Run against an isolated PostgreSQL database via OPTIMIZER_TEST_DATABASE_URL.

Each test creates and drops its own schema; no application tables are touched.
"""

import asyncio
import importlib.util
import json
import logging
import os
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import BackgroundTasks
from fastapi.testclient import TestClient
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    MetaData,
    Table,
    Text,
    create_engine,
    delete,
    event,
    func,
    inspect,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.data import optimization_store, repository
from app.data import simulation_store as store
from app.data.db import app_user_table, farm_member_table, farm_table, field_table, metadata
from app.data.db import simulation_field_candidates_table as caches
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.data.optimizer_inputs import optimizer_input
from app.domain.field import FieldRecord, UpdateFieldRequest
from app.domain.optimization import OptimizeSimulationRequest, YearlyOptimizeSimulationRequest
from app.domain.rotation_candidate import RotationCandidateEvaluation, SimulationFieldCandidates
from app.domain.simulation import CreateSimulationRequest, OptimizationConstraints, Simulation
from app.services.optimization import jobs
from plantperform_optimizer import handler as lambda_handler
from plantperform_optimizer import worker
from plantperform_optimizer.deadline import remaining_time

DATABASE = os.getenv("OPTIMIZER_TEST_DATABASE_URL")
EMAIL = "member@example.com"
CONTEXT = SimpleNamespace(get_remaining_time_in_millis=lambda: 900_000)


def candidate(value=100, variant="1"):
    return RotationCandidateEvaluation.model_validate(
        {
            "ref": {"saedskiftevariant": "1", "variant": variant, "n_norm_pct": "100"},
            "active_len": 1,
            "years": [
                {
                    "year": {"afgrode_kode": 1, "afgrode_navn": "Crop"},
                    "leaching_kg_n_ha": 10,
                    "leaching_detail": {},
                    "db_kr_ha": value,
                    "db_detail": {},
                }
            ]
            * 8,
            "avg_leaching_kg_n_ha": 10,
            "avg_db_kr_ha": value,
            "avg_fen": 2,
        }
    )


def field(field_id="field-b"):
    return FieldRecord(
        id=field_id,
        farm_id="farm",
        name=field_id,
        area_ha=2,
        retention=50,
        db2=0,
        n_load=0,
        leaching=0,
    )


def cached_data(session, simulation_id="sim"):
    return dict(
        session.execute(
            select(caches.c.field_id, caches.c.data).where(caches.c.simulation_id == simulation_id)
        ).all()
    )


def replace_cached_candidates(session, data, simulation_id="sim"):
    session.execute(delete(caches).where(caches.c.simulation_id == simulation_id))
    for field_id, payload in data.items():
        session.execute(
            caches.insert().values(
                id=str(uuid4()),
                simulation_id=simulation_id,
                field_id=field_id,
                data=payload,
                optimizer_input=optimizer_input(SimulationFieldCandidates.model_validate(payload)),
            )
        )


def large_candidates():
    # Across 17 fields this unselected detail alone exceeds the JSONB container
    # limit. Each field stays below it, and selected outputs remain small.
    unselected = candidate(0, "large")
    unselected.years[0].leaching_detail = {"calculation": "x" * (16 * 1024 * 1024)}
    return [candidate(), unselected]


@unittest.skipUnless(DATABASE, "Set OPTIMIZER_TEST_DATABASE_URL for PostgreSQL integration tests")
class DatabaseTests(unittest.TestCase):
    legacy = False

    def setUp(self):
        self.schema = "optimizer_test_" + uuid4().hex
        self.admin = create_engine(DATABASE)
        with self.admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        self.engine = create_engine(
            DATABASE, connect_args={"options": f"-csearch_path={self.schema}"}
        )
        self.addCleanup(self.cleanup_schema)
        self.sessions = sessionmaker(bind=self.engine)
        metadata.create_all(self.engine, tables=[farm_table, app_user_table, farm_member_table])
        self.enterContext(patch.object(repository, "SessionLocal", self.sessions))
        self.enterContext(patch.object(jobs, "SessionLocal", self.sessions))
        self.enterContext(patch.object(optimization_store, "SessionLocal", self.sessions))
        self.enterContext(patch.dict(os.environ, {"OPTIMIZER_QUEUE_URL": "test-queue"}))
        self.enterContext(patch.dict(os.environ, {"APP_ENV": "production"}))
        self.queue = self.enterContext(
            patch.object(jobs, "sqs_client", return_value=Mock())
        ).return_value
        with self.sessions.begin() as session:
            session.execute(farm_table.insert().values(id="farm", data={}))
            session.execute(app_user_table.insert().values(email=EMAIL, password_hash="test"))
            session.execute(farm_member_table.insert().values(farm_id="farm", email=EMAIL))
        if not self.legacy:
            metadata.create_all(self.engine, tables=[setups, results, caches, field_table])
            simulation = Simulation(id="sim", farm_id="farm", name="test", created_at="2026-10-06")
            fields = [field(), field("field-a")]
            cached = {
                f.id: SimulationFieldCandidates(
                    field_id=f.id, jbnr=5, candidates=[candidate(), candidate(200, "2")]
                ).model_dump(mode="json")
                for f in fields
            }
            with self.sessions.begin() as session:
                session.execute(
                    setups.insert().values(
                        id="sim",
                        farm_id="farm",
                        data=simulation.model_dump(mode="json"),
                        fields={f.id: store.split_field(f.model_dump(mode="json")) for f in fields},
                        field_order=[f.id for f in fields],
                    )
                )
                replace_cached_candidates(session, cached)
                session.execute(results.insert().values(simulation_id="sim"))

    def cleanup_schema(self):
        self.engine.dispose()
        with self.admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{self.schema}" CASCADE'))
        self.admin.dispose()

    def request(self, revision=0, yearly=False, **values):
        cls = YearlyOptimizeSimulationRequest if yearly else OptimizeSimulationRequest
        return cls(expected_revision=revision, run_id=uuid4(), time_limit_seconds=1, **values)

    def submit(self, request=None, kind="optimize"):
        return jobs.submit("farm", "sim", EMAIL, kind, request or self.request())

    def result(self):
        return store.get_result("farm", "sim", EMAIL)

    def edit(self, **values):
        return store.update_simulation_field(
            "farm", "sim", "field-b", UpdateFieldRequest(**values), EMAIL
        )

    def row(self):
        with self.sessions() as session:
            return session.execute(select(results)).one()


class CandidateStorageTests(DatabaseTests):
    def attach_farm_fields(self, count):
        with self.sessions.begin() as session:
            for i in range(count):
                source = field(f"source-{i}")
                session.execute(
                    field_table.insert().values(
                        id=source.id, farm_id="farm", data=source.model_dump(mode="json")
                    )
                )

    def create_request(self):
        return CreateSimulationRequest(
            name="new", saedskiftevarianter=["1"], n_norm_procenter=["100"]
        )

    def test_bulk_candidates_follow_field_order_and_missing_sets_are_empty(self):
        rows = store.list_simulation_field_candidates("farm", "sim", EMAIL)
        self.assertEqual([row.field_id for row in rows], ["field-b", "field-a"])
        self.assertIsNone(store.get_simulation_field_candidates("farm", "sim", "missing", EMAIL))
        self.assertIsNone(
            store.get_simulation_field_candidates("farm", "sim", "field-b", "outsider@example.com")
        )
        with self.sessions.begin() as session:
            replace_cached_candidates(session, {})
        self.assertEqual(store.list_simulation_field_candidates("farm", "sim", EMAIL), [])
        self.assertIsNone(store.get_simulation_field_candidates("farm", "sim", "field-b", EMAIL))

    def test_single_field_does_not_load_other_fields_or_simulations(self):
        other = Simulation(id="other", farm_id="farm", name="other", created_at="2026-10-06")
        with self.sessions.begin() as session:
            # An invalid unrelated payload makes accidental whole-cache reads fail.
            session.execute(
                update(caches).where(caches.c.field_id == "field-a").values(data={"invalid": True})
            )
            session.execute(
                setups.insert().values(
                    id="other", farm_id="farm", data=other.model_dump(mode="json")
                )
            )
            session.execute(results.insert().values(simulation_id="other"))
            replace_cached_candidates(
                session,
                {
                    "field-b": SimulationFieldCandidates(
                        field_id="field-b", jbnr=7, candidates=[candidate(999)]
                    ).model_dump(mode="json")
                },
                "other",
            )
        requested = store.get_simulation_field_candidates("farm", "sim", "field-b", EMAIL)
        self.assertEqual(requested.jbnr, 5)
        self.assertEqual([c.avg_db_kr_ha for c in requested.candidates], [100, 200])
        self.assertEqual(
            store.get_simulation_field_candidates("farm", "other", "field-b", EMAIL).jbnr, 7
        )

    def test_candidate_sets_are_unique_per_simulation_and_field(self):
        with self.assertRaises(IntegrityError), self.sessions.begin() as session:
            session.execute(
                caches.insert().values(
                    id="duplicate",
                    simulation_id="sim",
                    field_id="field-b",
                    data={},
                    optimizer_input={},
                )
            )
        with self.sessions() as session:
            self.assertEqual(len(cached_data(session)), 2)

    def test_deleting_simulation_cascades_to_candidates_and_result(self):
        self.assertTrue(store.delete_simulation("farm", "sim", EMAIL))
        with self.sessions() as session:
            self.assertEqual(cached_data(session), {})
            self.assertEqual(session.execute(select(results)).all(), [])

    def test_failed_creation_rolls_back_already_inserted_candidate_rows(self):
        self.attach_farm_fields(2)
        inserts = []

        def record_insert(connection, cursor, statement, parameters, context, executemany):
            if statement.startswith("INSERT INTO simulation_field_candidates"):
                inserts.append(statement)

        event.listen(self.engine, "after_cursor_execute", record_insert)
        try:
            with (
                patch.object(repository, "_registry_contexts_for_imk_ids", return_value={}),
                patch.object(
                    repository,
                    "generate_candidates_for_field",
                    side_effect=[[candidate()], RuntimeError("generation failed")],
                ),
                self.assertRaisesRegex(RuntimeError, "generation failed"),
            ):
                repository.create_simulation("farm", self.create_request(), EMAIL)
        finally:
            event.remove(self.engine, "after_cursor_execute", record_insert)
        self.assertEqual(len(inserts), 1)
        with self.sessions() as session:
            self.assertEqual(session.execute(select(setups.c.id)).scalars().all(), ["sim"])
            self.assertEqual(
                session.execute(select(results.c.simulation_id)).scalars().all(), ["sim"]
            )
            self.assertEqual(
                session.execute(select(func.count()).select_from(caches)).scalar_one(), 2
            )

    def test_creation_stores_more_than_jsonb_limit_in_separate_field_rows(self):
        self.attach_farm_fields(17)
        with (
            patch.object(repository, "_registry_contexts_for_imk_ids", return_value={}),
            patch.object(
                repository, "generate_candidates_for_field", return_value=large_candidates()
            ),
        ):
            simulation = repository.create_simulation("farm", self.create_request(), EMAIL)
        with self.sessions() as session:
            count, size = session.execute(
                select(func.count(), func.sum(func.octet_length(caches.c.data.cast(Text)))).where(
                    caches.c.simulation_id == simulation.id
                )
            ).one()
            order = session.execute(
                select(setups.c.field_order).where(setups.c.id == simulation.id)
            ).scalar_one()
            compact_size = session.execute(
                select(func.sum(func.octet_length(caches.c.optimizer_input.cast(Text)))).where(
                    caches.c.simulation_id == simulation.id
                )
            ).scalar_one()
        self.assertEqual(count, 17)
        self.assertGreater(size, 268_435_455)
        self.assertLess(compact_size, 1_000_000)
        self.assertEqual(len(order), 17)
        self.assertEqual(store.get_result("farm", simulation.id, EMAIL).status, "not_started")
        row = store.get_simulation_field_candidates("farm", simulation.id, order[0], EMAIL)
        self.assertEqual(len(row.candidates), 2)
        self.assertEqual(
            len(row.candidates[1].years[0].leaching_detail["calculation"]), 16 * 1024 * 1024
        )


class LifecycleTests(DatabaseTests):
    def deliver(self, run_id):
        event = {
            "Records": [
                {
                    "messageId": "job",
                    "body": json.dumps({"simulationId": "sim", "runId": run_id}),
                    "receiptHandle": "receipt",
                }
            ]
        }
        with (
            patch.object(lambda_handler, "initialize", return_value=worker),
            patch.object(lambda_handler, "sqs_client", return_value=self.queue),
        ):
            return lambda_handler.handler(event, CONTEXT)

    def test_sqs_retries_all_errors_and_preserves_exhausted_failure(self):
        self.submit_and_execute()
        before = self.row().output
        run = self.submit()
        with (
            patch.object(
                worker, "run_optimization", side_effect=RuntimeError("temporary")
            ) as solve,
            self.assertLogs(level="ERROR"),
        ):
            for attempt in range(1, 4):
                self.assertEqual(
                    self.deliver(run.run_id), {"batchItemFailures": [{"itemIdentifier": "job"}]}
                )
                row = self.row()
                self.assertEqual(row.attempts, attempt)
                self.assertEqual(row.status, "queued" if attempt < 3 else "failed")
                self.assertIsNone(row.lease_token)
                self.assertEqual(row.output, before)
            self.assertEqual(
                self.deliver(run.run_id), {"batchItemFailures": [{"itemIdentifier": "job"}]}
            )
        self.assertEqual(solve.call_count, 3)
        self.assertIsNotNone(self.row().finished_at)
        replacement = self.submit()
        self.assertEqual(self.deliver(run.run_id), {"batchItemFailures": []})
        self.assertEqual((self.row().run_id, self.row().status), (replacement.run_id, "queued"))

    def test_sqs_redelivery_reclaims_expired_lease_and_fences_old_worker(self):
        run = self.submit()
        old_row, _, old_token = optimization_store.claim("sim", run.run_id)
        with self.sessions.begin() as session:
            session.execute(
                update(results).values(lease_expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
        solve = worker.run_optimization

        def assert_old_worker_cannot_finish(*args, **kwargs):
            current = self.row()
            self.assertEqual((current.status, current.attempts), ("in_progress", 2))
            self.assertNotEqual(current.lease_token, old_token)
            self.assertFalse(
                optimization_store.finish(
                    "sim", run.run_id, old_token, old_row["input_revision"], output={"old": True}
                )
            )
            self.assertIsNone(optimization_store.load_snapshot("sim", run.run_id, old_token, 0))
            return solve(*args, **kwargs)

        with patch.object(worker, "run_optimization", side_effect=assert_old_worker_cannot_finish):
            self.assertEqual(self.deliver(run.run_id), {"batchItemFailures": []})
        self.assertEqual((self.row().status, self.row().attempts), ("completed", 2))

    def test_sqs_active_lease_defers_delivery_until_expiry_without_solving(self):
        run = self.submit()
        optimization_store.claim("sim", run.run_id)
        before = self.row()
        with patch.object(worker, "run_optimization") as solve:
            self.assertEqual(
                self.deliver(run.run_id), {"batchItemFailures": [{"itemIdentifier": "job"}]}
            )
        solve.assert_not_called()
        delay = self.queue.change_message_visibility.call_args.kwargs["VisibilityTimeout"]
        self.assertGreater(delay, 900)
        self.assertGreater(datetime.now(UTC) + timedelta(seconds=delay), before.lease_expires_at)
        self.assertEqual(self.row(), before)

    def test_sqs_expired_exhausted_lease_commits_failure_and_keeps_message(self):
        self.submit_and_execute()
        before = self.row().output
        run = self.submit()
        optimization_store.claim("sim", run.run_id)
        with self.sessions.begin() as session:
            session.execute(
                update(results).values(
                    attempts=3, lease_expires_at=datetime.now(UTC) - timedelta(seconds=1)
                )
            )
        with patch.object(worker, "run_optimization") as solve, self.assertLogs(level="ERROR"):
            self.assertEqual(
                self.deliver(run.run_id), {"batchItemFailures": [{"itemIdentifier": "job"}]}
            )
        solve.assert_not_called()
        row = self.row()
        self.assertEqual(
            (row.status, row.attempts, row.error["code"]), ("failed", 3, "WORKER_ERROR")
        )
        self.assertIsNone(row.lease_token)
        self.assertIsNotNone(row.finished_at)
        self.assertEqual(row.output, before)

    def test_sqs_lease_expiry_during_preparation_is_retried(self):
        run = self.submit()
        load = optimization_store.load_snapshot

        def expire_then_load(*args, **kwargs):
            with self.sessions.begin() as session:
                session.execute(
                    update(results).values(
                        lease_expires_at=datetime.now(UTC) - timedelta(seconds=1)
                    )
                )
            return load(*args, **kwargs)

        with (
            patch.object(optimization_store, "load_snapshot", side_effect=expire_then_load),
            patch.object(worker, "run_optimization") as solve,
        ):
            self.assertEqual(
                self.deliver(run.run_id), {"batchItemFailures": [{"itemIdentifier": "job"}]}
            )
        solve.assert_not_called()
        self.queue.change_message_visibility.assert_called_with(
            QueueUrl="test-queue", ReceiptHandle="receipt", VisibilityTimeout=60
        )
        self.assertEqual(self.deliver(run.run_id), {"batchItemFailures": []})
        self.assertEqual((self.row().status, self.row().attempts), ("completed", 2))

    def test_sqs_solver_failures_and_completed_results_are_acknowledged(self):
        for error in (worker.OptimizationInfeasibleError, worker.OptimizationDeadlineError):
            with self.subTest(error=error):
                run = self.submit()
                with patch.object(
                    worker, "run_optimization", side_effect=error("terminal")
                ) as solve:
                    self.assertEqual(self.deliver(run.run_id), {"batchItemFailures": []})
                    self.assertEqual(self.deliver(run.run_id), {"batchItemFailures": []})
                self.assertEqual((self.row().status, self.row().attempts), ("failed", 1))
                self.assertEqual(solve.call_count, 1)
        run = self.submit()
        self.assertEqual(self.deliver(run.run_id), {"batchItemFailures": []})
        self.assertEqual(self.deliver(run.run_id), {"batchItemFailures": []})
        self.assertEqual((self.row().status, self.row().attempts), ("completed", 1))
        self.queue.change_message_visibility.assert_not_called()

    def test_sqs_outdated_replaced_and_deleted_runs_are_acknowledged(self):
        old = self.submit()
        self.edit(name="changed")
        with patch.object(worker, "run_optimization") as solve:
            self.assertEqual(self.deliver(old.run_id), {"batchItemFailures": []})
            new = self.submit(self.request(1))
            self.assertEqual(self.deliver(old.run_id), {"batchItemFailures": []})
            self.assertEqual((self.row().run_id, self.row().status), (new.run_id, "queued"))
            store.delete_simulation("farm", "sim", EMAIL)
            self.assertEqual(self.deliver(new.run_id), {"batchItemFailures": []})
        solve.assert_not_called()
        self.queue.change_message_visibility.assert_not_called()

    def test_production_requires_queue_even_with_local_background_tasks(self):
        with patch.dict(os.environ, {"APP_ENV": "PRODUCTION"}):
            os.environ.pop("OPTIMIZER_QUEUE_URL", None)
            with self.assertRaises(jobs.QueueUnavailableError):
                jobs.submit(
                    "farm",
                    "sim",
                    EMAIL,
                    "optimize",
                    self.request(),
                    background_tasks=BackgroundTasks(),
                )
        self.assertEqual(self.result().status, "not_started")
        self.queue.send_message.assert_not_called()

    def test_three_attempt_limit_and_exhausted_queued_runs_preserve_output(self):
        self.submit_and_execute()
        before = self.row().output
        run = self.submit()
        with (
            patch.object(
                worker, "run_optimization", side_effect=RuntimeError("temporary")
            ) as solve,
            self.assertLogs(worker.logger, level="ERROR"),
        ):
            for attempt in (1, 2):
                with self.assertRaises(RuntimeError):
                    worker.execute("sim", run.run_id, CONTEXT)
                self.assertEqual((self.row().attempts, self.result().status), (attempt, "queued"))
            worker.execute("sim", run.run_id, CONTEXT)
            self.assertEqual((self.row().attempts, self.result().status), (3, "failed"))
            self.assertIsNotNone(self.result().finished_at)
            worker.execute("sim", run.run_id, CONTEXT)
            self.assertEqual(solve.call_count, 3)
        self.assertEqual(self.row().output, before)
        for attempts in (3, 4, 5):
            with self.subTest(attempts=attempts):
                run = self.submit()
                with self.sessions.begin() as session:
                    session.execute(update(results).values(attempts=attempts))
                with patch.object(worker, "run_optimization") as solve:
                    worker.execute("sim", run.run_id, CONTEXT)
                solve.assert_not_called()
                self.assertEqual((self.row().attempts, self.result().status), (attempts, "failed"))
                self.assertEqual(self.row().output, before)
        self.assertIsNone(remaining_time.get())

    def test_authorization_revision_and_submission_envelope(self):
        with self.assertRaises(jobs.SimulationNotFoundError):
            jobs.submit("farm", "sim", "outsider@example.com", "optimize", self.request())
        with self.assertRaises(jobs.SubmissionConflictError):
            self.submit(self.request(1))
        request = self.request()
        accepted = self.submit(request)
        self.assertEqual((accepted.status, accepted.run_id), ("queued", str(request.run_id)))
        envelope = json.loads(self.queue.send_message.call_args.kwargs["MessageBody"])
        self.assertEqual(envelope, {"simulationId": "sim", "runId": accepted.run_id})
        self.assertEqual(self.queue.send_message.call_args.kwargs["DelaySeconds"], 0)
        self.assertEqual(accepted.parameters["timeLimitSeconds"], 1)

    def test_publication_uses_metadata_and_commits_queued_before_sending(self):
        self.submit_and_execute()
        queries = []

        def observe(connection, cursor, statement, parameters, context, executemany):
            queries.append(statement)

        def send(**kwargs):
            reads = [query for query in queries if query.startswith("SELECT")]
            self.assertTrue(reads)
            self.assertFalse(any("simulation_result.output" in query for query in reads))
            self.assertFalse(any("simulation.data" in query for query in reads))
            with self.sessions() as session:
                row = session.execute(select(results.c.status, results.c.run_id)).one()
            self.assertEqual(row.status, "queued")
            self.assertEqual(row.run_id, json.loads(kwargs["MessageBody"])["runId"])
            return {"MessageId": "published"}

        event.listen(self.engine, "before_cursor_execute", observe)
        try:
            self.queue.send_message.side_effect = send
            accepted = self.submit()
        finally:
            event.remove(self.engine, "before_cursor_execute", observe)
        self.assertEqual(accepted.status, "queued")
        self.assertIsNotNone(accepted.response)

    def test_poll_sees_in_progress_while_candidates_are_loading(self):
        run = self.submit()
        loading, release = Event(), Event()
        original = optimization_store._candidates

        def blocked_load(*args, **kwargs):
            loading.set()
            if not release.wait(10):
                raise TimeoutError("candidate load was not released")
            return original(*args, **kwargs)

        with (
            patch.object(optimization_store, "_candidates", side_effect=blocked_load),
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            execution = executor.submit(worker.execute, "sim", run.run_id, CONTEXT)
            try:
                self.assertTrue(loading.wait(5))
                polled = store.get_result("farm", "sim", EMAIL, include_output=False)
                self.assertEqual(polled.status, "in_progress")
                self.assertIsNotNone(polled.started_at)
                self.assertEqual(self.row().attempts, 1)
            finally:
                release.set()
            execution.result(timeout=10)
        self.assertEqual(self.result().status, "completed")

    def test_edit_during_preparation_skips_solver_and_preserves_replacement(self):
        run = self.submit()
        original = optimization_store.load_snapshot
        replacement = None

        def edit_then_load(*args):
            nonlocal replacement
            self.edit(name="new inputs")
            replacement = self.submit(self.request(1))
            return original(*args)

        with (
            patch.object(optimization_store, "load_snapshot", side_effect=edit_then_load),
            patch.object(worker, "run_optimization") as solve,
        ):
            worker.execute("sim", run.run_id, CONTEXT)
        solve.assert_not_called()
        self.assertEqual(
            (self.result().status, self.result().run_id), ("queued", replacement.run_id)
        )
        worker.execute("sim", replacement.run_id, CONTEXT)
        self.assertEqual(self.result().status, "completed")

    def test_deletion_during_preparation_skips_solver(self):
        run = self.submit()
        original = optimization_store.load_snapshot

        def delete_then_load(*args):
            store.delete_simulation("farm", "sim", EMAIL)
            return original(*args)

        with (
            patch.object(optimization_store, "load_snapshot", side_effect=delete_then_load),
            patch.object(worker, "run_optimization") as solve,
        ):
            worker.execute("sim", run.run_id, CONTEXT)
        solve.assert_not_called()
        self.assertIsNone(self.result())

    def test_snapshot_requires_matching_unexpired_lease(self):
        run = self.submit()
        row, _, token = optimization_store.claim("sim", run.run_id)
        self.assertIsNone(optimization_store.claim("sim", run.run_id))
        self.assertIsNone(optimization_store.load_snapshot("sim", run.run_id, "other", 0))
        self.assertIsNone(optimization_store.load_snapshot("sim", "other", token, 0))
        self.assertIsNotNone(optimization_store.load_snapshot("sim", run.run_id, token, 0))
        with self.sessions.begin() as session:
            session.execute(
                update(results).values(lease_expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
        self.assertIsNone(
            optimization_store.load_snapshot("sim", run.run_id, token, row["input_revision"])
        )

    def test_snapshot_loading_failures_use_bounded_retries_and_retain_output(self):
        self.submit_and_execute()
        before = self.row().output
        run = self.submit()
        with (
            patch.object(optimization_store, "_candidates", side_effect=RuntimeError("temporary")),
            patch.object(worker, "run_optimization") as solve,
            self.assertLogs(worker.logger, level="ERROR"),
        ):
            for attempt in (1, 2):
                with self.assertRaises(RuntimeError):
                    worker.execute("sim", run.run_id, CONTEXT)
                row = self.row()
                self.assertEqual((row.status, row.attempts), ("queued", attempt))
                self.assertIsNone(row.lease_token)
            worker.execute("sim", run.run_id, CONTEXT)
        solve.assert_not_called()
        self.assertEqual((self.result().status, self.row().attempts), ("failed", 3))
        self.assertEqual(self.row().output, before)
        self.assertIsNone(remaining_time.get())

    def test_lightweight_poll_excludes_saved_output(self):
        self.submit_and_execute()
        summary = store.get_result("farm", "sim", EMAIL, include_output=False)
        self.assertEqual(summary.status, "completed")
        self.assertEqual(summary.result_revision, 0)
        self.assertIsNone(summary.response)
        self.assertEqual(summary.selected_candidates, {})
        self.assertEqual(summary.fields_before, [])
        self.assertIsNotNone(self.result().response)

    def test_retry_idempotency_and_conflicting_parameters(self):
        request = self.request()
        self.submit(request)
        self.submit(request)
        self.assertEqual(self.queue.send_message.call_count, 1)
        with self.assertRaises(jobs.SubmissionConflictError):
            self.submit(request.model_copy(update={"time_limit_seconds": 2}))
        with self.assertRaises(jobs.SubmissionConflictError):
            self.submit()

    def test_concurrent_submissions_only_one_wins(self):
        def send():
            try:
                return self.submit().status
            except jobs.SubmissionConflictError:
                return "conflict"

        with ThreadPoolExecutor(max_workers=2) as executor:
            self.assertCountEqual(
                list(executor.map(lambda _: send(), range(2))), ["queued", "conflict"]
            )
        self.assertEqual(self.queue.send_message.call_count, 1)

    def test_queue_failure_preserves_successful_output(self):
        self.submit_and_execute()
        before = self.row().output
        self.queue.send_message.side_effect = RuntimeError("unavailable")
        with self.assertRaises(jobs.QueueUnavailableError):
            self.submit()
        self.assertEqual(self.result().status, "failed")
        self.assertEqual(self.row().output, before)
        self.assertEqual(self.row().result_revision, 0)

    def test_ambiguous_send_cannot_fail_claimed_worker(self):
        def send(**kwargs):
            envelope = json.loads(kwargs["MessageBody"])
            optimization_store.claim(envelope["simulationId"], envelope["runId"])
            raise RuntimeError("response lost")

        self.queue.send_message.side_effect = send
        self.assertEqual(self.submit().status, "in_progress")

    def test_duplicate_claim_and_old_worker_after_replacement(self):
        old = self.submit()
        row, _, lease = optimization_store.claim("sim", old.run_id)
        self.assertIsNone(optimization_store.claim("sim", old.run_id))
        self.edit(name="edited")
        self.assertEqual(self.result().status, "outdated")
        new = self.submit(self.request(1))
        self.assertFalse(
            optimization_store.finish(
                "sim", old.run_id, lease, row["input_revision"], output={"old": True}
            )
        )
        self.assertEqual((self.result().status, self.result().run_id), ("queued", new.run_id))
        self.assertIsNone(optimization_store.claim("sim", old.run_id))

    def test_edit_before_claim_and_deletion(self):
        old = self.submit()
        self.edit(name="changed")
        self.assertIsNone(optimization_store.claim("sim", old.run_id))
        new = self.submit(self.request(1))
        claimed = optimization_store.claim("sim", new.run_id)
        store.delete_simulation("farm", "sim", EMAIL)
        self.assertFalse(optimization_store.finish("sim", new.run_id, claimed[2], 1, output={}))
        self.assertIsNone(optimization_store.claim("sim", new.run_id))

    def test_expired_lease_and_recovery_are_run_guarded(self):
        run = self.submit()
        claimed = optimization_store.claim("sim", run.run_id)
        with self.sessions.begin() as session:
            session.execute(
                update(results).values(lease_expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
        self.assertFalse(optimization_store.finish("sim", run.run_id, claimed[2], 0, output={}))
        optimization_store.recover_run("sim", run.run_id)
        self.assertEqual(self.result().status, "failed")
        replacement = self.submit()
        optimization_store.recover_run("sim", run.run_id, dead_letter=True)
        self.assertEqual(self.result().run_id, replacement.run_id)
        self.assertEqual(self.result().status, "queued")
        optimization_store.recover_run("sim", replacement.run_id, dead_letter=True)
        self.assertEqual(self.result().status, "failed")

    def test_abandoned_publication(self):
        run = self.submit()
        with self.sessions.begin() as session:
            session.execute(
                update(results).values(
                    published_at=None, queued_at=datetime.now(UTC) - timedelta(minutes=2)
                )
            )
        optimization_store.recover_run("sim", run.run_id)
        self.assertEqual(self.result().status, "failed")

    def test_transient_retry_preserves_previous_success(self):
        self.submit_and_execute()
        before = self.row().output
        run = self.submit()
        with patch.object(worker, "run_optimization", side_effect=RuntimeError("temporary")):
            with self.assertRaises(RuntimeError):
                worker.execute("sim", run.run_id, CONTEXT)
        self.assertEqual(self.result().status, "queued")
        self.assertEqual(self.row().output, before)
        worker.execute("sim", run.run_id, CONTEXT)
        self.assertEqual(self.result().status, "completed")
        self.assertEqual(self.row().attempts, 2)

    def test_deadline_failure_and_result_transaction_rolls_back(self):
        run = self.submit()
        worker.execute(
            "sim", run.run_id, SimpleNamespace(get_remaining_time_in_millis=lambda: 10_000)
        )
        self.assertEqual((self.result().status, self.result().error.code), ("failed", "TIMEOUT"))
        run = self.submit()
        claimed = optimization_store.claim("sim", run.run_id)
        with self.assertRaises(TypeError):
            optimization_store.finish(
                "sim", run.run_id, claimed[2], 0, output={"invalid": object()}
            )
        self.assertEqual(self.result().status, "in_progress")
        self.assertIsNone(self.row().output)

    def submit_and_execute(self, yearly=False):
        run = self.submit(self.request(yearly=yearly), "yearly" if yearly else "optimize")
        worker.execute("sim", run.run_id, CONTEXT)
        return run

    def test_average_solver_persistence_and_candidates_unchanged(self):
        with self.sessions() as session:
            before = (session.execute(select(setups.c.fields)).scalar_one(), cached_data(session))
        self.submit_and_execute()
        result = self.result()
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.response.objective_db2, 800)
        self.assertEqual([f.id for f in result.response.fields], ["field-b", "field-a"])
        self.assertEqual(result.result_revision, 0)
        self.assertEqual(result.fields_before[0].db2, 0)
        self.assertEqual(
            store.get_simulation_field_candidate_detail(
                "farm", "sim", "field-b", EMAIL
            ).avg_db_kr_ha,
            200,
        )
        with self.sessions() as session:
            self.assertEqual(
                (session.execute(select(setups.c.fields)).scalar_one(), cached_data(session)),
                before,
            )

    def test_yearly_solver_keeps_manual_inputs_and_yearly_totals(self):
        c = candidate(50)
        manual = UpdateFieldRequest(
            crop_rotation=[y.year for y in c.years[:1]],
            rotation_id=c.ref.to_id(),
            allowed_rotation_ids=[c.ref.to_id()],
            db2=100,
            n_load=10,
            leaching=20,
            fen=4,
        )
        store.save_manual_rotation("farm", "sim", "field-b", c, manual, EMAIL, expected_revision=0)
        with self.sessions() as session:
            locked = session.execute(select(setups.c.fields)).scalar_one()["field-b"]
        self.assertEqual(locked["fixed_candidate"]["avg_db_kr_ha"], 50)
        run = self.submit(self.request(1, yearly=True), "yearly")
        worker.execute("sim", run.run_id, CONTEXT)
        result = self.result()
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.response.fields[0].db2, 100)
        self.assertEqual(len(result.response.total_db2_by_year), 8)
        self.assertTrue(all(v == 500 for v in result.response.total_db2_by_year.values()))
        self.assertEqual(
            store.get_simulation_field_candidate_detail(
                "farm", "sim", "field-b", EMAIL
            ).avg_db_kr_ha,
            50,
        )
        with self.sessions() as session:
            self.assertEqual(
                session.execute(select(setups.c.fields)).scalar_one()["field-b"], locked
            )
        self.edit(area_ha=4, retention=25)
        self.assertEqual((self.edit(name="renamed").db2, self.result().status), (200, "outdated"))

    def test_concurrent_jsonb_edits_and_constraints(self):
        def edit(values):
            self.edit(**values)

        with ThreadPoolExecutor(max_workers=2) as executor:
            list(executor.map(edit, [{"name": "concurrent"}, {"retention": 75}]))
        updated = store.get_simulation_field("farm", "sim", "field-b", EMAIL)
        self.assertEqual((updated.name, updated.retention), ("concurrent", 75))
        self.assertEqual(store.get_simulation("farm", "sim", EMAIL).revision, 2)
        self.submit(self.request(2))
        store.update_simulation_constraints(
            "farm", "sim", OptimizationConstraints(min_fen=1), EMAIL
        )
        self.assertEqual(self.result().status, "outdated")

    def test_yearly_shift_is_saved_only_in_result(self):
        base = candidate().model_copy(update={"active_len": 2})
        shifted = candidate(300, "1+start2").model_copy(
            update={"active_len": 2, "base_ref": base.ref, "start_year": 2}
        )
        with self.sessions.begin() as session:
            data = cached_data(session)
            for row in data.values():
                row["candidates"] = [base.model_dump(mode="json")]
            replace_cached_candidates(session, data)
        with patch(
            "plantperform_optimizer.orchestrator.candidate_evaluator.evaluate_with_overrides",
            return_value=shifted,
        ):
            self.submit_and_execute(yearly=True)
        self.assertEqual(self.result().response.objective_db2, 1200)
        self.assertEqual(self.result().selected_candidates["field-b"].start_year, 2)
        self.assertEqual(
            store.get_simulation_field_candidate_detail("farm", "sim", "field-b", EMAIL).start_year,
            2,
        )
        with self.sessions() as session:
            self.assertEqual(cached_data(session), data)

    def test_unlock_preserves_manual_choice_without_successful_run(self):
        c = candidate()
        manual = UpdateFieldRequest(
            rotation_id=c.ref.to_id(),
            crop_rotation=[c.years[0].year],
            allowed_rotation_ids=[c.ref.to_id()],
            db2=200,
            n_load=10,
            leaching=20,
            fen=4,
        )
        store.save_manual_rotation("farm", "sim", "field-b", c, manual, EMAIL, 0)
        unlocked = self.edit(allowed_rotation_ids=[])
        self.assertEqual(unlocked.db2, 200)
        self.assertEqual(
            store.get_simulation_field("farm", "sim", "field-b", EMAIL).rotation_id, c.ref.to_id()
        )
        self.assertEqual(
            store.get_simulation_field_candidate_detail("farm", "sim", "field-b", EMAIL).ref, c.ref
        )

    def test_manual_unlock_after_previous_output_and_immutable_cache(self):
        self.submit_and_execute()
        with self.sessions() as session:
            cache = cached_data(session)
        c = candidate(150, "manual")
        manual = UpdateFieldRequest(
            rotation_id=c.ref.to_id(),
            crop_rotation=[c.years[0].year],
            allowed_rotation_ids=[c.ref.to_id()],
            db2=300,
            n_load=10,
            leaching=20,
            fen=4,
        )
        store.save_manual_rotation("farm", "sim", "field-b", c, manual, EMAIL, 0)
        self.edit(allowed_rotation_ids=[])
        self.assertEqual(
            store.get_simulation_field("farm", "sim", "field-b", EMAIL).rotation_id, c.ref.to_id()
        )
        self.assertEqual(
            store.get_simulation_field_candidate_detail("farm", "sim", "field-b", EMAIL).ref, c.ref
        )
        run = self.submit(self.request(2))
        worker.execute("sim", run.run_id, CONTEXT)
        self.assertEqual(self.result().status, "completed")
        self.assertEqual(
            store.get_simulation_field("farm", "sim", "field-b", EMAIL).rotation_id, "1:2:100"
        )
        with self.sessions() as session:
            self.assertEqual(cached_data(session), cache)

    def test_large_candidate_document(self):
        import resource

        # About 30 MB of JSON across 16 fields, while selected outputs stay small.
        fields = [field(f"large-{i}") for i in range(16)]
        evaluations = [candidate(i, str(i)) for i in range(100)]
        for evaluation in evaluations:
            for year in evaluation.years:
                year.leaching_detail = {"calculation": "x" * 2000}
        cached = {
            f.id: SimulationFieldCandidates(
                field_id=f.id, jbnr=5, candidates=evaluations
            ).model_dump(mode="json")
            for f in fields
        }
        logical_bytes = len(json.dumps(cached))
        self.assertGreater(logical_bytes, 25_000_000)
        with self.sessions.begin() as session:
            session.execute(
                update(setups).values(
                    fields={f.id: store.split_field(f.model_dump(mode="json")) for f in fields},
                    field_order=[f.id for f in fields],
                )
            )
            replace_cached_candidates(session, cached)
        started = time.monotonic()
        self.submit_and_execute()
        self.assertEqual(self.result().status, "completed")
        self.assertEqual(len(self.result().response.fields), 16)
        logging.getLogger(__name__).warning(
            "large_document logical_mb=%.1f runtime_seconds=%.2f peak_rss_mb=%.1f",
            logical_bytes / 1_000_000,
            time.monotonic() - started,
            resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
        )

    def test_manual_revision_conflict_is_atomic(self):
        self.edit(name="newer")
        with self.assertRaises(store.SetupRevisionConflictError):
            store.save_manual_rotation(
                "farm", "sim", "field-b", candidate(), UpdateFieldRequest(name="old"), EMAIL, 0
            )
        self.assertEqual(store.get_simulation_field("farm", "sim", "field-b", EMAIL).name, "newer")


class LocalLifecycleTests(DatabaseTests):
    def setUp(self):
        super().setUp()
        self.enterContext(patch.dict(os.environ, {"APP_ENV": "development"}))
        self.background_tasks = BackgroundTasks()
        from app.services.optimization import local

        self.local = local
        self.addCleanup(self.close_optimizer)

    def close_optimizer(self):
        if self.local._runtime is not None:
            self.local._runtime.close()

    def submit(self, request=None, kind="optimize"):
        return jobs.submit(
            "farm",
            "sim",
            EMAIL,
            kind,
            request or self.request(),
            background_tasks=self.background_tasks,
        )

    def run_background(self):
        tasks = self.background_tasks
        self.background_tasks = BackgroundTasks()
        asyncio.run(tasks())

    def test_readiness_and_http_202_do_not_wait_for_warmup(self):
        from app import main
        from app.auth import AuthenticatedUser, current_user

        loading, release = Event(), Event()

        def initialize():
            loading.set()
            if not release.wait(10):
                raise TimeoutError("warmup was not released")
            return worker.execute_local

        async def run():
            async with main.lifespan(main.app):
                self.assertTrue(await asyncio.to_thread(loading.wait, 3))
                runtime = self.local._runtime
                self.assertFalse(runtime.initialized.done())
                body = json.dumps(self.request().model_dump(mode="json")).encode()
                sent = []
                responded = asyncio.Event()

                async def receive():
                    return {"type": "http.request", "body": body, "more_body": False}

                async def send(message):
                    sent.append(message)
                    if message["type"] == "http.response.body":
                        responded.set()

                scope = {
                    "type": "http",
                    "asgi": {"version": "3.0"},
                    "http_version": "1.1",
                    "method": "POST",
                    "scheme": "http",
                    "root_path": "",
                    "path": "/api/v0/farms/farm/simulations/sim/optimize",
                    "query_string": b"",
                    "headers": [(b"content-type", b"application/json")],
                    "client": ("127.0.0.1", 1234),
                    "server": ("localhost", 80),
                }
                request = asyncio.create_task(main.app(scope, receive, send))
                try:
                    await asyncio.wait_for(responded.wait(), 3)
                    self.assertEqual(sent[0]["status"], 202)
                    self.assertEqual(json.loads(sent[1]["body"])["status"], "queued")
                    self.assertEqual(self.row().attempts, 0)
                    self.assertFalse(runtime.initialized.done())
                finally:
                    release.set()
                    await asyncio.wait_for(request, 10)
                self.assertEqual(self.result().status, "completed")
            self.assertIsNone(self.local._runtime)
            self.assertTrue(all(not thread.is_alive() for thread in runtime.executor._threads))

        with (
            patch.object(self.local, "_initialize", side_effect=initialize),
            patch.dict(
                main.app.dependency_overrides,
                {current_user: lambda: AuthenticatedUser(email=EMAIL)},
            ),
        ):
            try:
                asyncio.run(run())
            finally:
                release.set()

    def test_initialization_failure_preserves_output_and_only_fails_matching_queued_run(self):
        self.submit()
        self.run_background()
        before = self.row().output
        self.close_optimizer()
        with (
            patch.object(self.local, "_initialize", side_effect=ImportError("worker unavailable")),
            self.assertLogs(self.local.logger, level="ERROR"),
        ):
            old = self.submit()
            self.edit(name="updated")
            replacement = self.submit(self.request(1))
            self.local.execute_local_when_ready("sim", old.run_id)
            self.assertEqual((self.row().run_id, self.row().status), (replacement.run_id, "queued"))
            self.run_background()
        self.assertEqual((self.row().status, self.row().attempts), ("failed", 0))
        self.assertEqual(self.row().output, before)
        self.assertEqual(self.result().error.code, "WORKER_ERROR")

    def test_initialization_failure_cannot_fail_claimed_or_deleted_runs(self):
        run = self.submit()
        optimization_store.claim("sim", run.run_id)
        optimization_store.fail_queued_run("sim", run.run_id)
        self.assertEqual(self.row().status, "in_progress")
        store.delete_simulation("farm", "sim", EMAIL)
        optimization_store.fail_queued_run("sim", run.run_id)

    def test_non_production_modes_ignore_configured_and_missing_queues(self):
        for mode in (None, "", "development", "test", "staging", "DEVELOPMENT"):
            for queue in (None, "unused-queue"):
                with self.subTest(mode=mode, queue=queue), patch.dict(os.environ):
                    if mode is None:
                        os.environ.pop("APP_ENV", None)
                    else:
                        os.environ["APP_ENV"] = mode
                    if queue is None:
                        os.environ.pop("OPTIMIZER_QUEUE_URL", None)
                    else:
                        os.environ["OPTIMIZER_QUEUE_URL"] = queue
                    request = self.request()
                    accepted = self.submit(request)
                    self.assertEqual(
                        (accepted.status, accepted.run_id), ("queued", str(request.run_id))
                    )
                    self.assertEqual(self.row().attempts, 0)
                    self.assertIsNotNone(self.row().published_at)
                    self.assertEqual(len(self.background_tasks.tasks), 1)
                    self.run_background()
                    self.assertEqual(self.result().status, "completed")
                    self.assertEqual(self.result().response.objective_db2, 800)
        self.queue.send_message.assert_not_called()

    def test_concurrent_duplicate_submissions_register_only_one_task(self):
        request = self.request()
        with ThreadPoolExecutor(max_workers=2) as executor:
            accepted = list(executor.map(lambda _: self.submit(request), range(2)))
        self.assertEqual([run.status for run in accepted], ["queued", "queued"])
        self.assertEqual(len(self.background_tasks.tasks), 1)
        with self.assertRaises(jobs.SubmissionConflictError):
            self.submit(request.model_copy(update={"time_limit_seconds": 2}))
        with self.assertRaises(jobs.SubmissionConflictError):
            self.submit()
        self.run_background()
        self.assertEqual(self.row().attempts, 1)

    def test_both_endpoints_return_202_and_poll_saved_results(self):
        from app.auth import AuthenticatedUser, current_user
        from app.main import app

        with (
            patch.dict(
                app.dependency_overrides, {current_user: lambda: AuthenticatedUser(email=EMAIL)}
            ),
            TestClient(app) as client,
        ):
            for yearly in (False, True):
                path = "/api/v0/farms/farm/simulations/sim"
                request = self.request(yearly=yearly)
                response = client.post(
                    path + ("/optimize-yearly" if yearly else "/optimize"),
                    json=request.model_dump(mode="json"),
                )
                self.assertEqual(response.status_code, 202)
                self.assertEqual(response.json()["status"], "queued")
                summary = client.get(path + "/result?include_output=false")
                self.assertEqual(summary.status_code, 200)
                self.assertEqual(summary.json()["status"], "completed")
                self.assertIsNone(summary.json()["response"])
                saved = client.get(path + "/result").json()
                self.assertEqual(saved["response"]["objectiveDb2"], 800)
                self.assertEqual(len(saved["fieldsBefore"]), 2)
                if yearly:
                    self.assertEqual(len(saved["response"]["totalDb2ByYear"]), 8)
            with patch.dict(os.environ, {"APP_ENV": "production"}):
                os.environ.pop("OPTIMIZER_QUEUE_URL", None)
                response = client.post(
                    path + "/optimize", json=self.request().model_dump(mode="json")
                )
                self.assertEqual(response.status_code, 503)
        self.queue.send_message.assert_not_called()

    def test_two_transient_failures_then_success_stop_at_third_attempt(self):
        original = worker.run_optimization
        calls = 0

        def solve(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls < 3:
                raise RuntimeError("temporary")
            return original(*args, **kwargs)

        run = self.submit()
        with (
            patch.object(worker, "run_optimization", side_effect=solve) as solver,
            patch.object(worker.time, "sleep") as sleep,
            self.assertLogs(worker.logger, level="ERROR"),
        ):
            self.run_background()
            self.assertEqual((self.result().status, self.row().attempts), ("completed", 3))
            worker.execute_local("sim", run.run_id)
            self.assertEqual(solver.call_count, 3)
            self.assertEqual([call.args for call in sleep.call_args_list], [(60,), (60,)])

    def test_third_failure_is_terminal_and_retains_previous_output(self):
        self.submit()
        self.run_background()
        before = self.row().output
        run = self.submit()
        with (
            patch.object(
                worker, "run_optimization", side_effect=RuntimeError("temporary")
            ) as solve,
            patch.object(worker.time, "sleep") as sleep,
            self.assertLogs(worker.logger, level="ERROR"),
        ):
            self.run_background()
            worker.execute_local("sim", run.run_id)
            self.assertEqual(solve.call_count, 3)
            self.assertEqual(sleep.call_count, 2)
        self.assertEqual((self.result().status, self.row().attempts), ("failed", 3))
        self.assertEqual(self.result().error.code, "WORKER_ERROR")
        self.assertIsNotNone(self.result().finished_at)
        self.assertEqual(self.row().output, before)

    def test_infeasibility_and_deadlines_do_not_retry(self):
        for error in (worker.OptimizationInfeasibleError, worker.OptimizationDeadlineError):
            with self.subTest(error=error):
                self.submit()
                with (
                    patch.object(worker, "run_optimization", side_effect=error("terminal")),
                    patch.object(worker.time, "sleep") as sleep,
                ):
                    self.run_background()
                self.assertEqual((self.result().status, self.row().attempts), ("failed", 1))
                sleep.assert_not_called()

    def test_restart_fails_queued_and_running_jobs_and_allows_resubmission(self):
        self.submit()
        self.run_background()
        for status in ("queued", "in_progress"):
            with self.subTest(status=status):
                before = self.row().output
                run = self.submit()
                claimed = (
                    optimization_store.claim("sim", run.run_id) if status == "in_progress" else None
                )
                optimization_store.recover_local_runs()
                self.assertEqual(self.result().status, "failed")
                self.assertEqual(self.result().error.code, "WORKER_LOST")
                self.assertIsNone(self.row().lease_token)
                self.assertIsNone(self.row().lease_expires_at)
                self.assertEqual(self.row().output, before)
                if claimed:
                    self.assertFalse(
                        optimization_store.finish("sim", run.run_id, claimed[2], 0, output={})
                    )
                self.submit()
                self.run_background()
                self.assertEqual(self.result().status, "completed")
        completed = self.row()
        optimization_store.recover_local_runs()
        self.assertEqual(self.row(), completed)

    def test_restart_recovery_and_stale_task_cannot_change_replacement_run(self):
        old = self.submit()
        self.edit(name="changed")
        new = self.submit(self.request(1))
        optimization_store.recover_run("sim", old.run_id, interrupted=True)
        self.assertEqual((self.result().run_id, self.result().status), (new.run_id, "queued"))
        self.run_background()
        self.assertEqual((self.result().run_id, self.result().status), (new.run_id, "completed"))
        self.assertEqual(self.row().attempts, 1)

    def test_task_registration_failure_preserves_successful_output(self):
        self.submit()
        self.run_background()
        before = self.row().output
        with patch.object(
            self.background_tasks, "add_task", side_effect=RuntimeError("unavailable")
        ):
            with self.assertRaises(jobs.QueueUnavailableError):
                self.submit()
        self.assertEqual(self.result().status, "failed")
        self.assertEqual(self.result().error.code, "WORKER_ERROR")
        self.assertEqual(self.row().output, before)


class MigrationTests(DatabaseTests):
    legacy = True

    def setUp(self):
        super().setUp()
        tables = MetaData()
        self.legacy_setup = Table(
            "simulation",
            tables,
            Column("id", Text, primary_key=True),
            Column("farm_id", Text),
            Column("data", JSONB),
            Column("created_at", DateTime(timezone=True), server_default=func.now()),
            Column("updated_at", DateTime(timezone=True), server_default=func.now()),
        )
        self.old_fields = Table(
            "simulation_field",
            tables,
            Column("id", Text, primary_key=True),
            Column("simulation_id", Text, ForeignKey("simulation.id", ondelete="CASCADE")),
            Column("data", JSONB),
            Column("created_at", DateTime(timezone=True), server_default=func.now()),
        )
        self.old_candidates = caches.to_metadata(tables)
        self.old_candidates._columns.remove(self.old_candidates.c.optimizer_input)
        self.old_candidates.indexes = {
            index
            for index in self.old_candidates.indexes
            if index.name != "ix_simulation_field_candidates_simulation_field"
        }
        tables.create_all(self.engine)
        path = (
            Path(__file__).parents[1]
            / "database/migrations/versions/20261005_0001_simulation_aggregates.py"
        )
        spec = importlib.util.spec_from_file_location("aggregate_migration", path)
        self.migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.migration)

    def migrate(self, connection, direction="upgrade"):
        with Operations.context(MigrationContext.configure(connection)):
            getattr(self.migration, direction)()

    def insert_setup(self, connection, simulation_id="sim"):
        connection.execute(
            self.legacy_setup.insert().values(
                id=simulation_id,
                farm_id="farm",
                data=Simulation(
                    id=simulation_id, farm_id="farm", name="legacy", created_at="2026-10-06"
                ).model_dump(mode="json"),
            )
        )

    def test_legacy_fields_candidates_and_missing_fen_survive_conversion(self):
        old_fields, old_candidates = self.old_fields, self.old_candidates
        original = (
            field()
            .model_copy(
                update={
                    "rotation_id": "1:1:100",
                    "allowed_rotation_ids": ["1:1:100"],
                    "crop_rotation": [candidate().years[0].year],
                    "db2": 200,
                }
            )
            .model_dump(mode="json")
        )
        original.pop("fen")
        untouched = field("field-a").model_dump(mode="json")
        cached = SimulationFieldCandidates(
            field_id="field-b", jbnr=5, candidates=[candidate()]
        ).model_dump(mode="json")
        with self.engine.begin() as connection:
            self.insert_setup(connection)
            connection.execute(
                old_fields.insert(),
                [
                    {
                        "id": "field-b",
                        "simulation_id": "sim",
                        "data": original,
                        "created_at": datetime(2026, 1, 1, tzinfo=UTC),
                    },
                    {
                        "id": "field-a",
                        "simulation_id": "sim",
                        "data": untouched,
                        "created_at": datetime(2026, 1, 2, tzinfo=UTC),
                    },
                ],
            )
            connection.execute(
                old_candidates.insert().values(
                    id="cache", simulation_id="sim", field_id="field-b", data=cached
                )
            )
            preserved = connection.execute(select(old_candidates)).one()
        with self.engine.begin() as connection:
            self.migrate(connection)
            self.assertEqual(
                set(inspect(connection).get_table_names())
                & {
                    "simulation",
                    "simulation_result",
                    "simulation_field",
                    "simulation_field_candidates",
                },
                {"simulation", "simulation_result", "simulation_field_candidates"},
            )
            setup = connection.execute(select(setups)).one()
            self.assertEqual(setup.field_order, ["field-b", "field-a"])
            self.assertNotIn("candidates", setup._mapping)
            self.assertEqual(connection.execute(select(old_candidates)).one(), preserved)
            self.assertEqual(setup.fields["field-b"]["fixed_candidate"], cached["candidates"][0])
        projected = store.list_simulation_fields("farm", "sim", EMAIL)
        self.assertEqual(projected[0].model_dump(mode="json"), {**original, "fen": 0})
        self.assertEqual(projected[1].model_dump(mode="json"), untouched)
        self.assertEqual(
            self.result().status, "outdated"
        )  # Legacy partial assignments are not complete runs.
        with self.engine.begin() as connection:
            self.migrate(connection, "downgrade")
            restored = connection.execute(
                select(old_fields.c.data).where(old_fields.c.id == "field-b")
            ).scalar_one()
            self.assertEqual(restored, {**original, "fen": 0})
            self.assertEqual(connection.execute(select(old_candidates)).one(), preserved)
            self.assertNotIn(
                self.migration.CANDIDATE_INDEX,
                {index["name"] for index in inspect(connection).get_indexes(old_candidates.name)},
            )

    def test_upgrade_preserves_candidate_rows_larger_than_combined_jsonb_limit(self):
        evaluations = large_candidates()
        with self.engine.begin() as connection:
            self.insert_setup(connection)
            for i in range(17):
                legacy = field(f"large-{i}").model_copy(
                    update={
                        "rotation_id": evaluations[0].ref.to_id(),
                        "crop_rotation": [evaluations[0].years[0].year],
                        "allowed_rotation_ids": [evaluations[0].ref.to_id()] if i == 0 else [],
                        "db2": 200,
                    }
                )
                connection.execute(
                    self.old_fields.insert().values(
                        id=legacy.id,
                        simulation_id="sim",
                        data=legacy.model_dump(mode="json"),
                        created_at=datetime(2026, 1, 1, tzinfo=UTC) + timedelta(seconds=i),
                    )
                )
                connection.execute(
                    self.old_candidates.insert().values(
                        id=f"cache-{i}",
                        simulation_id="sim",
                        field_id=legacy.id,
                        data=SimulationFieldCandidates(
                            field_id=legacy.id, jbnr=5, candidates=evaluations
                        ).model_dump(mode="json"),
                    )
                )
            identity_query = select(caches.c.id, caches.c.created_at, caches.c.updated_at).order_by(
                caches.c.id
            )
            preserved = connection.execute(identity_query).all()
        with self.engine.begin() as connection:
            self.migrate(connection)
            self.assertEqual(connection.execute(identity_query).all(), preserved)
            size = connection.execute(
                select(func.sum(func.octet_length(caches.c.data.cast(Text))))
            ).scalar_one()
            self.assertGreater(size, 268_435_455)
            self.assertLess(
                connection.execute(
                    select(func.octet_length(results.c.output.cast(Text)))
                ).scalar_one(),
                1_000_000,
            )
        result = self.result()
        self.assertEqual(result.status, "completed")
        self.assertEqual(len(result.selected_candidates), 17)
        self.assertEqual(len(store.list_simulation_fields("farm", "sim", EMAIL)), 17)

    def test_empty_simulations_and_candidate_sets_survive_round_trip(self):
        with self.engine.begin() as connection:
            self.insert_setup(connection, "empty")
            self.insert_setup(connection, "sim")
            original = field().model_dump(mode="json")
            connection.execute(
                self.old_fields.insert().values(id="field-b", simulation_id="sim", data=original)
            )
            connection.execute(
                self.old_candidates.insert().values(
                    id="empty-cache",
                    simulation_id="sim",
                    field_id="field-b",
                    data=SimulationFieldCandidates(
                        field_id="field-b", jbnr=5, candidates=[]
                    ).model_dump(mode="json"),
                )
            )
            preserved = connection.execute(select(self.old_candidates)).one()
        with self.engine.begin() as connection:
            self.migrate(connection)
        self.assertEqual(store.list_simulation_fields("farm", "empty", EMAIL), [])
        self.assertEqual(store.list_simulation_field_candidates("farm", "empty", EMAIL), [])
        self.assertEqual(store.get_result("farm", "empty", EMAIL).status, "not_started")
        self.assertEqual(self.result().status, "not_started")
        self.assertEqual(
            store.get_simulation_field_candidates("farm", "sim", "field-b", EMAIL).candidates, []
        )
        with self.engine.begin() as connection:
            self.migrate(connection, "downgrade")
            self.assertEqual(connection.execute(select(self.old_candidates)).one(), preserved)
            self.assertEqual(
                connection.execute(select(self.old_fields.c.data)).scalar_one(), original
            )

    def test_downgrade_merges_manual_selected_then_fixed_without_replacing_rows(self):
        with self.engine.begin() as connection:
            self.insert_setup(connection)
            for field_id in ("field-b", "field-a"):
                connection.execute(
                    self.old_fields.insert().values(
                        id=field_id,
                        simulation_id="sim",
                        data=field(field_id).model_dump(mode="json"),
                    )
                )
                connection.execute(
                    self.old_candidates.insert().values(
                        id=f"cache-{field_id}",
                        simulation_id="sim",
                        field_id=field_id,
                        data=SimulationFieldCandidates(
                            field_id=field_id, jbnr=5, candidates=[candidate()]
                        ).model_dump(mode="json"),
                    )
                )
            preserved = connection.execute(
                select(caches.c.id, caches.c.created_at).order_by(caches.c.id)
            ).all()
            self.migrate(connection)
            setup_fields = connection.execute(select(setups.c.fields)).scalar_one()
            setup_fields["field-b"].update(
                manual_candidate=candidate(110, "manual").model_dump(mode="json"),
                fixed_candidate=candidate(300).model_dump(mode="json"),
            )
            setup_fields["field-a"]["manual_candidate"] = candidate(400).model_dump(mode="json")
            connection.execute(update(setups).values(fields=setup_fields))
            connection.execute(
                update(results).values(
                    output={
                        "selected_candidates": {
                            "field-b": candidate(200).model_dump(mode="json"),
                            "field-a": candidate(500).model_dump(mode="json"),
                        }
                    }
                )
            )
        projected = store.list_simulation_field_candidates("farm", "sim", EMAIL)
        with self.engine.begin() as connection:
            self.migrate(connection, "downgrade")
            self.assertEqual(
                connection.execute(
                    select(caches.c.id, caches.c.created_at).order_by(caches.c.id)
                ).all(),
                preserved,
            )
            restored = cached_data(connection)
        for row in projected:
            self.assertEqual(restored[row.field_id], row.model_dump(mode="json"))
        self.assertEqual([c["avg_db_kr_ha"] for c in restored["field-b"]["candidates"]], [110, 300])
        self.assertEqual([c["avg_db_kr_ha"] for c in restored["field-a"]["candidates"]], [500])

    def test_duplicate_candidate_sets_abort_upgrade_transactionally(self):
        with self.engine.begin() as connection:
            self.insert_setup(connection)
            for i in range(2):
                connection.execute(
                    self.old_candidates.insert().values(
                        id=f"duplicate-{i}", simulation_id="sim", field_id="field-b", data={}
                    )
                )
        with self.assertRaises(IntegrityError), self.engine.begin() as connection:
            self.migrate(connection)
        with self.engine.connect() as connection:
            self.assertNotIn("simulation_result", inspect(connection).get_table_names())
            self.assertNotIn(
                "revision",
                {column["name"] for column in inspect(connection).get_columns("simulation")},
            )
            self.assertEqual(
                connection.execute(select(func.count()).select_from(caches)).scalar_one(), 2
            )
