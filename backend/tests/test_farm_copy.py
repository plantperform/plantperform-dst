"""Farm copies use disposable PostgreSQL schemas, never application tables."""

import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, insert, select, text, update
from sqlalchemy.orm import sessionmaker

from app.api.v0 import farms
from app.auth import AuthenticatedUser, current_user
from app.data import farm_copy_store as store
from app.data import quota_value_store, read_model_store, repository
from app.data.db import (
    app_user_table,
    economics_module_member_table,
    economics_module_table,
    farm_member_table,
    farm_read_model_table,
    farm_table,
    field_historical_detail_table,
    field_table,
    metadata,
    simulation_quota_value_table,
    simulation_read_model_table,
    simulation_result_table,
    simulation_table,
    user_field_alias_table,
)
from app.data.db import (
    saedskifte_rotation_group_member_table as group_members,
)
from app.data.db import (
    saedskifte_rotation_group_table as groups,
)
from app.domain.economics import EconomicsSnapshot
from app.domain.farm import Farm
from app.domain.farm_copy import (
    COPY_SOURCE_EMAIL,
    CopyFarmRequest,
    FarmCopyLookup,
    FarmCopyNotFoundError,
)
from app.domain.field import FieldRecord
from app.domain.simulation import Simulation

CREATOR = "creator@example.com"
LOOKUP = {"cvr": "12345678", "name": "  grøN GÅRD  ", "ownerName": "  ANNA  "}
DATABASE = os.getenv("OPTIMIZER_TEST_DATABASE_URL")


def field(identity, **values):
    return FieldRecord(
        id=identity,
        farm_id="source",
        name="Mark 1",
        area_ha=2.5,
        imk_id=123,
        db2=100,
        n_load=20,
        leaching=40,
        **values,
    ).model_dump(mode="json")


def request(**values):
    return CopyFarmRequest.model_validate(
        {
            **LOOKUP,
            "sourceFarmId": "source",
            "requestId": str(uuid4()),
            **values,
        }
    )


def client(authenticated=True):
    app = FastAPI()
    app.include_router(farms.router, prefix="/api/v0")
    if authenticated:
        app.dependency_overrides[current_user] = lambda: AuthenticatedUser(email=CREATOR)
    return TestClient(app)


class FarmCopyApiTests(unittest.TestCase):
    def test_identity_remapping_preserves_names_and_registry_identity(self):
        data = {
            "id": "field",
            "name": "field",
            "imk_id": 123,
            "fields": {"field": {"field_id": "field"}},
        }

        copied = store._remap(data, {"field": "new-field"})

        self.assertEqual(
            copied,
            {
                "id": "new-field",
                "name": "field",
                "imk_id": 123,
                "fields": {"new-field": {"field_id": "new-field"}},
            },
        )

    def test_preview_requires_authentication(self):
        with client(False) as api:
            response = api.post("/api/v0/farms/copy/preview", json=LOOKUP)

        self.assertEqual(response.status_code, 401)

    def test_copy_requires_authentication(self):
        with client(False) as api:
            response = api.post("/api/v0/farms/copy", json=request().model_dump(mode="json"))

        self.assertEqual(response.status_code, 401)

    def test_other_cvr_is_rejected_before_lookup(self):
        with client() as api, patch.object(store, "preview") as preview:
            response = api.post("/api/v0/farms/copy/preview", json={**LOOKUP, "cvr": "87654321"})

        self.assertEqual(response.status_code, 422)
        preview.assert_not_called()

    def test_blank_name_is_rejected(self):
        with client() as api:
            response = api.post("/api/v0/farms/copy/preview", json={**LOOKUP, "name": "  "})

        self.assertEqual(response.status_code, 422)

    def test_no_match_returns_not_found(self):
        with client() as api, patch.object(store, "preview", side_effect=FarmCopyNotFoundError):
            response = api.post("/api/v0/farms/copy/preview", json=LOOKUP)

        self.assertEqual(response.status_code, 404)

    def test_copy_passes_authenticated_creator(self):
        copied = Farm(id="copy", name="Grøn gård", owner_name="Anna", cvr="87654321")
        with client() as api, patch.object(store, "copy_farm", return_value=copied) as copy:
            response = api.post("/api/v0/farms/copy", json=request().model_dump(mode="json"))

        self.assertEqual(response.status_code, 201)
        self.assertEqual(copy.call_args.args[1], CREATOR)

    def test_copy_rejects_normal_cvr(self):
        data = request().model_dump(mode="json")
        data["cvr"] = "87654321"
        with client() as api, patch.object(store, "copy_farm") as copy:
            response = api.post("/api/v0/farms/copy", json=data)

        self.assertEqual(response.status_code, 422)
        copy.assert_not_called()


