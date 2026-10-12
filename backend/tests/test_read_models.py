"""View parity, bounded reads, and revision-safe queued preparation."""

import importlib.util
import json
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import patch

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient
from sqlalchemy import delete, event, inspect, null, select, update
from test_optimizer_lifecycle import CONTEXT, EMAIL, DatabaseTests, candidate, field

from app import main
from app.auth import AuthenticatedUser, current_user
from app.data import optimization_store, read_model_store, repository, simulation_store
from app.data.db import farm_read_model_table as farm_views
from app.data.db import farm_table, field_table
from app.data.db import field_historical_detail_table as details
from app.data.db import simulation_field_candidates_table as caches
from app.data.db import simulation_read_model_table as views
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.domain.field import CreateFieldRequest, UpdateFieldRequest
from app.domain.read_model import (
    FarmView,
    PreparationJob,
    ReadModelNotReadyError,
    SimulationView,
    preparation_job,
)
from app.domain.rotation_candidate import RotationCandidateRef
from app.services import preparation_jobs, read_models
from app.services.optimization.crop_area_ranges import crop_area_ranges
from app.services.scenario.rotations import compute_yearly_summary
from plantperform_optimizer import read_model_worker


def rich_candidate(variant="1"):
    value = candidate(200, variant)
    value.active_len = 8
    for index, year in enumerate(value.years):
        year.year.afgrode_kode = 252 if index % 2 == 0 else 1
        year.db_detail = {
            "udbytteenhed": "FE/ha" if index % 2 == 0 else "hkg/ha",
            "udbytte": 125,
            "huge_report": "x" * 1000,
        }
        year.leaching_detail = {"W": 1, "EEA": 1, "huge_report": "x" * 1000}
        year.husdyrgodning_ton_pr_ha = 4
        year.tildelt_husdyrgodning_udnyttet_kgn_ha = 20
    return value


class ProjectionTests(unittest.TestCase):
    def test_permanent_crop_preserves_single_cycle_and_eight_year_area_bounds(self):
        value = rich_candidate()
        value.active_len = 1
        values = read_models.compact_years(value)
        self.assertEqual(len(values), 1)
        self.assertEqual(values[0]["fen_fe_ha"], 125)
        bounds = read_models.field_contribution(field(), [read_models.candidate_metadata(value)])
        self.assertEqual(bounds[0]["min_average_ha"], 2)
        self.assertEqual(bounds[0]["min_ha_by_year"], (2,) * 8)

    def test_compact_years_preserve_display_values_without_reports(self):
        full = rich_candidate()
        years = read_models.compact_years(full)
        self.assertEqual([year["fen_fe_ha"] for year in years], [125, 0] * 4)
        self.assertTrue(
            all("db_detail" not in year and "leaching_detail" not in year for year in years)
        )
        self.assertEqual(years[0]["winter_cover"], {"W": 1, "EEA": 1})
        self.assertEqual(years[0]["husdyrgodning_ton_pr_ha"], 4)
        self.assertEqual(years[0]["tildelt_husdyrgodning_udnyttet_kgn_ha"], 20)
        self.assertLess(len(json.dumps(years)), len(full.model_dump_json()) / 3)

    def test_area_contributions_and_yearly_totals_match_existing_calculations(self):
        first, second = rich_candidate(), rich_candidate("2")
        second.years[0].year.afgrode_kode = 11
        fields = [
            field("locked").model_copy(
                update={
                    "rotation_id": first.ref.to_id(),
                    "allowed_rotation_ids": [first.ref.to_id()],
                    "kvotegivende": True,
                    "area_ha": 4,
                }
            ),
            field("unlocked").model_copy(update={"rotation_id": second.ref.to_id()}),
        ]
        full = {f.id: [first, second] for f in fields}
        contributions = {
            f.id: read_models.field_contribution(
                f, [read_models.candidate_metadata(value) for value in full[f.id]]
            )
            for f in fields
        }
        expected = [vars(value) for value in crop_area_ranges(fields, full)]
        self.assertEqual(
            read_models.combine_contributions(contributions), json.loads(json.dumps(expected))
        )
        chosen = {"locked": first, "unlocked": second}
        with patch.object(repository, "selected_evaluations", return_value=(fields, chosen)):
            expected_totals = [
                vars(value) for value in compute_yearly_summary("farm", "sim", EMAIL)
            ]
        self.assertEqual(
            read_models.yearly_totals(
                fields, {key: read_models.compact_years(value) for key, value in chosen.items()}
            ),
            expected_totals,
        )


