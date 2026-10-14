"""Settings-only creation and real worker orchestration without persisted alternatives."""

from copy import deepcopy
from unittest.mock import patch
from uuid import uuid4

from legacy_candidates import caches
from sqlalchemy import delete, event, insert, inspect, select, update
from test_optimizer_lifecycle import CONTEXT, EMAIL, DatabaseTests, candidate, field

from app.data import repository, simulation_store
from app.data import simulation_settings_store as settings
from app.data.db import field_table, metadata
from app.data.db import simulation_read_model_table as views
from app.data.db import simulation_result_table as results
from app.domain.optimization import OptimizationSettings, OptimizeSimulationRequest
from app.domain.rotation_candidate import SimulationFieldCandidates
from app.domain.simulation import CreateSimulationRequest, UpdateSimulationRequest
from app.services.economics import runner as economics_worker
from app.services.optimization import jobs
from plantperform_fargate import preparation, worker


class SimulationSettingsTests(DatabaseTests):
    def setUp(self):
        super().setUp()
        caches.drop(self.engine)
        self.assertNotIn("simulation_field_candidates", metadata.tables)
        metadata.create_all(self.engine, tables=[field_table])
        self.enterContext(patch.object(worker, "prepare", wraps=preparation.prepare))
        self.enterContext(patch.object(worker, "hydrate", wraps=preparation.hydrate))
        self.enterContext(
            patch.object(preparation.candidate_evaluator, "prepare_candidates", return_value=[])
        )
        self.enterContext(
            patch.object(repository, "_registry_contexts_for_imk_ids", return_value={})
        )
        self.enterContext(
            patch.object(repository, "prepare_simulation_field", side_effect=self.generate)
        )
        self.enterContext(
            patch.object(
                preparation.candidate_evaluator,
                "evaluate_with_overrides",
                side_effect=self.evaluate,
            )
        )
        with self.sessions.begin() as session:
            for value in (field("farm-a"), field("farm-b")):
                session.execute(
                    insert(field_table).values(
                        id=value.id, farm_id="farm", data=value.model_dump(mode="json")
                    )
                )

    def chosen(self, variant="1", organic_n=0):
        value = candidate(100 + organic_n + (100 if variant == "2" else 0), variant)
        value.active_len = 8
        for year in value.years:
            year.db_detail = {
                "calculation_inputs": {
                    "afgrodekode": 1,
                    "driftsform": "Konventionel",
                    "jbnr": 4,
                    "mncs": 100,
                },
                "udbytteenhed": "FE/ha",
                "udbytte": 2,
            }
        return value

    def generate(self, value, registry, request, **kwargs):
        values = [self.chosen(variant, request.godning.org_mineral_n) for variant in ("1", "2")]
        return simulation_store.split_field(
            value.model_dump(mode="json")
        ), SimulationFieldCandidates(field_id=value.id, jbnr=4, candidates=values)

    def evaluate(self, ref, overrides, start_year=1, **kwargs):
        value = self.chosen(ref.variant, kwargs.get("org_mineral_n", 0))
        value.start_year = start_year
        value.overrides = overrides
        return value

    def create(self, **kwargs):
        return settings.create(
            "farm",
            CreateSimulationRequest(
                name="New", saedskiftevarianter=["1"], n_norm_procenter=["100"], **kwargs
            ),
            EMAIL,
        )

    def optimize(self, simulation, kind="optimize"):
        request = OptimizeSimulationRequest(expected_revision=simulation.revision, run_id=uuid4())
        accepted = jobs.submit("farm", simulation.id, EMAIL, kind, request)
        worker.execute(simulation.id, accepted.run_id, CONTEXT)
        result = simulation_store.get_result("farm", simulation.id, EMAIL)
        self.assertEqual(result.status, "completed", result.error)
        return result

    def test_creation_does_no_field_or_candidate_work_and_is_idempotent_without_queue(self):
        queries = []

        def observe(conn, cursor, statement, parameters, context, many):
            queries.append(statement)

        event.listen(self.engine, "before_cursor_execute", observe)
        try:
            identity = uuid4()
            with patch.dict("os.environ", {"OPTIMIZER_QUEUE_URL": ""}):
                first = self.create(request_id=identity)
                second = self.create(request_id=identity)
            self.assertEqual(first.id, second.id)
            self.assertFalse(first.fields_initialized)
            self.assertEqual(first.result.status, "not_started")
            self.assertFalse(
                any(
                    "simulation_field_candidates" in query or "field.data" in query
                    for query in queries
                )
            )
            self.queue.send_message.assert_not_called()
        finally:
            event.remove(self.engine, "before_cursor_execute", observe)

    def test_name_does_not_change_revision_but_settings_do_and_round_trip(self):
        created = self.create()
        renamed = settings.update_settings(
            "farm", created.id, UpdateSimulationRequest(expected_revision=0, name="Changed"), EMAIL
        )
        self.assertEqual((renamed.name, renamed.revision), ("Changed", 0))
        options = OptimizationSettings(kind="yearly", excluded_afgrodekoder=[11], db2_swing_pct=20)
        edited = settings.update_settings(
            "farm",
            created.id,
            UpdateSimulationRequest(expected_revision=0, optimization_settings=options),
            EMAIL,
        )
        self.assertEqual(edited.revision, 1)
        self.assertEqual(edited.optimization_settings, options)
        with self.assertRaises(simulation_store.SetupRevisionConflictError):
            settings.update_settings(
                "farm", created.id, UpdateSimulationRequest(expected_revision=0, name="Lost"), EMAIL
            )

    def test_settings_can_be_saved_without_summary_before_optimization(self):
        from app.data import read_model_store

        created = self.create(optimization_settings=OptimizationSettings(db2_swing_pct=10))
        self.optimize(created)
        with self.sessions.begin() as session:
            session.execute(delete(views).where(views.c.simulation_id == created.id))
        fields = repository.list_simulation_fields("farm", created.id, EMAIL)
        edited = settings.update_settings(
            "farm",
            created.id,
            UpdateSimulationRequest(
                expected_revision=0, optimization_settings={"db2_swing_pct": 20}
            ),
            EMAIL,
        )
        self.assertEqual(edited.revision, 1)
        self.assertEqual(edited.optimization_settings.db2_swing_pct, 20)
        view = read_model_store.get_simulation_view("farm", created.id, EMAIL)
        self.assertEqual(view["status"], "missing")
        self.assertEqual(repository.list_simulation_fields("farm", created.id, EMAIL), fields)
        self.optimize(edited)
        self.assertEqual(
            read_model_store.get_simulation_view("farm", created.id, EMAIL)["status"], "done"
        )

    def test_partial_nested_settings_preserve_unsupplied_values(self):
        created = self.create(
            godning={"mineralsk_andel_pct": 50},
            constraints={"max_fen": 100},
            optimization_settings=OptimizationSettings(excluded_afgrodekoder=[11]),
        )
        changed = settings.update_settings(
            "farm",
            created.id,
            UpdateSimulationRequest(
                expected_revision=0,
                godning={"org_mineral_n": 10},
                constraints={"min_fen": 5},
                optimization_settings={"db2_swing_pct": 30},
            ),
            EMAIL,
        )
        self.assertEqual(changed.godning.mineralsk_andel_pct, 50)
        self.assertEqual(changed.constraints.max_fen, 100)
        self.assertEqual(changed.optimization_settings.excluded_afgrodekoder, [11])

    def test_legacy_saved_duration_is_ignored_without_invalidating_the_result(self):
        from app.data.db import simulation_table as setups

        created = self.create()
        self.optimize(created)
        with self.sessions.begin() as session:
            data = session.execute(
                select(setups.c.data).where(setups.c.id == created.id)
            ).scalar_one()
            data["optimization_settings"].update(time_limit_seconds=1, timeLimitSeconds=7200)
            session.execute(update(setups).where(setups.c.id == created.id).values(data=data))
        current = repository.get_simulation("farm", created.id, EMAIL)
        self.assertNotIn("time_limit_seconds", current.optimization_settings.model_dump())
        edited = settings.update_settings(
            "farm",
            created.id,
            UpdateSimulationRequest(
                expected_revision=0, optimization_settings={"timeLimitSeconds": 2}
            ),
            EMAIL,
        )
        self.assertEqual(edited.revision, 0)
        self.assertEqual(edited.result.status, "completed")

    def test_active_run_allows_rename_and_rejects_calculation_and_field_edits(self):
        created = self.create()
        jobs.submit(
            "farm",
            created.id,
            EMAIL,
            "optimize",
            OptimizeSimulationRequest(expected_revision=0, run_id=uuid4()),
        )
        renamed = settings.update_settings(
            "farm",
            created.id,
            UpdateSimulationRequest(expected_revision=0, name="During run"),
            EMAIL,
        )
        self.assertEqual(renamed.revision, 0)
        with self.assertRaises(simulation_store.SetupRevisionConflictError):
            settings.update_settings(
                "farm",
                created.id,
                UpdateSimulationRequest(expected_revision=0, eea_fdato="30/8"),
                EMAIL,
            )

    def test_run_saves_only_winners_and_rerun_keeps_fields_and_edits(self):
        created = self.create()
        first = self.optimize(created)
        self.assertEqual(len(first.selected_candidates), 2)
        with self.sessions() as session:
            self.assertFalse(inspect(session.connection()).has_table("simulation_field_candidates"))
            prepared = session.execute(
                select(views.c.prepared).where(views.c.simulation_id == created.id)
            ).scalar_one()
        self.assertNotIn("candidate_sets", prepared)
        ids = [f.id for f in first.response.fields]
        from app.domain.field import UpdateFieldRequest

        simulation_store.update_simulation_field(
            "farm", created.id, ids[0], UpdateFieldRequest(name="Edited"), EMAIL
        )
        current = repository.get_simulation("farm", created.id, EMAIL)
        changed = settings.update_settings(
            "farm",
            created.id,
            UpdateSimulationRequest(
                expected_revision=current.revision, godning={"org_mineral_n": 10}
            ),
            EMAIL,
        )
        second = self.optimize(changed)
        self.assertEqual([f.id for f in second.response.fields], ids)
        self.assertEqual(second.response.fields[0].name, "Edited")
        self.assertGreater(second.response.objective_db2, first.response.objective_db2)
        self.assertEqual(second.fields_before[0].db2, first.response.fields[0].db2)

    def test_retry_reuses_initialized_fields_and_captures_settings_before_rename(self):
        created = self.create()
        run = jobs.submit(
            "farm",
            created.id,
            EMAIL,
            "optimize",
            OptimizeSimulationRequest(expected_revision=0, run_id=uuid4()),
        )
        claimed, _, token = __import__("app.data.optimization_store", fromlist=["claim"]).claim(
            created.id, run.run_id
        )
        from app.data import optimization_store

        first = optimization_store.load_snapshot(created.id, run.run_id, token, 0)
        with self.sessions.begin() as session:
            session.execute(field_table.delete())
        second = optimization_store.load_snapshot(created.id, run.run_id, token, 0)
        self.assertEqual([f.id for f in first[1]], [f.id for f in second[1]])
        self.assertEqual(len(first[1]), 2)

    def test_economics_reprices_only_chosen_results_atomically(self):
        created = self.create()
        original = self.optimize(created)
        with self.sessions() as session:
            previous = deepcopy(
                session.execute(
                    select(results.c.output).where(results.c.simulation_id == created.id)
                ).scalar_one()
            )
        from app.data import economics_recalculation_store
        from app.domain.economics import RecalculateEconomicsRequest

        _, job = economics_recalculation_store.submit(
            "farm",
            created.id,
            RecalculateEconomicsRequest(
                expected_revision=0, request_id=uuid4(), refresh_from_module=False
            ),
            EMAIL,
        )

        def price(**inputs):
            return {
                "db": 500,
                "udbytteenhed": "FE/ha",
                "udbytte": 3,
                "calculation_inputs": {k: v for k, v in inputs.items() if k != "economics_key"},
            }

        with (
            patch("app.services.economics.recalculation.calculate_db", side_effect=price),
            patch.object(
                repository, "prepare_simulation_field", side_effect=AssertionError("No generation")
            ),
            patch.object(worker, "run_optimization", side_effect=AssertionError("No optimization")),
            patch.object(
                preparation.candidate_evaluator,
                "evaluate_with_overrides",
                side_effect=AssertionError("No nitrogen calculation"),
            ),
        ):
            economics_worker.execute(job, CONTEXT)
        current = repository.list_simulation_fields("farm", created.id, EMAIL)
        for old, new in zip(original.response.fields, current, strict=True):
            self.assertEqual(
                (old.rotation_id, old.n_load, old.leaching),
                (new.rotation_id, new.n_load, new.leaching),
            )
            self.assertEqual(new.db2, 1000)
            self.assertEqual(new.fen, 6)
        with self.sessions() as session:
            self.assertEqual(
                session.execute(
                    select(results.c.output).where(results.c.simulation_id == created.id)
                ).scalar_one(),
                previous,
            )
            self.assertFalse(inspect(session.connection()).has_table("simulation_field_candidates"))

    def test_yearly_runs_also_persist_no_alternatives(self):
        created = self.create(optimization_settings=OptimizationSettings(kind="yearly"))
        result = self.optimize(created, "yearly")
        self.assertEqual(result.kind, "yearly")
        with self.sessions() as session:
            self.assertFalse(inspect(session.connection()).has_table("simulation_field_candidates"))

    def test_locked_choice_is_recalculated_and_conflicts_preserve_previous_result(self):
        from app.domain.field import UpdateFieldRequest

        created = self.create()
        previous = self.optimize(created)
        chosen = previous.response.fields[0]
        simulation_store.update_simulation_field(
            "farm",
            created.id,
            chosen.id,
            UpdateFieldRequest(allowed_rotation_ids=[chosen.rotation_id]),
            EMAIL,
        )
        changed = settings.update_settings(
            "farm",
            created.id,
            UpdateSimulationRequest(expected_revision=1, godning={"org_mineral_n": 10}),
            EMAIL,
        )
        recalculated = self.optimize(changed)
        self.assertEqual(recalculated.response.fields[0].rotation_id, chosen.rotation_id)
        self.assertGreater(recalculated.response.fields[0].db2, chosen.db2)
        conflicting = settings.update_settings(
            "farm",
            created.id,
            UpdateSimulationRequest(expected_revision=2, saedskiftevarianter=["9"]),
            EMAIL,
        )
        accepted = jobs.submit(
            "farm",
            created.id,
            EMAIL,
            "optimize",
            OptimizeSimulationRequest(expected_revision=conflicting.revision, run_id=uuid4()),
        )
        worker.execute(created.id, accepted.run_id, CONTEXT)
        failed = simulation_store.get_result("farm", created.id, EMAIL)
        self.assertEqual(failed.error.code, "INFEASIBLE")
        self.assertEqual(failed.response, recalculated.response)
        current = repository.get_simulation_field("farm", created.id, chosen.id, EMAIL)
        self.assertEqual(current.allowed_rotation_ids, [chosen.rotation_id])

    def test_244_field_result_size_is_independent_of_181_alternatives_per_field(self):
        import time
        import tracemalloc

        with self.sessions.begin() as session:
            session.execute(field_table.delete())
            for index in range(244):
                value = field(f"benchmark-{index}")
                session.execute(
                    insert(field_table).values(
                        id=value.id, farm_id="farm", data=value.model_dump(mode="json")
                    )
                )

        def generate(value, registry, request, **kwargs):
            return simulation_store.split_field(
                value.model_dump(mode="json")
            ), SimulationFieldCandidates(
                field_id=value.id,
                jbnr=4,
                candidates=[self.chosen(str(index)) for index in range(1, 182)],
            )

        created = self.create()
        tracemalloc.start()
        started = time.monotonic()
        try:
            with patch.object(repository, "prepare_simulation_field", side_effect=generate):
                self.optimize(created)
            seconds = time.monotonic() - started
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        with self.sessions() as session:
            output = session.execute(
                select(results.c.output).where(results.c.simulation_id == created.id)
            ).scalar_one()
            self.assertFalse(inspect(session.connection()).has_table("simulation_field_candidates"))
        size = len(__import__("json").dumps(output).encode())
        self.assertEqual(len(output["selected_candidates"]), 244)
        self.assertLess(size, 2_000_000)
        print(
            f"244-field benchmark: 44,164 transient alternatives; result_bytes={size}; "
            f"peak_python_bytes={peak}; seconds={seconds:.2f}; candidate_table=absent"
        )