@unittest.skipUnless(DATABASE, "Set OPTIMIZER_TEST_DATABASE_URL for PostgreSQL integration tests")
class FarmCopyDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.schema = "farm_copy_test_" + uuid4().hex
        self.admin = create_engine(DATABASE)
        with self.admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        self.engine = create_engine(
            DATABASE, connect_args={"options": f"-csearch_path={self.schema}"}
        )
        self.addCleanup(self.cleanup)
        self.sessions = sessionmaker(bind=self.engine)
        self.enterContext(patch.object(repository, "SessionLocal", self.sessions))
        self.enterContext(patch("app.services.scenario.options.catalog", return_value=[]))
        self.enterContext(patch("app.services.scenario.options.contributions", return_value={}))
        metadata.create_all(
            self.engine,
            tables=[
                app_user_table,
                farm_table,
                farm_member_table,
                field_table,
                field_historical_detail_table,
                farm_read_model_table,
                simulation_table,
                simulation_result_table,
                simulation_quota_value_table,
                simulation_read_model_table,
                groups,
                group_members,
                economics_module_table,
                economics_module_member_table,
                user_field_alias_table,
            ],
        )
        self.farm = Farm(id="source", name="Grøn gård", owner_name="Anna", cvr="87654321")
        self.snapshot = EconomicsSnapshot(
            source_id="economics",
            name="Min økonomi",
            revision=3,
            overrides={"prices": {"crop:1": 12.0}},
        ).model_dump(mode="json")
        self.simulation = Simulation(
            id="scenario",
            farm_id="source",
            name="Plan",
            created_at="2026-11-01",
            economics_module_id="economics",
            economics_snapshot=self.snapshot,
        ).model_dump(mode="json")
        self.output = {
            "run_id": "saved-run",
            "result_revision": 2,
            "response": {
                "status": "OPTIMAL",
                "objective_db2": 100,
                "total_n_load_kg": 20,
                "total_leaching_kg": 40,
                "total_fen": 0,
                "fields": [field("scenario-field")],
                "assignments": [{"field_id": "scenario-field", "rotation_id": "1:1:100"}],
            },
            "fields_before": [field("removed-field")],
            "selected_candidates": {},
            "economics_snapshot": self.snapshot,
        }
        with self.sessions.begin() as session:
            session.execute(
                insert(app_user_table),
                [
                    {"email": email, "password_hash": "test"}
                    for email in (CREATOR, COPY_SOURCE_EMAIL, "other@example.com")
                ],
            )
            session.execute(
                insert(farm_table).values(
                    id="source",
                    data=self.farm.model_dump(mode="json"),
                    revision=2,
                )
            )
            session.execute(
                insert(farm_member_table),
                [
                    {"farm_id": "source", "email": email}
                    for email in (COPY_SOURCE_EMAIL, "other@example.com")
                ],
            )
            session.execute(
                insert(field_table).values(id="field", farm_id="source", data=field("field"))
            )
            session.execute(
                insert(field_historical_detail_table).values(
                    field_id="field",
                    input_revision=2,
                    years=[],
                )
            )
            session.execute(
                insert(farm_read_model_table).values(
                    farm_id="source",
                    input_revision=2,
                    status="done",
                    view_version=4,
                    data={
                        "fields": [field("field")],
                        "field_years": {"field": []},
                        "yearly_summary": [],
                    },
                )
            )
            session.execute(
                insert(economics_module_table).values(
                    id="economics",
                    name="Min økonomi",
                    revision=4,
                    overrides={"prices": {"crop:1": 20.0}},
                )
            )
            session.execute(
                insert(economics_module_member_table).values(
                    module_id="economics",
                    email=COPY_SOURCE_EMAIL,
                )
            )
            session.execute(
                insert(simulation_table).values(
                    id="scenario",
                    farm_id="source",
                    data=self.simulation,
                    revision=2,
                    fields={"scenario-field": repository.split_field(field("scenario-field"))},
                    field_order=["scenario-field"],
                )
            )
            session.execute(
                insert(simulation_result_table).values(
                    simulation_id="scenario",
                    status="completed",
                    run_id="saved-run",
                    input_revision=2,
                    result_revision=2,
                    output=self.output,
                    parameters={"run_id": "saved-run", "expected_revision": 2},
                )
            )
            session.execute(
                insert(simulation_read_model_table).values(
                    simulation_id="scenario",
                    input_revision=2,
                    status="done",
                    view_version=5,
                    data={
                        "fields": [field("scenario-field")],
                        "field_years": {"scenario-field": []},
                        "yearly_summary": [],
                        "crop_area_ranges": [],
                        "saved_result": {**self.output, "field_years": {"scenario-field": []}},
                    },
                    prepared={"version": 3, "contributions": {"scenario-field": []}},
                )
            )

    def cleanup(self):
        self.engine.dispose()
        with self.admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{self.schema}" CASCADE'))
        self.admin.dispose()

    def rows(self, table):
        with self.sessions() as session:
            return [dict(row) for row in session.execute(select(table)).mappings()]

    def copy(self, **values):
        return store.copy_farm(request(**values), CREATOR)

    def copied_row(self, table, key, source_id):
        return next(row for row in self.rows(table) if row[key] != source_id)

    def share_as_viewer(self):
        with self.sessions.begin() as session:
            session.execute(
                insert(farm_member_table).values(farm_id="source", email=CREATOR, role="viewer")
            )

    def test_private_duplicate_requires_direct_membership(self):
        with client() as api:
            response = api.post("/api/v0/farms/source/duplicate", json={"requestId": str(uuid4())})

        self.assertEqual(response.status_code, 404)

    def test_viewer_receives_private_editable_farm(self):
        self.share_as_viewer()

        with client() as api:
            response = api.post("/api/v0/farms/source/duplicate", json={"requestId": str(uuid4())})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["name"], "Kopi af Grøn gård")
        with client() as api:
            roster = api.get("/api/v0/farms/" + response.json()["id"] + "/memberships")
        self.assertEqual(roster.json(), [{"email": CREATOR, "role": "editor", "creator": True}])

    def test_private_duplicate_keeps_original_profile(self):
        self.share_as_viewer()

        store.duplicate_farm("source", uuid4(), CREATOR)

        setup = self.copied_row(simulation_table, "id", "scenario")["data"]
        self.assertEqual(setup["economics_module_id"], "economics")
        self.assertEqual(
            [row["email"] for row in self.rows(economics_module_member_table)], [COPY_SOURCE_EMAIL]
        )

    def test_private_duplicate_excludes_unpublished_worker_economics(self):
        self.share_as_viewer()
        hidden = {**self.snapshot, "revision": 9, "overrides": {"prices": {"crop:1": 999}}}
        with self.sessions.begin() as session:
            session.execute(
                update(simulation_result_table).values(
                    parameters={
                        "simulation_settings": {"economics_snapshot": hidden},
                    }
                )
            )

        store.duplicate_farm("source", uuid4(), CREATOR)

        result = self.copied_row(simulation_result_table, "simulation_id", "scenario")
        self.assertEqual(
            result["parameters"]["simulation_settings"]["economics_snapshot"], self.snapshot
        )

    def test_private_duplicate_does_not_clone_shared_module(self):
        self.share_as_viewer()
        with self.sessions.begin() as session:
            session.execute(
                insert(economics_module_member_table).values(
                    module_id="economics", email=CREATOR, role="viewer"
                )
            )

        store.duplicate_farm("source", uuid4(), CREATOR)

        self.assertEqual([row["id"] for row in self.rows(economics_module_table)], ["economics"])

    def test_duplicate_preserves_unapplied_selection(self):
        self.share_as_viewer()
        with self.sessions.begin() as session:
            session.execute(
                insert(economics_module_table).values(id="private", name="Hidden", overrides={})
            )
            session.execute(
                update(simulation_table).values(
                    data={**self.simulation, "economics_module_id": "private"}
                )
            )

        store.duplicate_farm("source", uuid4(), CREATOR)

        setup = self.copied_row(simulation_table, "id", "scenario")["data"]
        self.assertEqual(setup["economics_module_id"], "private")
        self.assertEqual(setup["economics_snapshot"], self.snapshot)

    def test_private_duplicate_remaps_completed_quota_curve(self):
        self.share_as_viewer()
        rotation = {
            "field_id": "scenario-field",
            "base_ref": {"saedskiftevariant": "1", "variant": "1", "n_norm_pct": "100"},
        }
        output = {
            "base_db2": 10,
            "base_feed_units_by_year": {},
            "curve": {
                "kystvand_id": 1,
                "kvote_kg": 100,
                "unconstrained_trade_kg": 0,
                "points": [{"trade_kg": 0, "status": "OPTIMAL", "rotations": [rotation]}],
            },
        }
        with self.sessions.begin() as session:
            session.execute(
                insert(simulation_quota_value_table).values(
                    simulation_id="scenario",
                    kystvand_id=1,
                    status="completed",
                    input_revision=2,
                    run_id="curve",
                    base_run_id="saved-run",
                    requested_by=COPY_SOURCE_EMAIL,
                    output=output,
                )
            )
            session.execute(
                insert(simulation_quota_value_table).values(
                    simulation_id="scenario", kystvand_id=2, status="in_progress"
                )
            )

        farm = store.duplicate_farm("source", uuid4(), CREATOR)
        setup = self.copied_row(simulation_table, "id", "scenario")
        with patch.object(quota_value_store, "SessionLocal", self.sessions):
            curves = quota_value_store.get_quota_values(farm.id, setup["id"], CREATOR)

        self.assertEqual(len(curves), 1)
        self.assertFalse(curves[0].outdated)
        self.assertEqual(
            curves[0].output.curve.points[0].rotations[0].field_id, setup["field_order"][0]
        )

    def test_concurrent_private_duplicate_returns_one_destination(self):
        self.share_as_viewer()
        request_id = uuid4()

        with ThreadPoolExecutor(max_workers=2) as pool:
            copies = list(
                pool.map(lambda _: store.duplicate_farm("source", request_id, CREATOR), range(2))
            )

        self.assertEqual(copies[0].id, copies[1].id)
        self.assertEqual(len(self.rows(farm_table)), 2)

    def test_preview_matches_case_and_spaces(self):
        preview = store.preview(FarmCopyLookup.model_validate(LOOKUP))

        self.assertEqual(preview.source_farm, self.farm)

    def test_preview_summarizes_saved_data(self):
        preview = store.preview(FarmCopyLookup.model_validate(LOOKUP))

        self.assertEqual(
            (
                preview.field_count,
                preview.area_ha,
                preview.simulation_count,
                preview.saved_result_count,
            ),
            (1, 2.5, 1, 1),
        )

    def test_preview_does_not_create_anything(self):
        store.preview(FarmCopyLookup.model_validate(LOOKUP))

        self.assertEqual(len(self.rows(farm_table)), 1)

    def test_inaccessible_farm_cannot_match(self):
        with self.sessions.begin() as session:
            session.execute(
                delete(farm_member_table).where(farm_member_table.c.email == COPY_SOURCE_EMAIL)
            )
        with client() as api:
            response = api.post("/api/v0/farms/copy/preview", json=LOOKUP)

        self.assertEqual(response.status_code, 404)

    def test_multiple_matches_are_rejected(self):
        with self.sessions.begin() as session:
            session.execute(
                insert(farm_table).values(
                    id="another", data={**self.farm.model_dump(), "id": "another"}
                )
            )
            session.execute(
                insert(farm_member_table).values(farm_id="another", email=COPY_SOURCE_EMAIL)
            )
        with client() as api:
            response = api.post("/api/v0/farms/copy/preview", json=LOOKUP)

        self.assertEqual(response.status_code, 409)

    def test_wrong_source_id_is_rejected(self):
        with client() as api:
            response = api.post(
                "/api/v0/farms/copy", json=request(sourceFarmId="another").model_dump(mode="json")
            )

        self.assertEqual(response.status_code, 404)

    def test_copy_revalidates_membership_after_preview(self):
        store.preview(FarmCopyLookup.model_validate(LOOKUP))
        with self.sessions.begin() as session:
            session.execute(
                delete(farm_member_table).where(farm_member_table.c.email == COPY_SOURCE_EMAIL)
            )
        with client() as api:
            response = api.post("/api/v0/farms/copy", json=request().model_dump(mode="json"))

        self.assertEqual(response.status_code, 404)

    def test_copy_uses_source_details(self):
        copied = self.copy()

        self.assertEqual(copied.model_dump(exclude={"id"}), self.farm.model_dump(exclude={"id"}))

    def test_only_creator_can_access_copy(self):
        copied = self.copy()

        self.assertEqual(repository.list_farm_members(copied.id, CREATOR), [CREATOR])
        self.assertIsNone(repository.get_farm(copied.id, COPY_SOURCE_EMAIL))

    def test_field_and_historical_detail_share_new_id(self):
        copied = self.copy()
        copied_field = self.copied_row(field_table, "farm_id", "source")
        detail = self.copied_row(field_historical_detail_table, "field_id", "field")

        self.assertEqual(
            (copied_field["id"], copied_field["data"]["id"], copied_field["data"]["farm_id"]),
            (detail["field_id"], detail["field_id"], copied.id),
        )

    def test_saved_result_references_are_remapped(self):
        copied = self.copy()
        scenario = self.copied_row(simulation_table, "farm_id", "source")
        result = self.copied_row(simulation_result_table, "simulation_id", "scenario")
        output = result["output"]
        copied_id = scenario["field_order"][0]

        self.assertEqual(
            (
                output["response"]["fields"][0]["id"],
                output["response"]["assignments"][0]["field_id"],
                output["response"]["fields"][0]["farm_id"],
            ),
            (copied_id, copied_id, copied.id),
        )

    def test_detached_historical_field_gets_new_id(self):
        copied = self.copy()
        result = self.copied_row(simulation_result_table, "simulation_id", "scenario")
        old_field = result["output"]["fields_before"][0]

        self.assertNotEqual(old_field["id"], "removed-field")
        self.assertEqual(old_field["farm_id"], copied.id)

    def test_saved_run_identity_is_consistent(self):
        self.copy()
        result = self.copied_row(simulation_result_table, "simulation_id", "scenario")
        view = self.copied_row(simulation_read_model_table, "simulation_id", "scenario")

        self.assertNotEqual(result["run_id"], "saved-run")
        self.assertEqual(result["run_id"], view["data"]["saved_result"]["run_id"])

    def install_rotation(self, *, selected=True):
        group_id, variant_id = str(uuid4()), str(uuid4())
        variant = {"id": variant_id, "positions": [{"afgrode_kode": 1}]}
        definition = {"id": group_id, "name": "Historisk", "variants": [variant], "revision": 2}
        candidate = f"{group_id}:{variant_id}~0+manuel-1:100"
        with self.sessions.begin() as session:
            session.execute(insert(groups).values({**definition, "name": "Aktuel", "revision": 3}))
            session.execute(
                insert(group_members).values(group_id=group_id, email=COPY_SOURCE_EMAIL)
            )
            session.execute(
                update(simulation_table).values(
                    data={
                        **self.simulation,
                        "rotation_saedskiftevarianter": [group_id, "1"] if selected else ["1"],
                    }
                )
            )
            session.execute(
                update(field_table).values(
                    data={
                        **field("field"),
                        "rotation_id": candidate,
                        "allowed_rotation_ids": [candidate],
                    }
                )
            )
            output = {**self.output, "rotation_groups": {group_id: definition}}
            session.execute(update(simulation_result_table).values(output=output))
        return group_id, variant_id

    def test_course_copy_relinks_selection_and_preserves_standard(self):
        source, _ = self.install_rotation()

        self.copy()

        group = self.copied_row(groups, "id", source)
        setup = self.copied_row(simulation_table, "id", "scenario")["data"]
        self.assertEqual(setup["rotation_saedskiftevarianter"], [group["id"], "1"])
        self.assertEqual(group["name"], "Aktuel")
        member = self.copied_row(group_members, "group_id", source)
        self.assertEqual(
            (member["group_id"], member["email"], member["role"]), (group["id"], CREATOR, "editor")
        )

    def test_course_copy_relinks_locked_rotation_variant(self):
        source, old_variant = self.install_rotation()

        self.copy()

        group = self.copied_row(groups, "id", source)
        variant = group["variants"][0]["id"]
        copied = self.copied_row(field_table, "id", "field")["data"]
        expected = f"{group['id']}:{variant}~0+manuel-1:100"
        self.assertNotEqual(variant, old_variant)
        self.assertEqual(
            (copied["rotation_id"], copied["allowed_rotation_ids"]), (expected, [expected])
        )

    def test_course_copy_preserves_captured_rotation_revision(self):
        source, _ = self.install_rotation()

        self.copy()

        group = self.copied_row(groups, "id", source)
        result = self.copied_row(simulation_result_table, "simulation_id", "scenario")
        snapshot = result["output"]["rotation_groups"][group["id"]]
        self.assertEqual(
            (snapshot["id"], snapshot["revision"], snapshot["name"]), (group["id"], 2, "Historisk")
        )
        self.assertEqual(snapshot["variants"], group["variants"])

    def test_course_copy_reuses_definitions_across_simulations(self):
        source, _ = self.install_rotation()
        data = {**self.simulation, "id": "second", "rotation_saedskiftevarianter": [source]}
        with self.sessions.begin() as session:
            session.execute(
                insert(simulation_table).values(id="second", farm_id="source", data=data)
            )

        destination = self.copy()

        module = self.copied_row(economics_module_table, "id", "economics")
        group = self.copied_row(groups, "id", source)
        selections = [
            (row["data"]["economics_module_id"], row["data"]["rotation_saedskiftevarianter"][0])
            for row in self.rows(simulation_table)
            if row["farm_id"] == destination.id
        ]
        self.assertEqual(selections, [(module["id"], group["id"])] * 2)

    def test_course_copy_builds_historical_only_rotation_from_capture(self):
        source, _ = self.install_rotation(selected=False)

        self.copy()

        self.assertEqual(self.copied_row(groups, "id", source)["name"], "Historisk")

    def test_course_copy_builds_historical_only_economics_from_capture(self):
        with self.sessions.begin() as session:
            session.execute(
                update(simulation_table).values(
                    data={**self.simulation, "economics_module_id": "standard"}
                )
            )

        self.copy()

        self.assertEqual(
            self.copied_row(economics_module_table, "id", "economics")["revision"],
            self.snapshot["revision"],
        )

    def test_private_duplicate_keeps_rotation_identity_and_members(self):
        group, _ = self.install_rotation()
        self.share_as_viewer()

        store.duplicate_farm("source", uuid4(), CREATOR)

        setup = self.copied_row(simulation_table, "id", "scenario")["data"]
        self.assertEqual(setup["rotation_saedskiftevarianter"], [group, "1"])
        self.assertEqual([row["email"] for row in self.rows(group_members)], [COPY_SOURCE_EMAIL])

    def test_economics_keeps_current_profile_and_frozen_snapshot(self):
        self.copy()
        module = self.copied_row(economics_module_table, "id", "economics")
        scenario = self.copied_row(simulation_table, "farm_id", "source")

        self.assertEqual(scenario["data"]["economics_module_id"], module["id"])
        self.assertEqual(module["overrides"]["prices"]["crop:1"], 20)
        self.assertEqual(
            scenario["data"]["economics_snapshot"]["overrides"]["prices"]["crop:1"], 12
        )

    def test_missing_economics_profile_is_reconstructed(self):
        with self.sessions.begin() as session:
            session.execute(delete(economics_module_table))

        self.copy()

        self.assertEqual(self.rows(economics_module_table)[0]["overrides"]["prices"]["crop:1"], 12)

    def test_private_profile_has_only_creator_membership(self):
        self.copy()
        membership = self.copied_row(economics_module_member_table, "module_id", "economics")

        self.assertEqual(membership["email"], CREATOR)

    def test_failure_rolls_back_definitions_and_farm(self):
        self.install_rotation()
        with self.sessions.begin() as session:
            session.execute(delete(simulation_read_model_table))

        with patch.object(
            read_model_store, "refresh_simulation_view", side_effect=RuntimeError("failed")
        ):
            with self.assertRaises(RuntimeError):
                self.copy()

        self.assertEqual(
            (
                len(self.rows(farm_table)),
                len(self.rows(economics_module_table)),
                len(self.rows(groups)),
            ),
            (1, 1, 1),
        )

    def test_retry_returns_same_copy(self):
        self.install_rotation()
        copy_request = request()
        first = store.copy_farm(copy_request, CREATOR)

        second = store.copy_farm(copy_request, CREATOR)

        self.assertEqual(first.id, second.id)
        self.assertEqual(len(self.rows(economics_module_table)), 2)
        self.assertEqual(len(self.rows(groups)), 2)

    def test_concurrent_retries_create_one_copy(self):
        copy_request = request()
        with ThreadPoolExecutor(max_workers=2) as pool:
            copies = list(pool.map(lambda _: store.copy_farm(copy_request, CREATOR), range(2)))

        self.assertEqual(copies[0].id, copies[1].id)
        self.assertEqual(len(self.rows(farm_table)), 2)

    def test_active_run_keeps_previous_result_as_outdated(self):
        with self.sessions.begin() as session:
            session.execute(
                update(simulation_result_table).values(
                    status="in_progress",
                    run_id="active-run",
                    lease_token="source-lease",
                    attempts=1,
                )
            )

        self.copy()
        result = self.copied_row(simulation_result_table, "simulation_id", "scenario")

        self.assertEqual(
            (result["status"], result["lease_token"], result["attempts"]), ("outdated", None, 0)
        )
        self.assertEqual(result["run_id"], result["output"]["run_id"])

    def test_active_run_without_output_is_not_started(self):
        with self.sessions.begin() as session:
            session.execute(update(simulation_result_table).values(status="queued", output=None))
            session.execute(delete(simulation_read_model_table))

        self.copy()
        result = self.copied_row(simulation_result_table, "simulation_id", "scenario")

        self.assertEqual((result["status"], result["run_id"]), ("not_started", None))

    def test_active_run_preserves_result_available_only_in_view(self):
        with self.sessions.begin() as session:
            session.execute(
                update(simulation_result_table).values(status="in_progress", output=None)
            )

        self.copy()
        result = self.copied_row(simulation_result_table, "simulation_id", "scenario")

        self.assertEqual(result["status"], "outdated")
        self.assertEqual(result["output"]["response"]["objective_db2"], 100)

    def test_copy_rebuilds_missing_scenario_display_from_saved_values(self):
        with self.sessions.begin() as session:
            session.execute(delete(simulation_read_model_table))

        self.copy()
        view = self.rows(simulation_read_model_table)[0]

        self.assertEqual(view["status"], "done")
        self.assertEqual(view["data"]["saved_result"]["response"]["objective_db2"], 100)

    def test_copied_scenario_is_readable_through_existing_api(self):
        from app.domain.read_model import SimulationView

        copied = self.copy()
        scenario = self.copied_row(simulation_table, "farm_id", "source")

        view = SimulationView.model_validate(
            read_model_store.get_simulation_view(copied.id, scenario["id"], CREATOR)
        )

        self.assertEqual(view.data.saved_result.response.objective_db2, 100)

    def test_copied_scenario_can_be_edited(self):
        from app.data import simulation_settings_store
        from app.domain.simulation import UpdateSimulationRequest

        copied = self.copy()
        scenario = self.copied_row(simulation_table, "farm_id", "source")

        edited = simulation_settings_store.update_settings(
            copied.id,
            scenario["id"],
            UpdateSimulationRequest(expected_revision=2, name="Ny plan"),
            CREATOR,
        )

        self.assertEqual(edited.name, "Ny plan")

    def test_pending_preview_reports_unfinished_calculation(self):
        with self.sessions.begin() as session:
            session.execute(update(simulation_result_table).values(status="queued"))

        preview = store.preview(FarmCopyLookup.model_validate(LOOKUP))

        self.assertTrue(preview.has_unfinished_calculations)

    def test_failed_scenario_becomes_editable(self):
        with self.sessions.begin() as session:
            session.execute(update(simulation_table).values(creation_status="failed"))

        self.copy()
        scenario = self.copied_row(simulation_table, "farm_id", "source")

        self.assertEqual(scenario["creation_status"], "done")

    def test_selected_candidates_keep_new_field_keys(self):
        output = {**self.output, "selected_candidates": {"scenario-field": {"ref": "unchanged"}}}
        with self.sessions.begin() as session:
            session.execute(update(simulation_result_table).values(output=output))

        self.copy()
        scenario = self.copied_row(simulation_table, "farm_id", "source")
        result = self.copied_row(simulation_result_table, "simulation_id", "scenario")

        self.assertEqual(list(result["output"]["selected_candidates"]), scenario["field_order"])

    def test_pending_economics_does_not_leave_copy_running(self):
        with self.sessions.begin() as session:
            session.execute(
                update(simulation_table).values(
                    creation_status="running",
                    data={**self.simulation, "economics_recalculation": {"request_id": "pending"}},
                )
            )

        self.copy()
        scenario = self.copied_row(simulation_table, "farm_id", "source")

        self.assertEqual(scenario["creation_status"], "done")
        self.assertNotIn("economics_recalculation", scenario["data"])

    def test_unfinished_history_is_retryable(self):
        with self.sessions.begin() as session:
            session.execute(update(farm_read_model_table).values(status="running"))

        self.copy()
        view = self.copied_row(farm_read_model_table, "farm_id", "source")

        self.assertEqual(view["status"], "failed")
        self.assertEqual(view["error"]["code"], "COPIED_HISTORY_INCOMPLETE")

    def test_copy_does_not_change_source(self):
        tables = (
            farm_table,
            field_table,
            field_historical_detail_table,
            simulation_table,
            simulation_result_table,
            farm_read_model_table,
            simulation_read_model_table,
        )
        before = {table.name: deepcopy(self.rows(table)) for table in tables}

        self.copy()

        for table in tables:
            self.assertIn(before[table.name][0], self.rows(table), table.name)

    def test_copy_records_the_copier_as_creator(self):
        self.copy()

        self.assertEqual(self.copied_row(farm_table, "id", "source")["created_by"], CREATOR)

    def test_editing_and_deleting_copy_preserves_source(self):
        copied = self.copy()
        with self.sessions.begin() as session:
            session.execute(
                update(field_table)
                .where(field_table.c.farm_id == copied.id)
                .values(data=field("changed"))
            )

        repository.delete_farm(copied.id, CREATOR)

        self.assertEqual(self.rows(field_table)[0]["data"], field("field"))
        self.assertEqual(len(self.rows(simulation_table)), 1)

    def test_aliases_remain_unchanged(self):
        with self.sessions.begin() as session:
            session.execute(
                insert(user_field_alias_table),
                [
                    {"email": email, "field_key": "imk:123", "alias": alias}
                    for email, alias in ((CREATOR, "Mit navn"), (COPY_SOURCE_EMAIL, "Andet navn"))
                ],
            )
        before = self.rows(user_field_alias_table)

        self.copy()

        self.assertEqual(self.rows(user_field_alias_table), before)

    def test_empty_farm_with_no_cvr_is_ready(self):
        with self.sessions.begin() as session:
            session.execute(delete(field_table))
            session.execute(delete(simulation_table))
            session.execute(update(farm_table).values(data={**self.farm.model_dump(), "cvr": None}))

        copied = self.copy()
        view = read_model_store.get_farm_view(copied.id, CREATOR)

        self.assertIsNone(copied.cvr)
        self.assertEqual(view["status"], "done")


if __name__ == "__main__":
    unittest.main()