class ReadModelTests(DatabaseTests):
    def setUp(self):
        super().setUp()
        main.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(email=EMAIL)
        self.addCleanup(main.app.dependency_overrides.clear)

    def publish_result(self):
        value = rich_candidate()
        fields = [
            field(id).model_copy(
                update={
                    "rotation_id": value.ref.to_id(),
                    "crop_rotation": [y.year for y in value.years],
                    "db2": 400,
                    "leaching": 20,
                    "n_load": 10,
                    "fen": 125,
                }
            )
            for id in ("field-b", "field-a")
        ]
        output = {
            "response": {
                "status": "OPTIMAL",
                "objective_db2": 800,
                "total_n_load_kg": 20,
                "total_leaching_kg": 40,
                "total_fen": 250,
                "fields": [f.model_dump(mode="json") for f in fields],
                "assignments": [],
            },
            "fields_before": [field(f.id).model_dump(mode="json") for f in fields],
            "selected_candidates": {f.id: value.model_dump(mode="json") for f in fields},
        }
        run = self.submit()
        _, _, token = optimization_store.claim("sim", run.run_id)
        self.assertTrue(optimization_store.finish("sim", run.run_id, token, 0, output=output))
        return value, run, token, output

    def test_edit_projection_matches_fields_and_preserves_saved_comparison_after_failure(self):
        _, old_run, old_token, output = self.publish_result()
        before = read_model_store.get_simulation_view("farm", "sim", EMAIL)
        self.queue.send_message.reset_mock()
        with self.sessions.begin() as session:
            session.execute(
                update(caches).values(
                    data={"candidates": "unreadable"}, optimizer_input={"candidates": "unreadable"}
                )
            )
        with patch.object(simulation_store, "_candidates", side_effect=AssertionError):
            self.edit(area_ha=4, retention=75)
            self.edit(allowed_rotation_ids=["1:1:100"])
            self.edit(allowed_rotation_ids=[])
        after = read_model_store.get_simulation_view("farm", "sim", EMAIL)
        current = SimulationView.model_validate(after)
        edited = next(f for f in current.data.fields if f.id == "field-b")
        self.assertEqual((edited.db2, edited.fen, edited.n_load), (800, 250, 10))
        self.assertEqual(
            simulation_store.get_simulation_field("farm", "sim", edited.id, EMAIL), edited
        )
        self.assertEqual(current.data.yearly_summary[0].total_db2, 1200)
        self.assertEqual(current.data.yearly_summary[0].total_fen, 750)
        self.assertEqual(after["data"]["saved_result"], before["data"]["saved_result"])
        self.assertGreater(after["view_version"], before["view_version"])
        self.queue.send_message.assert_not_called()
        self.assertFalse(
            optimization_store.finish("sim", old_run.run_id, old_token, 0, output=output)
        )
        run = self.submit(self.request(3))
        _, _, token = optimization_store.claim("sim", run.run_id)
        optimization_store.finish(
            "sim", run.run_id, token, 3, error={"code": "FAILED", "message": "Failed"}
        )
        self.assertEqual(
            read_model_store.get_simulation_view("farm", "sim", EMAIL)["data"], after["data"]
        )

    def test_manual_projection_uses_one_field_and_publishes_transactionally(self):
        _, _, _, _ = self.publish_result()
        before = read_model_store.get_simulation_view("farm", "sim", EMAIL)
        value = rich_candidate("manual")
        value.years[0].year.afgrode_kode = 11
        value.years[0].db_kr_ha = 500
        request = UpdateFieldRequest(
            rotation_id=value.ref.to_id(),
            allowed_rotation_ids=[value.ref.to_id()],
            crop_rotation=[y.year for y in value.years],
            db2=475,
            leaching=20,
            n_load=10,
            fen=125,
        )
        with self.sessions.begin() as session:
            session.execute(
                update(caches).values(
                    data={"candidates": "unreadable"}, optimizer_input={"candidates": "unreadable"}
                )
            )
        with patch.object(simulation_store, "_candidates", side_effect=AssertionError):
            edited = simulation_store.save_manual_rotation(
                "farm", "sim", "field-b", value, request, EMAIL, 0
            )
        after = read_model_store.get_simulation_view("farm", "sim", EMAIL)
        self.assertEqual(after["data"]["field_years"]["field-b"][0]["db_kr_ha"], 500)
        self.assertEqual(after["data"]["saved_result"], before["data"]["saved_result"])
        expected = read_models.combine_contributions(
            {
                "field-b": read_models.field_contribution(
                    edited, [read_models.candidate_metadata(value)]
                )
            }
        )
        actual = {v["afgrode_kode"]: v for v in after["data"]["crop_area_ranges"]}
        self.assertEqual(
            actual[11], next(value for value in expected if value["afgrode_kode"] == 11)
        )
        with (
            patch.object(read_model_store, "update_field_view", side_effect=RuntimeError),
            self.assertRaises(RuntimeError),
        ):
            self.edit(area_ha=8)
        self.assertEqual(read_model_store.get_simulation_view("farm", "sim", EMAIL), after)

    def test_backfill_saved_projection_and_list_metadata_without_full_cache_reads(self):
        self.publish_result()
        before = read_model_store.get_simulation_view("farm", "sim", EMAIL)["data"]
        with self.sessions.begin() as session:
            session.execute(delete(views))
            job = read_model_store.schedule_preparation(session, "prepare_simulation_view", "sim")
        with patch.object(simulation_store, "_candidates", side_effect=AssertionError):
            read_model_worker.execute(job, CONTEXT)
        after = read_model_store.get_simulation_view("farm", "sim", EMAIL)["data"]
        self.assertEqual(after["saved_result"], before["saved_result"])
        self.assertEqual(after["field_years"], before["field_years"])
        listed = simulation_store.list_simulations("farm", EMAIL)
        self.assertEqual(listed[0].comparison_availability, {"kind": "ready"})
        self.assertEqual(
            TestClient(main.app).get("/api/v0/farms/farm/simulations").status_code, 200
        )
        with self.sessions.begin() as session:
            self.assertIsNone(
                read_model_store.schedule_preparation(session, "prepare_simulation_view", "sim")
            )

    def test_backfill_after_failed_new_run_preserves_successful_provenance(self):
        _, successful, _, _ = self.publish_result()
        run = self.submit()
        _, _, token = optimization_store.claim("sim", run.run_id)
        optimization_store.finish(
            "sim", run.run_id, token, 0, error={"code": "FAILED", "message": "Failed"}
        )
        with self.sessions.begin() as session:
            session.execute(delete(views))
            job = read_model_store.schedule_preparation(session, "prepare_simulation_view", "sim")
        read_model_worker.execute(job, CONTEXT)
        saved = read_model_store.get_simulation_view("farm", "sim", EMAIL)["data"]["saved_result"]
        self.assertEqual(saved["run_id"], successful.run_id)

    def test_scheduled_backfill_skips_active_queue_and_stale_preparation_cannot_publish(self):
        with self.sessions.begin() as session:
            session.execute(delete(views))
            job = read_model_store.schedule_preparation(session, "prepare_simulation_view", "sim")
        with self.sessions.begin() as session:
            self.assertIsNone(
                read_model_store.schedule_preparation(session, "prepare_simulation_view", "sim")
            )
        build = read_model_store.build_simulation

        def changed(session, simulation_id):
            data = build(session, simulation_id)
            with self.sessions.begin() as editing:
                editing.execute(update(setups).values(revision=1))
            return data

        with patch.object(read_model_store, "build_simulation", side_effect=changed):
            read_model_worker.execute(job, CONTEXT)
        self.assertIsNone(read_model_store.get_simulation_view("farm", "sim", EMAIL)["data"])

    def test_exhausted_delivery_invalid_input_and_deletion_do_not_publish(self):
        job = self.history_inputs()
        from app.domain.optimization import OptimizationAttemptsExhaustedError

        with self.assertRaises(OptimizationAttemptsExhaustedError):
            read_model_worker.execute(job, CONTEXT, sqs_delivery=True, receive_count=4)
        self.years.assert_not_called()
        self.assertEqual(read_model_store.get_farm_view("farm", EMAIL)["status"], "failed")
        with self.sessions.begin() as session:
            retry = read_model_store.schedule_preparation(session, "prepare_farm_history", "farm")
        self.years.side_effect = ValueError("Invalid input")
        read_model_worker.execute(retry, CONTEXT, sqs_delivery=True)
        self.assertEqual(
            read_model_store.get_farm_view("farm", EMAIL)["error"]["code"], "INVALID_INPUT"
        )
        with self.sessions.begin() as session:
            session.execute(delete(farm_table).where(farm_table.c.id == "farm"))
        read_model_worker.execute(retry, CONTEXT)
        with self.sessions() as session:
            self.assertEqual(session.execute(select(views)).all(), [])
            self.assertEqual(session.execute(select(details)).all(), [])

    def test_ambiguous_queue_failure_cannot_fail_new_retry_generation(self):
        job = self.history_inputs()
        with self.sessions.begin() as session:
            session.execute(update(farm_views).values(status="failed"))
            newer = read_model_store.schedule_preparation(session, "prepare_farm_history", "farm")
        self.queue.send_message.side_effect = RuntimeError("Lost acknowledgement")
        from app.services.optimization.jobs import QueueUnavailableError

        with self.assertRaises(QueueUnavailableError):
            preparation_jobs.dispatch(job)
        with self.sessions() as session:
            row = session.execute(select(farm_views)).one()
            self.assertEqual((row.status, row.generation), ("queued", newer.generation))

    def history_inputs(self, count=2):
        values = [
            field(f"history-{index}").model_copy(update={"imk_id": index + 1})
            for index in range(count)
        ]
        with self.sessions.begin() as session:
            for value in values:
                session.execute(
                    field_table.insert().values(
                        id=value.id, farm_id="farm", data=value.model_dump(mode="json")
                    )
                )
            job = read_model_store.invalidate_farm(session, "farm")
        contexts = {
            value.imk_id: SimpleNamespace(jbnr=5, kvotegivende=index % 2 == 0)
            for index, value in enumerate(values)
        }
        self.enterContext(
            patch.object(repository, "_registry_contexts_for_imk_ids", return_value=contexts)
        )
        self.years = self.enterContext(
            patch.object(
                repository, "_historical_years_for_context", return_value=rich_candidate().years
            )
        )
        return job

    def test_history_worker_stores_details_and_view_and_duplicate_delivery_is_free(self):
        job = self.history_inputs()
        self.assertIsNone(read_model_store.get_farm_view("farm", EMAIL)["data"])
        with self.assertRaises(ReadModelNotReadyError), self.sessions() as session:
            read_model_store.require_farm_ready(session, "farm")
        read_model_worker.execute(job, CONTEXT)
        view = FarmView.model_validate(read_model_store.get_farm_view("farm", EMAIL))
        self.assertEqual(view.status, "done")
        self.assertEqual(len(view.data.fields), 2)
        self.assertEqual(view.data.yearly_summary[0].total_fen, 500)
        with patch.object(repository, "_historical_years_for_context", side_effect=AssertionError):
            read_model_worker.execute(job, CONTEXT, sqs_delivery=True)
            stored = repository.get_field_historical_years("farm", "history-0", EMAIL)
            response = TestClient(main.app).get("/api/v0/farms/farm/view")
            self.assertEqual(response.status_code, 200)
            self.assertNotIn("dbDetail", response.json()["data"]["fieldYears"]["history-0"][0])
            self.assertEqual(stored[0].db_detail["udbytte"], 125)

    def test_stale_history_job_cannot_overwrite_new_inputs(self):
        job = self.history_inputs()
        original = self.years.return_value

        def changed(_):
            with self.sessions.begin() as session:
                read_model_store.invalidate_farm(session, "farm")
            return original

        self.years.side_effect = changed
        read_model_worker.execute(job, CONTEXT)
        with self.sessions() as session:
            self.assertEqual(session.execute(select(farm_views.c.status)).scalar_one(), "queued")
            self.assertEqual(session.execute(select(details.c.field_id)).all(), [])
        self.assertIsNone(read_model_store.get_farm_view("farm", EMAIL)["data"])

    def test_transient_attempt_limit_and_fresh_retry_generation(self):
        job = self.history_inputs()
        self.years.side_effect = RuntimeError("transient")
        for attempt in range(1, 4):
            with self.assertRaises(RuntimeError):
                read_model_worker.execute(job, CONTEXT, sqs_delivery=True, receive_count=attempt)
        with self.sessions() as session:
            self.assertEqual(session.execute(select(farm_views.c.status)).scalar_one(), "failed")
        with self.sessions.begin() as session:
            retry = read_model_store.schedule_preparation(session, "prepare_farm_history", "farm")
        self.assertEqual(retry.generation, 1)
        read_model_worker.execute(job, CONTEXT, sqs_delivery=True, receive_count=4)
        self.years.side_effect = None
        read_model_worker.execute(retry, CONTEXT)
        self.assertEqual(read_model_store.get_farm_view("farm", EMAIL)["status"], "done")

    def test_active_advisory_lock_defers_duplicate_job(self):
        from app.domain.creation import CreationActiveError

        job = self.history_inputs()
        original = read_model_worker._history

        def duplicate(session, job, context):
            with self.assertRaises(CreationActiveError):
                read_model_worker.execute(job, context, sqs_delivery=True)
            return original(session, job, context)

        with patch.object(read_model_worker, "_history", side_effect=duplicate):
            read_model_worker.execute(job, CONTEXT)
        self.assertEqual(self.years.call_count, 2)

    def test_batch_registration_dispatch_inputs_are_small_and_no_history_is_calculated(self):
        contexts = {index: SimpleNamespace(jbnr=5, kvotegivende=True) for index in range(1, 245)}
        with (
            patch.object(repository, "_registry_contexts_for_imk_ids", return_value=contexts),
            patch.object(repository, "_soil_data_for_context", return_value=((), 3, 1)),
            patch.object(repository, "_aktuel_field_state", side_effect=AssertionError),
            patch.object(repository, "_historical_years_for_context", side_effect=AssertionError),
        ):
            fields, job = repository.register_fields(
                "farm",
                [
                    CreateFieldRequest(imk_id=index, name=str(index), area_ha=2)
                    for index in range(1, 245)
                ],
                EMAIL,
            )
        self.assertEqual(len(fields), 244)
        self.assertEqual(job.expected_revision, 1)
        self.assertLess(len(job.model_dump_json()), 300)
        self.assertIsNone(read_model_store.get_farm_view("farm", EMAIL)["data"])
        with self.assertRaises(ReadModelNotReadyError), self.sessions() as session:
            read_model_store.require_farm_ready(session, "farm")

    def test_view_queries_are_constant_with_244_fields_and_44000_candidates(self):
        base = rich_candidate()
        metadata = []
        for variant in range(181):
            value = read_models.candidate_metadata(base)
            value["ref"] = RotationCandidateRef(
                saedskiftevariant="1", variant=str(variant + 1), n_norm_pct="100"
            ).model_dump(mode="json")
            metadata.append(value)
        fields = [
            field(f"large-{index}").model_copy(update={"rotation_id": "1:1:100"})
            for index in range(244)
        ]
        prepared = {value.id: metadata for value in fields}
        years = {value.id: read_models.compact_years(base) for value in fields}
        data, contributions = read_models.simulation_data(fields, prepared, years)
        with self.sessions.begin() as session:
            read_model_store.publish_simulation(
                session,
                "sim",
                0,
                data,
                {
                    "fields": {
                        key: {"base": values, "overlays": {}} for key, values in prepared.items()
                    },
                    "contributions": contributions,
                },
            )
            # Any accidental full or compact candidate read would be invalid.
            session.execute(
                update(caches).values(
                    data={"candidates": "unreadable", "padding": "x" * 10000},
                    optimizer_input={"candidates": "unreadable"},
                )
            )
        queries = []

        def record(conn, cursor, sql, params, context, many):
            queries.append(sql)

        event.listen(self.engine, "before_cursor_execute", record)
        try:
            with patch.object(simulation_store, "_candidates", side_effect=AssertionError):
                view = SimulationView.model_validate(
                    read_model_store.get_simulation_view("farm", "sim", EMAIL)
                )
                self.assertEqual(len(view.data.fields), 244)
                self.assertLess(len(view.model_dump_json()), 1_500_000)
                self.assertEqual(len(queries), 1)
                self.assertFalse(any("simulation_field_candidates" in sql for sql in queries))
                queries.clear()
                metadata_view = read_model_store.get_simulation_view(
                    "farm", "sim", EMAIL, include_data=False
                )
                self.assertIsNone(metadata_view["data"])
                self.assertFalse(
                    any("SELECT simulation_read_model.data," in sql for sql in queries)
                )
        finally:
            event.remove(self.engine, "before_cursor_execute", record)

    def test_selected_detail_reads_one_evaluation_not_its_cache(self):
        value = rich_candidate().model_dump(mode="json")
        with self.sessions.begin() as session:
            fields = session.execute(select(setups.c.fields)).scalar_one()
            fields["field-b"]["fixed"] = {"rotation_id": "1:1:100"}
            fields["field-b"]["allowed_rotation_ids"] = ["1:1:100"]
            fields["field-b"]["fixed_candidate"] = value
            session.execute(update(setups).values(fields=fields))
            session.execute(update(caches).values(data={"candidates": "unreadable"}))
        with patch.object(
            simulation_store, "get_simulation_field_candidates", side_effect=AssertionError
        ):
            detail = simulation_store.get_simulation_field_candidate_detail(
                "farm", "sim", "field-b", EMAIL
            )
        self.assertEqual(detail.model_dump(mode="json"), value)

    def test_detail_sql_selects_fixed_saved_manual_then_original(self):
        self.publish_result()
        for fixed, saved, manual, expected in (
            (500, 400, 300, 500),
            (None, 400, 300, 400),
            (None, None, 300, 300),
            (None, None, None, 100),
        ):
            with self.subTest(expected=expected), self.sessions.begin() as session:
                setup = session.execute(select(setups.c.fields)).scalar_one()
                output = session.execute(select(results.c.output)).scalar_one()
                for name, amount in (("fixed", fixed), ("manual", manual)):
                    if amount is None:
                        setup["field-b"].pop(f"{name}_candidate", None)
                    else:
                        setup["field-b"][f"{name}_candidate"] = candidate(amount).model_dump(
                            mode="json"
                        )
                if saved is None:
                    output["selected_candidates"].pop("field-b", None)
                else:
                    output["selected_candidates"]["field-b"] = candidate(saved).model_dump(
                        mode="json"
                    )
                session.execute(update(setups).values(fields=setup))
                session.execute(update(results).values(output=output))
            with self.sessions() as session:
                value = simulation_store._selected_candidate(session, "sim", "field-b", "1:1:100")
                self.assertEqual(value.avg_db_kr_ha, expected)

    def test_result_and_view_publish_roll_back_together(self):
        run = self.submit()
        _, _, token = optimization_store.claim("sim", run.run_id)
        before = read_model_store.get_simulation_view("farm", "sim", EMAIL)["view_version"]
        with (
            patch.object(read_model_store, "publish_optimization", side_effect=RuntimeError),
            self.assertRaises(RuntimeError),
        ):
            optimization_store.finish("sim", run.run_id, token, 0, output={"test": "value"})
        self.assertEqual(self.result().status, "in_progress")
        self.assertEqual(
            read_model_store.get_simulation_view("farm", "sim", EMAIL)["view_version"], before
        )

    def test_active_view_loads_reuse_preparation(self):
        with self.sessions.begin() as session:
            session.execute(update(views).values(status="queued", data=None))
        with patch.object(read_model_worker, "execute", side_effect=AssertionError):
            response = TestClient(main.app).get("/api/v0/farms/farm/simulations/sim/view")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "queued")
        self.assertIsNone(response.json()["data"])
        self.queue.send_message.assert_not_called()
        self.assertIsNone(read_model_store.get_simulation_view("farm", "sim", "other@example.com"))

    def test_full_views_prepare_missing_snapshots_and_migration_placeholders_once(self):
        for table, key, entity_id, path in (
            (farm_views, "farm_id", "farm", "/api/v0/farms/farm/view"),
            (views, "simulation_id", "sim", "/api/v0/farms/farm/simulations/sim/view"),
        ):
            for state in ("missing", "placeholder", "sql_null", "json_null"):
                with self.subTest(table=table.name, state=state):
                    with self.sessions.begin() as session:
                        session.execute(delete(table))
                        if state != "missing":
                            session.execute(
                                table.insert().values(
                                    **{key: entity_id},
                                    status="queued" if state == "placeholder" else "done",
                                    view_version=0 if state == "placeholder" else 1,
                                    data=None if state == "json_null" else null(),
                                )
                            )
                    self.queue.send_message.reset_mock()
                    client = TestClient(main.app)
                    before = client.get(path + "?include_data=false")
                    self.assertEqual(before.status_code, 200)
                    self.assertIsNone(before.json()["data"])
                    self.queue.send_message.assert_not_called()
                    with patch.object(read_model_worker, "execute", side_effect=AssertionError):
                        response = client.get(path)
                        again = client.get(path)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()["status"], "queued")
                    self.assertGreater(response.json()["viewVersion"], before.json()["viewVersion"])
                    self.assertIsNone(response.json()["data"])
                    self.assertEqual(again.json(), response.json())
                    self.queue.send_message.assert_called_once()
                    job = PreparationJob.model_validate_json(
                        self.queue.send_message.call_args.kwargs["MessageBody"]
                    )
                    self.assertEqual(job.entity_id, entity_id)
                    self.assertEqual(job.expected_revision, 0)

    def test_ready_views_including_empty_history_do_not_queue_or_change_versions(self):
        for path in ("/api/v0/farms/farm/view", "/api/v0/farms/farm/simulations/sim/view"):
            with self.subTest(path=path):
                client = TestClient(main.app)
                first = client.get(path)
                second = client.get(path)
                self.assertEqual(first.json()["status"], "done")
                self.assertIsNotNone(first.json()["data"])
                self.assertEqual(first.json(), second.json())
        self.queue.send_message.assert_not_called()

    def test_revision_mismatches_prepare_the_current_inputs(self):
        for owner, path in (
            (farm_table, "/api/v0/farms/farm/view"),
            (setups, "/api/v0/farms/farm/simulations/sim/view"),
        ):
            with self.subTest(owner=owner.name):
                with self.sessions.begin() as session:
                    session.execute(update(owner).values(revision=1))
                self.queue.send_message.reset_mock()
                response = TestClient(main.app).get(path)
                self.assertEqual(response.json()["status"], "queued")
                self.assertEqual(response.json()["inputRevision"], 1)
                self.queue.send_message.assert_called_once()
                job = PreparationJob.model_validate_json(
                    self.queue.send_message.call_args.kwargs["MessageBody"]
                )
                self.assertEqual(job.expected_revision, 1)

    def test_failed_views_retry_on_full_load_and_reject_the_old_generation(self):
        for table, kind, entity_id, path in (
            (farm_views, "prepare_farm_history", "farm", "/api/v0/farms/farm/view"),
            (views, "prepare_simulation_view", "sim", "/api/v0/farms/farm/simulations/sim/view"),
        ):
            with self.subTest(kind=kind):
                with self.sessions.begin() as session:
                    session.execute(update(table).values(status="failed", generation=3))
                self.queue.send_message.reset_mock()
                client = TestClient(main.app)
                self.assertEqual(
                    client.get(path + "?include_data=false").json()["status"], "failed"
                )
                self.queue.send_message.assert_not_called()
                response = client.get(path)
                self.assertEqual(response.json()["status"], "queued")
                self.queue.send_message.assert_called_once()
                job = PreparationJob.model_validate_json(
                    self.queue.send_message.call_args.kwargs["MessageBody"]
                )
                self.assertEqual((job.entity_id, job.generation), (entity_id, 4))
                old = preparation_job(kind, "farm", 0, "sim" if table is views else None, 3)
                with patch.object(read_model_worker, "_history", side_effect=AssertionError):
                    with patch.object(read_model_worker, "_simulation", side_effect=AssertionError):
                        read_model_worker.execute(old, CONTEXT, sqs_delivery=True, receive_count=4)
                self.assertEqual(
                    client.get(path + "?include_data=false").json()["status"], "queued"
                )
                client.get(path)
                self.queue.send_message.assert_called_once()

    def test_simulation_view_preparation_waits_for_creation(self):
        for status in ("queued", "running", "failed"):
            with self.subTest(status=status):
                with self.sessions.begin() as session:
                    session.execute(update(setups).values(creation_status=status))
                response = TestClient(main.app).get("/api/v0/farms/farm/simulations/sim/view")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["status"], status)
                self.assertIsNone(response.json()["data"])
        self.queue.send_message.assert_not_called()

    def test_unauthorized_and_wrong_farm_loads_do_not_schedule_preparation(self):
        with self.sessions.begin() as session:
            session.execute(delete(farm_views))
            session.execute(delete(views))
        main.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(
            email="other@example.com"
        )
        client = TestClient(main.app)
        for path in ("/api/v0/farms/farm/view", "/api/v0/farms/farm/simulations/sim/view"):
            self.assertEqual(client.get(path).status_code, 404)
        main.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(email=EMAIL)
        self.assertEqual(client.get("/api/v0/farms/other/simulations/sim/view").status_code, 404)
        self.queue.send_message.assert_not_called()
        with self.sessions() as session:
            self.assertEqual(session.execute(select(farm_views)).all(), [])
            self.assertEqual(session.execute(select(views)).all(), [])

    def test_concurrent_full_loads_publish_one_job(self):
        for table, path in (
            (farm_views, "/api/v0/farms/farm/view"),
            (views, "/api/v0/farms/farm/simulations/sim/view"),
        ):
            with self.subTest(table=table.name):
                with self.sessions.begin() as session:
                    session.execute(delete(table))
                self.queue.send_message.reset_mock()
                barrier = Barrier(4)

                def load(_, barrier=barrier, path=path):
                    barrier.wait(timeout=10)
                    return TestClient(main.app).get(path)

                with ThreadPoolExecutor(max_workers=4) as executor:
                    responses = list(executor.map(load, range(4)))
                self.assertTrue(all(response.status_code == 200 for response in responses))
                self.assertTrue(
                    all(response.json()["status"] == "queued" for response in responses)
                )
                self.queue.send_message.assert_called_once()

    def test_automatic_queue_failure_returns_failed_view_and_only_retries_on_reopening(self):
        with self.sessions.begin() as session:
            session.execute(delete(farm_views))
        self.queue.send_message.side_effect = RuntimeError("Queue unavailable")
        client = TestClient(main.app)
        path = "/api/v0/farms/farm/view"
        response = client.get(path)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "failed")
        self.assertEqual(response.json()["error"]["code"], "QUEUE_UNAVAILABLE")
        for _ in range(3):
            self.assertEqual(client.get(path + "?include_data=false").json(), response.json())
        self.queue.send_message.assert_called_once()
        self.queue.send_message.side_effect = None
        self.assertEqual(client.get(path).json()["status"], "queued")
        job = PreparationJob.model_validate_json(
            self.queue.send_message.call_args.kwargs["MessageBody"]
        )
        self.assertEqual(job.generation, 1)
        with self.sessions.begin() as session:
            session.execute(update(farm_views).values(status="failed"))
        self.queue.send_message.side_effect = RuntimeError("Queue unavailable")
        self.assertEqual(client.post("/api/v0/farms/farm/history/retry").status_code, 503)

    def test_missing_transport_becomes_failed_view_without_calling_sqs(self):
        with self.sessions.begin() as session:
            session.execute(delete(views))
        with patch.dict(os.environ, {"OPTIMIZER_QUEUE_URL": ""}):
            response = TestClient(main.app).get("/api/v0/farms/farm/simulations/sim/view")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "failed")
        self.assertEqual(response.json()["error"]["code"], "QUEUE_UNAVAILABLE")
        self.queue.send_message.assert_not_called()

    def test_local_full_load_adds_a_background_preparation(self):
        with self.sessions.begin() as session:
            session.execute(delete(views))
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            with patch.object(read_model_worker, "execute_local") as execute:
                response = TestClient(main.app).get("/api/v0/farms/farm/simulations/sim/view")
        self.assertEqual(response.json()["status"], "queued")
        execute.assert_called_once()
        self.assertEqual(execute.call_args.args[0].job_type, "prepare_simulation_view")
        self.queue.send_message.assert_not_called()

    def test_manual_history_recalculation_reuses_active_job_and_preserves_simulations(self):
        first = self.history_inputs()
        read_model_worker.execute(first, CONTEXT)
        self.publish_result()
        before = read_model_store.get_simulation_view("farm", "sim", EMAIL)
        newer = rich_candidate().years
        for year in newer:
            year.db_kr_ha = 500
        self.years.return_value = newer
        self.queue.send_message.reset_mock()
        client = TestClient(main.app)
        path = "/api/v0/farms/farm/history/retry"
        response = client.post(path)
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["status"], "queued")
        self.assertEqual(response.json()["inputRevision"], first.expected_revision + 1)
        self.queue.send_message.assert_called_once()
        job = PreparationJob.model_validate_json(
            self.queue.send_message.call_args.kwargs["MessageBody"]
        )
        for status in ("queued", "running"):
            with self.sessions.begin() as session:
                session.execute(update(farm_views).values(status=status))
            again = client.post(path)
            self.assertEqual(again.json()["inputRevision"], job.expected_revision)
            self.queue.send_message.assert_called_once()
        with self.sessions.begin() as session:
            session.execute(update(farm_views).values(status="queued"))
        read_model_worker.execute(job, CONTEXT)
        after = read_model_store.get_farm_view("farm", EMAIL)
        self.assertEqual(after["status"], "done")
        self.assertEqual(after["data"]["field_years"]["history-0"][0]["db_kr_ha"], 500)
        self.assertEqual(read_model_store.get_simulation_view("farm", "sim", EMAIL), before)

    def test_migration_round_trip_preserves_source_and_does_not_calculate(self):
        path = (
            Path(__file__).parents[1] / "database/migrations/versions/20261012_0002_read_models.py"
        )
        spec = importlib.util.spec_from_file_location("read_model_migration", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with self.engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
                migration.upgrade()
            self.assertEqual(connection.execute(select(setups.c.id)).scalar_one(), "sim")
            self.assertIn("field_historical_detail", inspect(connection).get_table_names())
            self.assertIsNone(connection.execute(select(views.c.data)).scalar_one())
            self.assertEqual(connection.execute(select(farm_views.c.status)).scalar_one(), "queued")
