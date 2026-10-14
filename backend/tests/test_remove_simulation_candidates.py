"""Selected-report preservation and transactional removal of the historical cache."""

import importlib.util
import json
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, select, update
from test_optimizer_lifecycle import (
    CONTEXT,
    EMAIL,
    DatabaseTests,
    caches,
    candidate,
    field,
    replace_cached_candidates,
    results,
    setups,
)

from app.data import economics_recalculation_store, repository
from app.data import simulation_store as store
from app.data.db import metadata
from app.domain.economics import RecalculateEconomicsRequest
from app.domain.rotation_candidate import SimulationFieldCandidates
from app.services.economics import runner as economics_worker
from app.services.scenario.rotations import compute_yearly_summary
from plantperform_fargate import preparation, worker


class RemoveCandidatesTests(DatabaseTests):
    def setUp(self):
        super().setUp()
        path = (
            Path(__file__).parents[1]
            / "database/migrations/versions/20261014_0001_remove_simulation_candidates.py"
        )
        spec = importlib.util.spec_from_file_location("remove_candidates_migration", path)
        self.migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.migration)
        self.saved, self.manual = candidate(), candidate(200, "2")
        for evaluation in (self.saved, self.manual):
            for year in evaluation.years:
                year.db_detail = {
                    "calculation_inputs": {
                        "afgrodekode": 1,
                        "driftsform": "Konventionel",
                        "jbnr": 5,
                        "mncs": 175,
                    },
                    "udbytteenhed": "FE/ha",
                    "udbytte": 2,
                }
        unused = candidate(999, "unused")
        unused.years[0].leaching_detail = {"unselected": "x" * 1_000_000}
        with self.sessions.begin() as session:
            replace_cached_candidates(
                session,
                {
                    key: SimulationFieldCandidates(
                        field_id=key,
                        jbnr=5,
                        candidates=[self.saved, self.manual, unused],
                    ).model_dump(mode="json")
                    for key in ("field-b", "field-a", "removed-field")
                },
            )
            fields = session.execute(select(setups.c.fields)).scalar_one()
            fields["field-b"].update(baseline={"rotation_id": "1:2:100"}, baseline_revision=1)
            fields["field-a"].update(
                allowed_rotation_ids=["1:1:100"],
                fixed={"rotation_id": "1:1:100"},
                fixed_candidate=candidate(300).model_dump(mode="json"),
            )
            session.execute(update(setups).values(fields=fields, revision=1))
            saved_fields = []
            for key in ("field-b", "field-a", "removed-field"):
                value = field(key).model_dump(mode="json")
                value.update(rotation_id="1:1:100", db2=200, n_load=10, leaching=20, fen=4)
                saved_fields.append(value)
            session.execute(
                update(results).values(
                    output={"response": {"fields": saved_fields}, "run_id": "original"},
                    result_revision=0,
                    run_id="retry",
                    status="outdated",
                )
            )

    def migrate(self, connection, direction="upgrade"):
        with Operations.context(MigrationContext.configure(connection)):
            getattr(self.migration, direction)()

    def test_promotes_only_current_and_saved_reports_then_drops_table(self):
        before = self.row()
        with self.engine.begin() as connection:
            self.migrate(connection)
            self.assertFalse(inspect(connection).has_table(caches.name))
        self.assertNotIn(caches.name, metadata.tables)
        after = self.row()
        self.assertEqual(after.output["response"], before.output["response"])
        self.assertEqual(after.output["run_id"], "original")
        self.assertEqual(
            (after.run_id, after.status, after.result_revision), ("retry", "outdated", 0)
        )
        self.assertEqual(
            after.output["selected_candidates"],
            {
                key: self.saved.model_dump(mode="json")
                for key in ("field-b", "field-a", "removed-field")
            },
        )
        detail = store.get_simulation_field_candidate_detail("farm", "sim", "field-b", EMAIL)
        self.assertEqual(detail.model_dump(), self.manual.model_dump())
        self.assertEqual(
            store.get_simulation_field_candidate_detail(
                "farm", "sim", "field-a", EMAIL
            ).avg_db_kr_ha,
            300,
        )
        self.assertEqual(compute_yearly_summary("farm", "sim", EMAIL)[0].total_db2, 1000)
        with self.sessions() as session:
            fields = session.execute(select(setups.c.fields)).scalar_one()
        self.assertEqual(fields["field-b"]["manual_candidate"], self.manual.model_dump(mode="json"))
        self.assertNotIn("manual_candidate", fields["field-a"])
        self.assertLess(len(json.dumps([fields, after.output])), 100_000)
        self.assertNotIn("unselected", json.dumps([fields, after.output]))

    def test_failure_rolls_back_promotions_and_removal(self):
        before = self.row().output
        with self.sessions() as session:
            fields = session.execute(select(setups.c.fields)).scalar_one()
        with self.assertRaises(RuntimeError), self.engine.begin() as connection:
            with patch.object(
                self.migration.op, "drop_table", side_effect=RuntimeError("DDL failure")
            ):
                self.migrate(connection)
        with self.sessions() as session:
            self.assertTrue(inspect(session.connection()).has_table(caches.name))
            self.assertEqual(session.execute(select(setups.c.fields)).scalar_one(), fields)
        self.assertEqual(self.row().output, before)

    def test_downgrade_recreates_empty_schema_and_preserves_reports(self):
        with self.engine.begin() as connection:
            self.migrate(connection)
            selected = connection.execute(select(results.c.output)).scalar_one()
            self.migrate(connection, "downgrade")
            self.assertEqual(connection.execute(select(caches)).all(), [])
            self.assertEqual(
                {column["name"] for column in inspect(connection).get_columns(caches.name)},
                {column.name for column in caches.columns},
            )
            indexes = {
                index["name"]: index for index in inspect(connection).get_indexes(caches.name)
            }
            self.assertTrue(indexes["ix_simulation_field_candidates_simulation_field"]["unique"])
            self.migrate(connection)
            self.assertEqual(connection.execute(select(results.c.output)).scalar_one(), selected)

    def test_unselected_invalid_cache_is_never_read_and_unstarted_result_stays_empty(self):
        with self.sessions.begin() as session:
            session.execute(update(setups).values(fields={}))
            session.execute(update(results).values(output=None, status="not_started"))
            session.execute(update(caches).values(data={"candidates": "invalid"}))
        with self.engine.begin() as connection:
            self.migrate(connection)
        self.assertIsNone(self.row().output)
        self.assertEqual(self.row().status, "not_started")

    def test_migrated_legacy_plan_can_recalculate_db2_without_candidates(self):
        with self.engine.begin() as connection:
            self.migrate(connection)
        before = store.list_simulation_fields("farm", "sim", EMAIL)
        original_output = self.row().output
        _, job = economics_recalculation_store.submit(
            "farm",
            "sim",
            RecalculateEconomicsRequest(
                expected_revision=1, request_id=uuid4(), refresh_from_module=False
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
            patch.object(repository, "prepare_simulation_field", side_effect=AssertionError),
            patch.object(
                preparation.candidate_evaluator,
                "evaluate_with_overrides",
                side_effect=AssertionError,
            ),
            patch.object(worker, "run_optimization", side_effect=AssertionError),
            patch.object(worker, "run_yearly_optimization", side_effect=AssertionError),
        ):
            economics_worker.execute(job, CONTEXT)
        after = store.list_simulation_fields("farm", "sim", EMAIL)
        for old, new in zip(before, after, strict=True):
            self.assertEqual(
                (new.rotation_id, new.n_load, new.leaching),
                (old.rotation_id, old.n_load, old.leaching),
            )
            self.assertEqual((new.db2, new.fen), (1000, 6))
        self.assertEqual(self.row().output, original_output)
