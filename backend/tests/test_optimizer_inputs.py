"""Compact cache parity, selective detail reads, and derived-column migration."""

import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import event, inspect, null, select, text, update
from sqlalchemy.exc import IntegrityError
from test_optimizer_lifecycle import (
    CONTEXT,
    EMAIL,
    DatabaseTests,
    caches,
    candidate,
    large_candidates,
    replace_cached_candidates,
    results,
    setups,
)

from app.data import optimization_store
from app.data import simulation_store as store
from app.data.optimizer_inputs import optimizer_input, parse_optimizer_input
from app.domain.rotation_candidate import SimulationFieldCandidates
from app.domain.simulation import OptimizationConstraints
from app.services.scenario.rotations import compute_yearly_summary
from plantperform_optimizer import orchestrator, worker


def rich_candidate(value=200, variant="2"):
    result = candidate(value, variant)
    for year in result.years:
        year.db_detail = {"udbytteenhed": "FE/ha", "udbytte": 125, "costs": [1, 2, 3]}
        year.leaching_detail = {"walkthrough": {"inputs": [4, 5, 6]}}
        year.husdyrgodning_ton_pr_ha = 7
        year.afgrode_norm_kgn_ha = 150
    return result


class CompactExecutionTests(DatabaseTests):
    def prepare(self):
        low, high = rich_candidate(100, "1"), rich_candidate()
        for year in low.years:
            year.year.afgrode_kode = 2
        with self.sessions.begin() as session:
            replace_cached_candidates(
                session,
                {
                    f: SimulationFieldCandidates(
                        field_id=f,
                        jbnr=5,
                        candidates=[low, high],
                        real_history={"2025": {"afgrode_kode": 1, "n_input": 120}},
                    ).model_dump(mode="json")
                    for f in ("field-b", "field-a")
                },
            )

    def test_full_and_compact_average_yearly_exclusions_and_constraints_match(self):
        self.prepare()
        run = self.submit()
        _, _, token = optimization_store.claim("sim", run.run_id)
        compact = optimization_store.load_snapshot("sim", run.run_id, token, 0)
        with self.sessions() as session:
            full = (*compact[:2], store._candidates(session, "sim"))
        for yearly in (False, True):
            for excluded in (frozenset(), frozenset({1})):
                for constrained in (False, True):
                    with self.subTest(yearly=yearly, excluded=excluded, constrained=constrained):
                        simulation = compact[0].model_copy(
                            update={
                                "constraints": (
                                    OptimizationConstraints(
                                        min_fen=1,
                                        max_fen=100,
                                        crop_area_limits=[{"afgrode_kode": 2, "max_area_ha": 4}],
                                    )
                                    if constrained
                                    else OptimizationConstraints()
                                )
                            }
                        )
                        if yearly:

                            def solve(snapshot, simulation=simulation, excluded=excluded):
                                return orchestrator.run_yearly_optimization(
                                    "farm",
                                    "sim",
                                    1,
                                    {None: (100,) * 8},
                                    100,
                                    excluded,
                                    EMAIL,
                                    snapshot=(simulation, *snapshot[1:]),
                                )
                        else:

                            def solve(snapshot, simulation=simulation, excluded=excluded):
                                return orchestrator.run_optimization(
                                    "farm",
                                    "sim",
                                    1,
                                    excluded,
                                    EMAIL,
                                    snapshot=(simulation, *snapshot[1:]),
                                )

                        expected, actual = solve(full), solve(compact)
                        self.assertEqual(actual.output, expected.output)
                        self.assertEqual(actual.fields, expected.fields)
                        hydrated = optimization_store.hydrate_winners(
                            "sim", run.run_id, token, 0, actual.selected_candidates
                        )
                        self.assertEqual(
                            {k: v.model_dump() for k, v in hydrated.items()},
                            {k: v.model_dump() for k, v in expected.selected_candidates.items()},
                        )
                        self.assertTrue(
                            all(
                                c._cache_position is not None
                                for c in actual.selected_candidates.values()
                            )
                        )

    def test_overlay_precedence_preserves_full_details_and_clears_cache_provenance(self):
        self.prepare()
        with self.sessions.begin() as session:
            fields = session.execute(select(setups.c.fields)).scalar_one()
            fields["field-b"].update(
                manual_candidate=rich_candidate(1000).model_dump(mode="json"),
                fixed_candidate=rich_candidate(300).model_dump(mode="json"),
                allowed_rotation_ids=["1:2:100"],
                fixed={"rotation_id": "1:2:100"},
            )
            session.execute(update(setups).values(fields=fields))
            session.execute(
                update(results).values(
                    output={
                        "selected_candidates": {
                            "field-b": rich_candidate(500).model_dump(mode="json")
                        }
                    }
                )
            )
            full = store._candidates(session, "sim")
            compact = store._candidates(session, "sim", compact=True)
        self.assertEqual(
            [c.ref for c in compact[0].candidates], [c.ref for c in full[0].candidates]
        )
        winner = compact[0].candidates[-1]
        self.assertEqual(winner.model_dump(), full[0].candidates[-1].model_dump())
        self.assertEqual(winner.avg_db_kr_ha, 300)
        self.assertIsNone(winner._cache_position)
        run = self.submit()
        worker.execute("sim", run.run_id, CONTEXT)
        self.assertEqual(
            self.result().selected_candidates["field-b"].model_dump(), winner.model_dump()
        )

    def test_cached_and_shifted_winners_save_rich_details_without_internal_positions(self):
        self.prepare()
        run = self.submit()
        worker.execute("sim", run.run_id, CONTEXT)
        winner = self.result().selected_candidates["field-b"]
        self.assertEqual(winner.model_dump(), rich_candidate().model_dump())
        self.assertNotIn("_cache_position", self.row().output["selected_candidates"]["field-b"])
        base = rich_candidate().model_copy(update={"active_len": 2})
        shifted = rich_candidate(300, "2+start2").model_copy(
            update={
                "active_len": 2,
                "base_ref": base.ref,
                "start_year": 2,
            }
        )
        with self.sessions.begin() as session:
            session.execute(update(results).values(output=None))
            replace_cached_candidates(
                session,
                {
                    f: SimulationFieldCandidates(field_id=f, jbnr=5, candidates=[base]).model_dump(
                        mode="json"
                    )
                    for f in ("field-b", "field-a")
                },
            )
        with patch.object(
            orchestrator.candidate_evaluator, "evaluate_with_overrides", return_value=shifted
        ):
            run = self.submit(self.request(yearly=True), "yearly")
            worker.execute("sim", run.run_id, CONTEXT)
        self.assertEqual(
            self.result().selected_candidates["field-b"].model_dump(), shifted.model_dump()
        )

    def test_hydration_rechecks_revision_lease_run_and_deletion(self):
        self.prepare()
        run = self.submit()
        _, _, token = optimization_store.claim("sim", run.run_id)
        snapshot = optimization_store.load_snapshot("sim", run.run_id, token, 0)
        selected = {row.field_id: row.candidates[1] for row in snapshot[2]}
        self.assertIsNone(
            optimization_store.hydrate_winners("sim", run.run_id, "wrong", 0, selected)
        )
        self.assertIsNone(
            optimization_store.hydrate_winners("sim", "wrong-run", token, 0, selected)
        )
        with self.sessions.begin() as session:
            session.execute(
                update(results).values(lease_expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
        self.assertIsNone(optimization_store.hydrate_winners("sim", run.run_id, token, 0, selected))
        with self.sessions.begin() as session:
            session.execute(
                update(results).values(lease_expires_at=datetime.now(UTC) + timedelta(seconds=900))
            )
        self.edit(name="edited during solve")
        self.assertIsNone(optimization_store.hydrate_winners("sim", run.run_id, token, 0, selected))
        store.delete_simulation("farm", "sim", EMAIL)
        self.assertIsNone(optimization_store.hydrate_winners("sim", run.run_id, token, 0, selected))

    def test_yearly_summary_reads_only_chosen_evaluations_and_preserves_fodder(self):
        self.prepare()
        with self.sessions.begin() as session:
            fields = session.execute(select(setups.c.fields)).scalar_one()
            for setup in fields.values():
                setup["baseline"]["rotation_id"] = "1:2:100"
            session.execute(update(setups).values(fields=fields))
        queries = []

        def record(connection, cursor, statement, parameters, context, executemany):
            queries.append(statement)

        event.listen(self.engine, "before_cursor_execute", record)
        try:
            with patch.object(store, "_candidates", side_effect=AssertionError("full cache read")):
                summary = compute_yearly_summary("farm", "sim", EMAIL)
        finally:
            event.remove(self.engine, "before_cursor_execute", record)
        self.assertEqual(len(summary), 1)
        self.assertEqual((summary[0].total_db2, summary[0].total_fen), (800, 500))
        self.assertEqual(summary[0].total_n_load_kg, 20)
        self.assertEqual(summary[0].field_count, 2)
        self.assertFalse(
            any("SELECT simulation_field_candidates.data \n" in sql for sql in queries)
        )
        self.assertIsNone(compute_yearly_summary("farm", "sim", "outsider@example.com"))

    def test_summary_overlay_precedence_avoids_even_compact_cache_reads(self):
        self.prepare()
        manual, previous, fixed = (rich_candidate(value) for value in (110, 220, 330))
        for evaluation in (manual, previous, fixed):
            for year in evaluation.years:
                year.db_detail["udbytte"] = evaluation.avg_db_kr_ha / 10
        with self.sessions.begin() as session:
            fields = session.execute(select(setups.c.fields)).scalar_one()
            for setup in fields.values():
                setup["baseline"]["rotation_id"] = manual.ref.to_id()
                setup["manual_candidate"] = manual.model_dump(mode="json")
            fields["field-b"]["fixed_candidate"] = fixed.model_dump(mode="json")
            session.execute(update(setups).values(fields=fields))
            session.execute(
                update(results).values(
                    output={
                        "selected_candidates": {f: previous.model_dump(mode="json") for f in fields}
                    }
                )
            )
            # Saved chosen evaluations suffice even if unselected full data is unreadable.
            session.execute(update(caches).values(data={"invalid": True}, optimizer_input={}))
        summary = compute_yearly_summary("farm", "sim", EMAIL)
        self.assertEqual((summary[0].total_db2, summary[0].total_fen), (1100, 110))
        with self.sessions.begin() as session:
            fields["field-b"].pop("fixed_candidate")
            session.execute(update(setups).values(fields=fields))
            session.execute(
                update(results).values(
                    output={"selected_candidates": {"field-a": previous.model_dump(mode="json")}}
                )
            )
        summary = compute_yearly_summary("farm", "sim", EMAIL)
        self.assertEqual((summary[0].total_db2, summary[0].total_fen), (660, 66))

    def test_unoptimized_summary_is_empty_without_reading_candidate_data(self):
        with self.sessions.begin() as session:
            session.execute(update(caches).values(data={}, optimizer_input={}))
        self.assertEqual(compute_yearly_summary("farm", "sim", EMAIL), ())


class CompactMigrationTests(DatabaseTests):
    def setUp(self):
        super().setUp()
        path = (
            Path(__file__).parents[1]
            / "database/migrations/versions/20261007_0001_optimizer_inputs.py"
        )
        spec = importlib.util.spec_from_file_location("compact_migration", path)
        self.migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.migration)

    def migrate(self, connection, direction="upgrade"):
        with Operations.context(MigrationContext.configure(connection)):
            getattr(self.migration, direction)()

    def test_backfill_empty_and_legacy_defaults_round_trip_without_changing_full_data(self):
        full = SimulationFieldCandidates(field_id="field-b", jbnr=5, candidates=[rich_candidate()])
        empty = SimulationFieldCandidates(field_id="field-a", jbnr=1, candidates=[])
        data = {"field-b": full.model_dump(mode="json"), "field-a": empty.model_dump(mode="json")}
        for key in ("base_ref", "overrides", "start_year"):
            data["field-b"]["candidates"][0].pop(key)
        with self.engine.begin() as connection:
            replace_cached_candidates(connection, data)
            before = connection.execute(
                select(
                    caches.c.id, caches.c.data, caches.c.created_at, caches.c.updated_at
                ).order_by(caches.c.id)
            ).all()
            self.migrate(connection, "downgrade")
            self.migrate(connection)
            rows = connection.execute(select(caches)).all()
            for row in rows:
                expected = optimizer_input(
                    SimulationFieldCandidates.model_validate(data[row.field_id])
                )
                self.assertEqual(row.optimizer_input, expected)
                self.assertEqual(parse_optimizer_input(row.optimizer_input).jbnr, row.data["jbnr"])
            self.assertFalse(
                next(
                    c
                    for c in inspect(connection).get_columns(caches.name)
                    if c["name"] == "optimizer_input"
                )["nullable"]
            )
        with self.assertRaises(IntegrityError), self.engine.begin() as connection:
            connection.execute(update(caches).values(optimizer_input=null()))
        with self.engine.begin() as connection:
            self.migrate(connection, "downgrade")
            after = connection.execute(
                select(
                    caches.c.id, caches.c.data, caches.c.created_at, caches.c.updated_at
                ).order_by(caches.c.id)
            ).all()
            self.assertEqual(after, before)

    def test_large_fields_backfill_individually_and_empty_table_migrates(self):
        data = {
            f: SimulationFieldCandidates(
                field_id=f, jbnr=5, candidates=large_candidates()
            ).model_dump(mode="json")
            for f in ("field-b", "field-a")
        }
        with self.engine.begin() as connection:
            replace_cached_candidates(connection, data)
            self.migrate(connection, "downgrade")
            self.migrate(connection)
            for row in connection.execute(select(caches.c.optimizer_input)):
                self.assertEqual(len(row.optimizer_input["candidates"]), 2)
                self.assertNotIn(
                    "leaching_detail", row.optimizer_input["candidates"][1]["years"][0]
                )
            connection.execute(text("DELETE FROM simulation_field_candidates"))
            self.migrate(connection, "downgrade")
            self.migrate(connection)
            self.assertEqual(connection.execute(select(caches)).all(), [])
