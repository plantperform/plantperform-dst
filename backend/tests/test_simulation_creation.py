"""Creation lifecycle tests use the same disposable schemas as optimizer tests."""

import asyncio
import importlib.util
import json
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import BackgroundTasks
from fastapi.testclient import TestClient
from sqlalchemy import delete, event, func, inspect, select, update
from sqlalchemy.exc import IntegrityError
from test_optimizer_lifecycle import CONTEXT, EMAIL, DatabaseTests, candidate, field

from app import main
from app.auth import AuthenticatedUser, current_user
from app.data import creation_store, repository, simulation_store
from app.data.db import field_table
from app.data.db import simulation_field_candidates_table as caches
from app.data.db import simulation_table as setups
from app.data.optimizer_inputs import optimizer_input, optimizer_input_json
from app.domain.creation import CreationActiveError, CreationNotReadyError
from app.domain.creation_job import CreationJob, creation_job_id
from app.domain.optimization import OptimizationAttemptsExhaustedError
from app.domain.simulation import CreateSimulationRequest, OptimizationConstraints
from app.services.creation import jobs as submission
from app.services.creation import worker
from app.services.scenario import candidate_evaluator


class CreationUnitTests(unittest.TestCase):
    def test_direct_json_preserves_full_and_compact_payloads(self):
        from app.domain.rotation_candidate import SimulationFieldCandidates

        full = candidate()
        full.years[0].year.afgrode_navn = "Vårbyg"
        full.years[0].db_detail = {"linjer": [{"beløb": 12.125, "værdi": None}]}
        data = SimulationFieldCandidates(field_id="f", jbnr=4, candidates=[full])
        self.assertEqual(json.loads(data.model_dump_json()), data.model_dump(mode="json"))
        self.assertEqual(json.loads(optimizer_input_json(data)), optimizer_input(data))

    def test_preparation_deduplicates_in_order_and_reuses_rotation_inputs(self):
        rotation = [(1, None, None)] * 8
        with (
            patch.object(
                candidate_evaluator.saedskifte_library, "list_variants", return_value=["1", "2"]
            ),
            patch.object(
                candidate_evaluator.saedskifte_library, "generate_rotation", return_value=rotation
            ) as generate,
            patch.object(
                candidate_evaluator, "evaluate_sequence_for_mark", return_value=candidate()
            ) as evaluate,
        ):
            prepared = candidate_evaluator.prepare_candidates(["1", "2"], ["100", "80"])
            self.assertEqual([item.ref.to_id() for item in prepared], ["1:1:100", "1:1:80"])
            for _ in range(3):
                candidate_evaluator.generate_candidates_for_field(
                    ["1", "2"],
                    ["100", "80"],
                    4,
                    CreateSimulationRequest(name="test").godning,
                    prepared=prepared,
                )
            self.assertEqual(generate.call_count, 4)
            self.assertEqual(evaluate.call_count, 6)

    def test_prepared_evaluations_match_individual_evaluations_with_soil_and_history(self):
        from app.domain.rotation_candidate import RotationCandidateRef, SimulationFieldCandidates

        rotation = [(11, 9683, "Tidlig såning"), (1, 9682, "Mellemafgrøde")] * 4
        godning = CreateSimulationRequest(name="parity").godning
        history = {
            "2025": {"code": 1, "mncs": 90, "mnca": 0, "g0": 12},
            "2026": {"code": 11, "mncs": 120, "mnca": 0, "g0": 15},
        }
        soil = {"percolation_by_kategori": (0.3,) * 8, "org_n_topsoil": 3.25, "s_soil": 0.91}
        candidate_evaluator.compute_n_inputs.cache_clear()
        self.addCleanup(candidate_evaluator.compute_n_inputs.cache_clear)
        with (
            patch.object(
                candidate_evaluator.saedskifte_library, "list_variants", return_value=["1"]
            ),
            patch.object(
                candidate_evaluator.saedskifte_library, "generate_rotation", return_value=rotation
            ),
            patch.object(
                candidate_evaluator.afgroede_normer,
                "lookup_norm",
                return_value={
                    "n_norm": 175,
                    "forfrugtsvaerdi": 18,
                },
            ),
            patch.object(candidate_evaluator.afgroede_normer, "lookup_nfix", return_value=2.5),
            patch.object(
                candidate_evaluator.afgroede_normer,
                "lookup_crop_params",
                return_value={"navn": "Vårbyg"},
            ),
            patch.object(
                candidate_evaluator.bridge_v2,
                "evaluate_leaching_position",
                side_effect=lambda **values: {
                    "L_nuar": values["mncs"] * values["percolation_by_kategori"][0],
                    "inputs": values,
                },
            ),
            patch.object(
                candidate_evaluator,
                "calculate_db",
                side_effect=lambda code, form, jb, **values: {
                    "db": values["mncs"] * 11,
                    "udbytte": 125,
                    "udbytteenhed": "FE/ha",
                    "inputs": values,
                },
            ),
        ):
            for early, intermediate in ((True, True), (False, True), (True, False), (False, False)):
                with self.subTest(early=early, intermediate=intermediate):
                    prepared = candidate_evaluator.prepare_candidates(
                        ["1"], ["100", "80"], early, intermediate
                    )
                    generated = candidate_evaluator.generate_candidates_for_field(
                        ["1"],
                        ["100", "80"],
                        4,
                        godning,
                        prepared=prepared,
                        real_history=history,
                        tidlig_saaning=early,
                        mellemafgrode=intermediate,
                        **soil,
                    )
                    expected = [
                        candidate_evaluator.evaluate_candidate_for_mark(
                            RotationCandidateRef(
                                saedskiftevariant="1", variant="1", n_norm_pct=pct
                            ),
                            4,
                            godning.driftsform,
                            godning.org_mineral_n,
                            godning.mineralsk_andel_pct,
                            godning.only_organic,
                            real_history=history,
                            tidlig_saaning=early,
                            mellemafgrode=intermediate,
                            **soil,
                        )
                        for pct in ("100", "80")
                    ]
                    actual_data = SimulationFieldCandidates(
                        field_id="f", jbnr=4, candidates=generated, real_history=history
                    )
                    expected_data = SimulationFieldCandidates(
                        field_id="f", jbnr=4, candidates=expected, real_history=history
                    )
                    self.assertEqual(
                        json.loads(actual_data.model_dump_json()),
                        expected_data.model_dump(mode="json"),
                    )
                    self.assertEqual(
                        json.loads(optimizer_input_json(actual_data)),
                        optimizer_input(expected_data),
                    )


class CreationLifecycleTests(DatabaseTests):
    def setUp(self):
        super().setUp()
        self.enterContext(patch.object(submission, "sqs_client", return_value=self.queue))
        self.registry = self.enterContext(
            patch.object(repository, "_registry_contexts_for_imk_ids", return_value={})
        )
        self.prepared = self.enterContext(
            patch.object(worker, "prepare_candidates", return_value=())
        )
        self.generated = self.enterContext(
            patch.object(
                repository,
                "generate_candidates_for_field",
                return_value=[candidate()],
            )
        )

    def attach(self, count=2):
        with self.sessions.begin() as session:
            for index in range(count):
                source = field(f"source-{index:04d}")
                session.execute(
                    field_table.insert().values(
                        id=source.id,
                        farm_id="farm",
                        data=source.model_dump(mode="json"),
                    )
                )

    def create(self, *, count=2, auto=False, constraints=None, request_id=None):
        self.attach(count)
        request = CreateSimulationRequest(
            name="new",
            request_id=request_id or uuid4(),
            optimize_on_create=auto,
            saedskiftevarianter=["1"],
            n_norm_procenter=["100"],
            constraints=constraints or OptimizationConstraints(),
        )
        simulation = submission.submit("farm", request, EMAIL)
        return simulation, request

    def job(self, simulation_id):
        with self.sessions() as session:
            row = session.execute(select(setups).where(setups.c.id == simulation_id)).one()
            return SimpleNamespace(
                status=row.creation_status,
                revision=row.revision,
                data=row.data,
                job_id=creation_job_id(simulation_id, row.revision),
            )

    def set_job(self, simulation_id, *, status):
        with self.sessions.begin() as session:
            session.execute(
                update(setups).where(setups.c.id == simulation_id).values(creation_status=status)
            )

    def execute(self, simulation):
        counts = getattr(self, "_delivery_counts", {})
        counts[simulation.id] = counts.get(simulation.id, 0) + 1
        self._delivery_counts = counts
        worker.execute(
            self.message(simulation.id),
            CONTEXT,
            sqs_delivery=True,
            receive_count=counts[simulation.id],
        )

    def message(self, simulation_id):
        for call in reversed(self.queue.send_message.call_args_list):
            envelope = json.loads(call.kwargs["MessageBody"])
            if (
                envelope["jobType"] == "create_simulation"
                and envelope["simulationId"] == simulation_id
            ):
                return CreationJob.model_validate(envelope)
        self.fail("No creation message for this simulation")

    def candidate_count(self, simulation_id):
        with self.sessions() as session:
            return session.execute(
                select(func.count())
                .select_from(caches)
                .where(caches.c.simulation_id == simulation_id)
            ).scalar_one()

    def client(self):
        main.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(email=EMAIL)
        self.addCleanup(main.app.dependency_overrides.clear)
        self.enterContext(patch.object(main, "validate_aws_region"))
        return TestClient(main.app)

    def test_post_250_fields_is_accepted_without_generating_candidates(self):
        self.attach(250)
        statements = []

        def observe(connection, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        event.listen(self.engine, "before_cursor_execute", observe)
        self.addCleanup(event.remove, self.engine, "before_cursor_execute", observe)
        request = {
            "name": "large",
            "requestId": str(uuid4()),
            "saedskiftevarianter": ["1"],
            "nNormProcenter": ["100"],
            "optimizeOnCreate": True,
        }
        started = time.monotonic()
        with self.client() as client:
            response = client.post("/api/v0/farms/farm/simulations", json=request)
        self.assertEqual(response.status_code, 202, response.text)
        self.assertEqual(response.json()["creationStatus"], "queued")
        self.assertNotIn("creation", response.json())
        self.generated.assert_not_called()
        self.registry.assert_not_called()
        self.prepared.assert_not_called()
        self.assertFalse(any("FROM field " in s or "FROM field\n" in s for s in statements))
        self.assertLess(time.monotonic() - started, 5)
        message = self.message(response.json()["id"])
        self.assertEqual(message.requested_by, EMAIL)
        self.assertEqual(message.expected_revision, 0)
        self.assertEqual(message.job_id, self.job(message.simulation_id).job_id)
        self.assertEqual(
            message.parameters.model_dump(exclude={"request_id"}),
            CreateSimulationRequest.model_validate(request).model_dump(exclude={"request_id"}),
        )
        envelope = json.loads(self.queue.send_message.call_args.kwargs["MessageBody"])
        self.assertEqual(
            set(envelope),
            {
                "jobType",
                "farmId",
                "simulationId",
                "jobId",
                "requestedBy",
                "expectedRevision",
                "parameters",
            },
        )
        self.assertNotIn("requestId", envelope["parameters"])
        with self.sessions() as session:
            row = session.execute(select(setups).where(setups.c.id == message.simulation_id)).one()
            self.assertNotIn("creation_status", row.data)
            self.assertNotIn("creation_job", row.data)
            self.assertNotIn("optimize_on_create", row.data)
            self.assertEqual(row.fields, {})
            self.assertEqual(row.field_order, [])

    def test_idempotency_reuses_submission_even_with_changed_settings(self):
        simulation, request = self.create()
        repeated = submission.submit("farm", request, EMAIL)
        changed = submission.submit(
            "farm",
            request.model_copy(update={"name": "changed", "optimize_on_create": True}),
            EMAIL,
        )
        self.assertEqual(repeated.id, simulation.id)
        self.assertEqual(changed.id, simulation.id)
        self.assertEqual(changed.name, request.name)
        self.assertEqual(self.queue.send_message.call_count, 1)
        self.assertIsNone(submission.submit("farm", request, "outsider@example.com"))
        self.assertFalse(self.message(simulation.id).parameters.optimize_on_create)

    def test_message_size_is_independent_of_farm_field_count(self):
        request = CreateSimulationRequest(
            name="same settings", saedskiftevarianter=["1"], n_norm_procenter=["100"]
        )
        empty = submission.submit("farm", request, EMAIL)
        empty_message = self.queue.send_message.call_args.kwargs["MessageBody"]
        self.attach(250)
        large = submission.submit("farm", request, EMAIL)
        large_message = self.queue.send_message.call_args.kwargs["MessageBody"]
        self.assertNotEqual(empty.id, large.id)
        self.assertEqual(len(empty_message.encode()), len(large_message.encode()))
        self.assertEqual(
            json.loads(empty_message)["parameters"], json.loads(large_message)["parameters"]
        )
        self.generated.assert_not_called()
        self.registry.assert_not_called()

    def test_concurrent_equal_request_ids_save_one_simulation(self):
        self.attach(1)
        request = CreateSimulationRequest(name="concurrent", request_id=uuid4())
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(submission.submit, "farm", request, EMAIL) for _ in range(2)]
            simulations = [future.result(timeout=10) for future in futures]
        self.assertEqual(simulations[0].id, simulations[1].id)
        with self.sessions() as session:
            self.assertEqual(
                session.execute(
                    select(func.count())
                    .select_from(setups)
                    .where(setups.c.creation_status != "done")
                ).scalar_one(),
                1,
            )

    def test_invalid_copied_constraints_fail_in_the_worker(self):
        self.attach(1)
        for constraints in (
            {"max_fields_with_new_rotation": 2},
            {"globally_allowed_rotation_ids": ["unknown"]},
        ):
            with self.subTest(constraints=constraints):
                simulation = submission.submit(
                    "farm", CreateSimulationRequest(name="invalid", constraints=constraints), EMAIL
                )
                self.assertEqual(simulation.creation_status, "queued")
                self.execute(simulation)
                job = self.job(simulation.id)
                self.assertEqual(job.status, "failed")
        self.generated.assert_not_called()

    def test_failed_publication_returns_id_and_explicit_retry_republishes(self):
        self.attach(1)
        request = {"name": "new", "requestId": str(uuid4())}
        self.queue.send_message.side_effect = RuntimeError("queue unavailable")
        with self.client() as client:
            failed = client.post("/api/v0/farms/farm/simulations", json=request)
            self.assertEqual(failed.status_code, 503)
            simulation_id = failed.json()["detail"]["simulationId"]
            self.assertEqual(self.job(simulation_id).status, "failed")
            self.queue.send_message.side_effect = None
            repeated = client.post("/api/v0/farms/farm/simulations", json=request)
            self.assertEqual(repeated.json()["id"], simulation_id)
            self.assertEqual(repeated.json()["creationStatus"], "failed")
            self.assertEqual(self.queue.send_message.call_count, 1)
            accepted = client.post(
                f"/api/v0/farms/farm/simulations/{simulation_id}/creation/retry",
                json={"optimizeOnCreate": True},
            )
        self.assertEqual(accepted.status_code, 202, accepted.text)
        self.assertEqual(accepted.json()["id"], simulation_id)
        self.assertEqual(self.job(simulation_id).status, "queued")
        self.assertEqual(self.message(simulation_id).expected_revision, 1)
        self.assertTrue(self.message(simulation_id).parameters.optimize_on_create)

    def test_ambiguous_publication_preserves_claimed_job(self):
        self.attach(1)

        def send(**kwargs):
            job = CreationJob.model_validate_json(kwargs["MessageBody"])
            with creation_store.execution_session(job.simulation_id) as session:
                creation_store.claim(session, job)
            raise RuntimeError("lost acknowledgement")

        self.queue.send_message.side_effect = send
        simulation = submission.submit("farm", CreateSimulationRequest(name="new"), EMAIL)
        self.assertEqual(simulation.creation_status, "running")

    def test_partial_creation_blocks_reads_edits_and_optimization_but_not_status_or_delete(self):
        simulation, _ = self.create()
        with self.client() as client:
            root = f"/api/v0/farms/farm/simulations/{simulation.id}"
            self.assertEqual(client.get(root).status_code, 200)
            self.assertEqual(client.get(root + "/result").status_code, 200)
            self.assertEqual(client.get(root + "/fields").status_code, 409)
            self.assertEqual(client.get(root + "/crop-area-ranges").status_code, 409)
            self.assertEqual(client.patch(root + "/constraints", json={}).status_code, 409)
            self.assertEqual(
                client.post(
                    root + "/optimize",
                    json={
                        "runId": str(uuid4()),
                        "expectedRevision": 0,
                    },
                ).status_code,
                409,
            )
            self.assertEqual(client.delete(root).status_code, 204)
        worker.execute(self.message(simulation.id), CONTEXT, sqs_delivery=True)
        self.generated.assert_not_called()
        with self.sessions() as session:
            self.assertEqual(
                session.execute(
                    select(func.count())
                    .select_from(setups)
                    .where(setups.c.creation_status != "done")
                ).scalar_one(),
                0,
            )

    def test_retry_endpoint_requires_membership_and_failed_creation(self):
        simulation, _ = self.create(count=1, auto=True)
        root = f"/api/v0/farms/farm/simulations/{simulation.id}/creation/retry"
        with self.client() as client:
            self.assertEqual(client.post(root).status_code, 409)
            self.generated.side_effect = ValueError("bad input")
            self.execute(simulation)
            old_job_id = self.job(simulation.id).job_id
            main.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(
                email="outsider@example.com"
            )
            self.assertEqual(client.post(root).status_code, 404)
            self.assertEqual(self.job(simulation.id).job_id, old_job_id)
            main.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(email=EMAIL)
            response = client.post(root)
        self.assertEqual(response.status_code, 202, response.text)
        self.assertEqual(response.json()["creationStatus"], "queued")
        self.assertEqual(response.json()["revision"], 1)
        self.assertNotEqual(self.job(simulation.id).job_id, old_job_id)
        self.assertFalse(self.message(simulation.id).parameters.optimize_on_create)

    def test_store_rejects_partial_field_reads_and_edits(self):
        simulation, _ = self.create()
        with self.assertRaises(CreationNotReadyError):
            simulation_store.list_simulation_fields("farm", simulation.id, EMAIL)
        with self.assertRaises(CreationNotReadyError):
            simulation_store.update_simulation_constraints(
                "farm",
                simulation.id,
                OptimizationConstraints(),
                EMAIL,
            )

    def test_completion_and_duplicate_delivery_preserve_all_candidate_data(self):
        simulation, _ = self.create()
        self.execute(simulation)
        row = self.job(simulation.id)
        self.assertEqual(row.status, "done")
        self.assertEqual(self.candidate_count(simulation.id), 2)
        self.execute(simulation)
        self.assertEqual(self.generated.call_count, 2)
        self.assertEqual(
            simulation_store.get_result("farm", simulation.id, EMAIL).status, "not_started"
        )
        with self.sessions() as session:
            for data, compact in session.execute(
                select(caches.c.data, caches.c.optimizer_input).where(
                    caches.c.simulation_id == simulation.id,
                )
            ):
                from app.domain.rotation_candidate import SimulationFieldCandidates

                expected = SimulationFieldCandidates(
                    field_id=data["field_id"],
                    jbnr=6,
                    candidates=[candidate()],
                )
                self.assertEqual(data, expected.model_dump(mode="json"))
                self.assertEqual(compact, optimizer_input(expected))

    def test_retry_restarts_all_fields_and_discards_partial_candidates(self):
        simulation, _ = self.create(count=3)
        self.generated.side_effect = [
            [candidate()],
            RuntimeError("transient"),
            [candidate()],
            [candidate()],
            [candidate()],
        ]
        with self.assertRaisesRegex(RuntimeError, "transient|interrupted"):
            self.execute(simulation)
        self.assertEqual(self.candidate_count(simulation.id), 1)
        self.assertEqual(self.job(simulation.id).status, "queued")
        self.execute(simulation)
        self.assertEqual(self.candidate_count(simulation.id), 3)
        self.assertEqual(self.generated.call_count, 5)
        with self.sessions() as session:
            self.assertEqual(
                session.execute(
                    select(func.count())
                    .select_from(caches)
                    .where(
                        caches.c.simulation_id == simulation.id,
                    )
                ).scalar_one(),
                3,
            )

    def test_retry_refreshes_fields_and_registry_and_observes_changed_field_counts(self):
        simulation, _ = self.create(count=2)
        original = repository.prepare_simulation_field
        seen = []

        def generate(current, registry, request, **options):
            seen.append((current.name, current.area_ha))
            if len(seen) == 1:
                with self.sessions.begin() as session:
                    session.execute(delete(field_table).where(field_table.c.id == "source-0001"))
                    updated = field("source-0000").model_copy(
                        update={"name": "updated", "area_ha": 99}
                    )
                    session.execute(
                        update(field_table)
                        .where(field_table.c.id == "source-0000")
                        .values(data=updated.model_dump(mode="json"))
                    )
                    for identifier in ("added-a", "added-b"):
                        added = field(identifier)
                        session.execute(
                            field_table.insert().values(
                                id=identifier, farm_id="farm", data=added.model_dump(mode="json")
                            )
                        )
            if len(seen) == 2:
                raise RuntimeError("interrupted")
            return original(current, registry, request, **options)

        with patch.object(repository, "prepare_simulation_field", side_effect=generate):
            with self.assertRaisesRegex(RuntimeError, "transient|interrupted"):
                self.execute(simulation)
            self.execute(simulation)
        # First attempt sees its original inputs even after farm edits during generation.
        self.assertEqual([area for _, area in seen[:2]], [2, 2])
        self.assertIn(("updated", 99), seen[2:])
        self.assertEqual(len(seen), 5)
        self.assertEqual(self.candidate_count(simulation.id), 3)
        self.assertEqual(self.registry.call_count, 2)
        self.assertEqual(self.prepared.call_count, 2)
        self.assertEqual(
            len(simulation_store.list_simulation_field_candidates("farm", simulation.id, EMAIL)), 3
        )

    def test_wrong_farm_envelope_cannot_claim_creation(self):
        simulation, _ = self.create(count=1)
        job = self.message(simulation.id).model_copy(update={"farm_id": "other"})
        with self.assertRaisesRegex(ValueError, "farm"):
            worker.execute(job, CONTEXT, sqs_delivery=True)
        self.generated.assert_not_called()
        self.assertEqual(self.job(simulation.id).status, "queued")

    def test_cache_and_field_setup_roll_back_together_on_a_database_failure(self):
        simulation, _ = self.create(count=1)
        job = self.message(simulation.id)
        with creation_store.execution_session(simulation.id) as session:
            creation_store.claim(session, job)
            fields, _ = creation_store.start_attempt(session, job)
            frozen = fields[0]
            setup, data = repository.prepare_simulation_field(
                frozen, None, job.parameters, prepared=()
            )
            setup["fixed_candidate"] = candidate().model_dump(mode="json")
            setup["allowed_rotation_ids"] = [candidate().ref.to_id()]
            with self.sessions() as reader:
                before = reader.execute(
                    select(setups.c.fields).where(setups.c.id == simulation.id)
                ).scalar_one()

            def break_write(connection, cursor, statement, parameters, context, executemany):
                if statement.startswith("UPDATE simulation SET fields="):
                    raise RuntimeError("field setup failed")

            event.listen(self.engine, "before_cursor_execute", break_write)
            try:
                with self.assertRaisesRegex(RuntimeError, "field setup failed"):
                    creation_store.checkpoint(
                        session,
                        job,
                        frozen.id,
                        setup,
                        data.model_dump_json(),
                        optimizer_input_json(data),
                    )
            finally:
                event.remove(self.engine, "before_cursor_execute", break_write)
            self.assertEqual(self.candidate_count(simulation.id), 0)
            with self.sessions() as reader:
                self.assertEqual(
                    reader.execute(
                        select(setups.c.fields).where(setups.c.id == simulation.id)
                    ).scalar_one(),
                    before,
                )
            self.assertTrue(
                creation_store.checkpoint(
                    session,
                    job,
                    frozen.id,
                    setup,
                    data.model_dump_json(),
                    optimizer_input_json(data),
                )
            )
        self.assertEqual(self.candidate_count(simulation.id), 1)

    def test_deletion_during_generation_skips_candidate_writes(self):
        simulation, _ = self.create(count=1)

        def generate(*args, **kwargs):
            simulation_store.delete_simulation("farm", simulation.id, EMAIL)
            return [candidate()]

        self.generated.side_effect = generate
        self.execute(simulation)
        self.assertIsNone(repository.get_simulation("farm", simulation.id, EMAIL))
        with self.sessions() as session:
            self.assertEqual(
                session.execute(
                    select(func.count())
                    .select_from(caches)
                    .where(
                        caches.c.simulation_id == simulation.id,
                    )
                ).scalar_one(),
                0,
            )

    def test_three_transient_failures_exhaust_creation_and_remain_unacknowledged(self):
        simulation, _ = self.create(count=1)
        self.generated.side_effect = RuntimeError("transient")
        for attempt in range(1, 4):
            with self.assertRaisesRegex(RuntimeError, "transient"):
                worker.execute(
                    self.message(simulation.id), CONTEXT, sqs_delivery=True, receive_count=attempt
                )
            self.assertEqual(self.job(simulation.id).status, "queued" if attempt < 3 else "failed")
        with self.assertRaises(OptimizationAttemptsExhaustedError):
            worker.execute(self.message(simulation.id), CONTEXT, sqs_delivery=True, receive_count=4)
        self.assertEqual(self.generated.call_count, 3)

    def test_advisory_lock_survives_commits_and_rollbacks_and_defers_duplicate_delivery(self):
        simulation, _ = self.create(count=1)
        job = self.message(simulation.id)
        with creation_store.execution_session(simulation.id) as session:
            with session.begin():
                first_pid = session.execute(select(func.pg_backend_pid())).scalar_one()
            creation_store.claim(session, job)
            self.assertEqual(self.job(simulation.id).status, "running")
            fields, _ = creation_store.start_attempt(session, job)
            try:
                with session.begin():
                    self.assertEqual(
                        session.execute(select(func.pg_backend_pid())).scalar_one(), first_pid
                    )
                    raise RuntimeError("rollback")
            except RuntimeError:
                pass
            with ThreadPoolExecutor(max_workers=1) as executor:
                duplicate = executor.submit(worker.execute, job, CONTEXT, sqs_delivery=True)
                with self.assertRaises(CreationActiveError):
                    duplicate.result(timeout=10)
            self.generated.assert_not_called()
            creation_store.checkpoint(session, job, fields[0].id, {}, None, None)
        # A hard stop that released the connection can be reclaimed, even with running status.
        self.execute(simulation)
        self.assertEqual(self.job(simulation.id).status, "done")

    def test_connection_loss_aborts_without_reconnecting_or_writing(self):
        simulation, _ = self.create(count=1)
        original = creation_store.checkpoint

        def lose_connection(session, *args, **kwargs):
            session.get_bind().invalidate()
            return original(session, *args, **kwargs)

        with patch.object(creation_store, "checkpoint", side_effect=lose_connection):
            with self.assertRaisesRegex(RuntimeError, "connection was lost"):
                self.execute(simulation)
        self.assertEqual(self.job(simulation.id).status, "running")
        self.assertEqual(self.candidate_count(simulation.id), 0)
        self.execute(simulation)
        self.assertEqual(self.job(simulation.id).status, "done")

    def test_empty_candidates_still_advance_checkpoint(self):
        simulation, _ = self.create()
        self.generated.return_value = []
        self.execute(simulation)
        self.assertEqual(self.job(simulation.id).status, "done")
        self.assertEqual(
            simulation_store.list_simulation_field_candidates("farm", simulation.id, EMAIL), []
        )

    def test_empty_farm_creation_finishes(self):
        simulation = submission.submit("farm", CreateSimulationRequest(name="empty"), EMAIL)
        self.execute(simulation)
        self.assertEqual(self.job(simulation.id).status, "done")
        self.assertEqual(simulation_store.list_simulation_fields("farm", simulation.id, EMAIL), [])
        self.generated.assert_not_called()

    def test_latest_farm_edits_and_permanent_fields_keep_their_lock(self):
        simulation, _ = self.create(count=1)
        context = SimpleNamespace(
            jbnr=4,
            crop_history={"2026": 260},
            goedningsregion=None,
            oeko=False,
            percolation_by_kategori=None,
            org_n_topsoil=None,
            s_soil=None,
        )
        with self.sessions.begin() as session:
            source = field("source-0000").model_copy(update={"area_ha": 99, "imk_id": 23})
            session.execute(update(field_table).values(data=source.model_dump(mode="json")))
        permanent = candidate()
        with (
            patch.object(repository, "_registry_contexts_for_imk_ids", return_value={23: context}),
            patch.object(repository, "real_history_lookback", return_value={}),
            patch.object(repository, "is_permanent_afgrode", return_value=True),
            patch.object(repository, "generate_permanent_crop_candidate", return_value=permanent),
        ):
            self.execute(simulation)
        copied = simulation_store.list_simulation_fields("farm", simulation.id, EMAIL)[0]
        self.assertEqual(copied.area_ha, 99)
        self.assertEqual(copied.allowed_rotation_ids, [permanent.ref.to_id()])
        self.assertEqual(copied.crop_rotation, [year.year for year in permanent.years])

    def test_registry_inputs_are_loaded_only_when_the_worker_starts(self):
        self.attach(1)
        context = dict(
            jbnr=4,
            crop_history={"2026": 22},
            goedningsregion=None,
            oeko=False,
            percolation_by_kategori={str(i): 0.3 for i in range(1, 9)},
            org_n_topsoil=99.0,
            s_soil=0.9,
        )
        with self.sessions.begin() as session:
            source = field("source-0000").model_copy(update={"imk_id": 23})
            session.execute(update(field_table).values(data=source.model_dump(mode="json")))
        simulation = submission.submit(
            "farm",
            CreateSimulationRequest(
                name="latest", saedskiftevarianter=["1"], n_norm_procenter=["100"]
            ),
            EMAIL,
        )
        with (
            patch.object(
                repository,
                "_registry_contexts_for_imk_ids",
                return_value={23: SimpleNamespace(**context)},
            ) as load,
            patch.object(repository, "is_permanent_afgrode", return_value=False),
            patch.object(repository, "real_history_lookback", return_value={"2026": {"code": 22}}),
        ):
            self.execute(simulation)
        load.assert_called_once()
        self.assertEqual(self.generated.call_args.kwargs["org_n_topsoil"], 99.0)
        self.assertEqual(self.generated.call_args.kwargs["real_history"]["2026"]["code"], 22)

    def test_automatic_optimization_uses_explicit_sqs_transport_without_a_browser(self):
        simulation, _ = self.create(auto=True)
        with patch.dict("os.environ", {"APP_ENV": "development"}):
            self.execute(simulation)
        result = simulation_store.get_result("farm", simulation.id, EMAIL)
        self.assertEqual(result.status, "queued")
        self.assertEqual(result.parameters["timeLimitSeconds"], 90)
        self.assertEqual(self.queue.send_message.call_count, 2)
        self.assertEqual(
            json.loads(self.queue.send_message.call_args.kwargs["MessageBody"]),
            {
                "jobType": "optimization",
                "farmId": "farm",
                "simulationId": simulation.id,
                "runId": result.run_id,
            },
        )

    def test_handoff_redelivery_does_not_regenerate_fields(self):
        simulation, _ = self.create(auto=True)
        with patch.object(
            worker, "handoff", side_effect=RuntimeError("crashed before publication")
        ):
            with self.assertRaisesRegex(RuntimeError, "crashed before publication"):
                self.execute(simulation)
        self.assertEqual(self.job(simulation.id).status, "done")
        self.assertEqual(simulation_store.get_result("farm", simulation.id, EMAIL).status, "queued")
        self.execute(simulation)
        self.assertEqual(self.generated.call_count, 2)
        self.assertEqual(self.queue.send_message.call_count, 2)

    def test_confirmed_handoff_redelivery_reuses_the_reserved_run(self):
        simulation, _ = self.create(auto=True)
        original_handoff = worker.handoff

        def crash_after_dispatch(*args, **kwargs):
            original_handoff(*args, **kwargs)
            raise RuntimeError("crashed after publication")

        with patch.object(worker, "handoff", side_effect=crash_after_dispatch):
            with self.assertRaisesRegex(RuntimeError, "crashed after publication"):
                self.execute(simulation)
        run_id = simulation_store.get_result("farm", simulation.id, EMAIL).run_id
        self.execute(simulation)
        self.assertEqual(self.generated.call_count, 2)
        self.assertEqual(self.queue.send_message.call_count, 2)
        self.assertEqual(simulation_store.get_result("farm", simulation.id, EMAIL).run_id, run_id)

    def test_failed_handoff_publication_exposes_optimization_failure(self):
        simulation, _ = self.create(auto=True)
        self.queue.send_message.side_effect = RuntimeError("queue unavailable")
        self.execute(simulation)
        self.assertEqual(self.job(simulation.id).status, "done")
        result = simulation_store.get_result("farm", simulation.id, EMAIL)
        self.assertEqual((result.status, result.error.code), ("failed", "QUEUE_UNAVAILABLE"))

    def test_impossible_copied_rules_keep_creation_ready_and_fail_optimization(self):
        constraints = OptimizationConstraints(
            crop_area_limits=[
                {
                    "afgrode_kode": 999,
                    "min_area_ha": 10,
                }
            ]
        )
        simulation, _ = self.create(auto=True, constraints=constraints)
        self.execute(simulation)
        self.assertEqual(self.job(simulation.id).status, "done")
        result = simulation_store.get_result("farm", simulation.id, EMAIL)
        self.assertEqual(result.status, "failed")
        self.assertEqual(result.error.code, "INFEASIBLE")
        self.assertEqual(self.queue.send_message.call_count, 1)

    def test_creation_retry_changes_revision_and_preserves_settings(self):
        simulation, _ = self.create(count=1)
        old_message = self.message(simulation.id)
        self.generated.side_effect = ValueError("bad input")
        self.execute(simulation)
        old = self.job(simulation.id)
        self.assertEqual(old.status, "failed")
        with self.sessions.begin() as session:
            changed = field("source-0000").model_copy(update={"area_ha": 99})
            session.execute(update(field_table).values(data=changed.model_dump(mode="json")))
        retried = submission.retry("farm", simulation.id, EMAIL, optimize_on_create=True)
        new = self.job(simulation.id)
        self.assertEqual(retried.creation_status, "queued")
        self.assertEqual(new.revision, old.revision + 1)
        self.assertNotEqual(old.job_id, new.job_id)
        self.assertEqual(old.data, new.data)
        self.assertTrue(self.message(simulation.id).parameters.optimize_on_create)
        worker.execute(old_message, CONTEXT, sqs_delivery=True)
        with creation_store.execution_session(simulation.id) as session:
            self.assertFalse(creation_store.checkpoint(session, old_message, "old", {}, None, None))
            self.assertFalse(creation_store.complete(session, old_message))
        self.assertEqual(self.generated.call_count, 1)
        self.generated.side_effect = None
        self.execute(simulation)
        self.assertEqual(self.job(simulation.id).status, "done")
        self.assertEqual(
            simulation_store.list_simulation_fields("farm", simulation.id, EMAIL)[0].area_ha, 99
        )
        self.assertEqual(simulation_store.get_result("farm", simulation.id, EMAIL).status, "queued")

    def test_local_execution_chains_optimization_using_local_dispatch(self):
        self.attach(1)
        tasks = BackgroundTasks()
        with patch.dict("os.environ", {"APP_ENV": "development"}):
            simulation = submission.submit(
                "farm",
                CreateSimulationRequest(
                    name="local",
                    optimize_on_create=True,
                    saedskiftevarianter=["1"],
                    n_norm_procenter=["100"],
                ),
                EMAIL,
                background_tasks=tasks,
            )
        with patch.object(worker.optimization_jobs, "execute_local_when_ready") as optimize:
            asyncio.run(tasks())
        self.assertEqual(self.job(simulation.id).status, "done")
        optimize.assert_called_once()
        self.queue.send_message.assert_not_called()

    def test_local_failures_before_claim_end_in_a_retryable_failure(self):
        simulation, _ = self.create(count=1)
        with (
            patch.object(
                creation_store, "claim", side_effect=RuntimeError("initialization failed")
            ),
            patch.object(worker.time, "sleep") as sleep,
        ):
            worker.execute_local(self.message(simulation.id))
        self.assertEqual(sleep.call_count, 2)
        self.assertEqual(self.job(simulation.id).status, "failed")

    def test_local_transient_failures_stop_after_three_attempts(self):
        simulation, _ = self.create(count=1)
        self.generated.side_effect = RuntimeError("transient")
        with patch.object(worker.time, "sleep") as sleep:
            worker.execute_local(self.message(simulation.id))
        self.assertEqual(self.generated.call_count, 3)
        self.assertEqual(sleep.call_count, 2)
        self.assertEqual(self.job(simulation.id).status, "failed")

    def test_local_restart_fails_interrupted_jobs_and_skips_live_workers(self):
        simulation, _ = self.create(count=1)
        creation_store.recover_local_jobs()
        self.assertEqual(self.job(simulation.id).status, "failed")
        self.assertEqual(self.job("sim").status, "done")
        submission.retry("farm", simulation.id, EMAIL)
        with creation_store.execution_session(simulation.id) as session:
            creation_store.claim(session, self.message(simulation.id))
            creation_store.recover_local_jobs()
            self.assertEqual(self.job(simulation.id).status, "running")
        creation_store.recover_local_jobs()
        self.assertEqual(self.job(simulation.id).status, "failed")
        self.assertEqual(self.job("sim").status, "done")

    def test_creation_migration_round_trip_preserves_existing_simulations(self):
        path = (
            Path(__file__).parents[1]
            / "database/migrations/versions/20261009_0001_simulation_creation.py"
        )
        spec = importlib.util.spec_from_file_location("creation_migration", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with self.engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
                migration.upgrade()
            self.assertEqual(connection.execute(select(setups.c.id)).scalars().all(), ["sim"])
            columns = {c["name"]: c for c in inspect(connection).get_columns("simulation")}
            self.assertNotIn("creation_job", columns)
            self.assertEqual(str(columns["creation_status"]["type"]), "TEXT")
            self.assertFalse(columns["creation_status"]["nullable"])
            self.assertFalse(
                any(
                    i["name"] == "ix_simulation_creation_request"
                    for i in inspect(connection).get_indexes("simulation")
                )
            )
            row = connection.execute(
                select(setups.c.data, setups.c.revision, setups.c.creation_status)
            ).one()
            self.assertEqual(row.creation_status, "done")
            self.assertEqual(
                simulation_store._model(connection, "sim", row).creation_status, "done"
            )
            with self.assertRaises(IntegrityError), connection.begin_nested():
                connection.execute(update(setups).values(creation_status="unknown"))
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
            self.assertEqual(connection.execute(select(setups.c.id)).scalars().all(), ["sim"])
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
