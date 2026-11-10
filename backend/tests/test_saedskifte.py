"""Shared rotations, authorized copies and deterministic calculation inputs."""

import importlib.util
import os
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
from database.scripts.load_saedskifte_lookup import load_saedskifte_lookup
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, delete, insert, select, text, update
from sqlalchemy.orm import sessionmaker
from test_runtime_lookups import source_row, write_lookup

from app import main
from app.api.v0 import rotation_candidates, simulations
from app.api.v0 import saedskifte as api
from app.auth import AuthenticatedUser, current_user
from app.data import (
    optimization_store,
    read_model_store,
    repository,
    rotation_snapshot_store,
    simulation_store,
)
from app.data import saedskifte_store as store
from app.data import simulation_settings_store as settings
from app.data.db import (
    app_user_table,
    farm_member_table,
    farm_table,
    field_table,
    metadata,
    saedskifte_category_table,
    saedskifte_rotation_table,
    simulation_read_model_table,
)
from app.data.db import (
    saedskifte_rotation_group_member_table as members,
)
from app.data.db import (
    saedskifte_rotation_group_table as groups,
)
from app.data.db import (
    simulation_result_table as results,
)
from app.data.db import (
    simulation_table as setups,
)
from app.domain.field import FieldRecord
from app.domain.optimization import OptimizeSimulationRequest
from app.domain.rotation_candidate import RotationCandidateRef, RotationPositionOverride
from app.domain.saedskifte import (
    CreateRotationGroupRequest,
    RotationDefinitionError,
    RotationGroupConflictError,
    RotationGroupNotFoundError,
    RotationGroupSnapshot,
    RotationPosition,
    RotationVariant,
    UpdateRotationGroupRequest,
)
from app.domain.simulation import (
    CreateSimulationRequest,
    GodningSettings,
    Simulation,
    UpdateSimulationRequest,
)
from app.services.optimization import jobs
from app.services.rotations import afgroede_normer, custom, saedskifte_library
from app.services.scenario import candidate_evaluator
from plantperform_fargate import worker

DATABASE = os.getenv("OPTIMIZER_TEST_DATABASE_URL")
EMAIL = "member@example.com"
OTHER = "other@example.com"
THIRD = "third@example.com"


def variant(codes=(11, 11), measures=(9683,)):
    return RotationVariant(
        positions=[
            RotationPosition(afgrode_kode=code, allowed_udlaeg_koder=list(measures))
            for code in codes
        ]
    )


def definition(**kwargs):
    return CreateRotationGroupRequest(**{"name": "My rotation", "variants": [variant()], **kwargs})


def snapshot(**kwargs):
    return RotationGroupSnapshot(id=str(uuid4()), **definition(**kwargs).model_dump())


def reference_data(test):
    names = {1: "Vårbyg", 11: "Vinterhvede", 5: "Majs", 921: "Bar jord", 968: "Efterafgrøde"}
    params = {
        1: {"er_hovedafgrode": True, "tidlig_saaning_mulig": True},
        11: {
            "er_hovedafgrode": True,
            "tidlig_saaning_mulig": True,
            "mellemafgroede_mulig": True,
            "grund6procent": True,
        },
        5: {"er_hovedafgrode": True},
    }
    test.enterContext(patch.object(afgroede_normer, "crop_names_from_normer", return_value=names))
    test.enterContext(
        patch.object(
            afgroede_normer,
            "lookup_crop_params",
            side_effect=lambda code: {"navn": names.get(code, ""), **params.get(code, {})},
        )
    )


def calculation_data(test):
    test.enterContext(
        patch.object(
            afgroede_normer,
            "lookup_norm",
            return_value={
                "n_norm": 175,
                "forfrugtsvaerdi": 0,
                "indregn_ffv": True,
            },
        )
    )
    test.enterContext(patch.object(afgroede_normer, "lookup_nfix", return_value=0))
    test.enterContext(
        patch.object(
            candidate_evaluator.bridge_v2, "evaluate_leaching_position", return_value={"L_nuar": 10}
        )
    )
    test.enterContext(
        patch.object(
            candidate_evaluator,
            "calculate_db",
            side_effect=lambda code, form, jb, **values: {
                "db": 100 + (40 if values.get("udlaeg_kode") else 0),
                "udbytteenhed": "hkg",
                "udbytte": 100,
            },
        )
    )
    candidate_evaluator.compute_n_inputs.cache_clear()
    test.addCleanup(candidate_evaluator.compute_n_inputs.cache_clear)


class RotationDefinitionTests(unittest.TestCase):
    def setUp(self):
        reference_data(self)

    def test_blank_name_is_rejected(self):
        with self.assertRaises(ValidationError):
            definition(name="  ")

    def test_explicit_null_patch_is_rejected(self):
        with self.assertRaises(ValidationError):
            UpdateRotationGroupRequest(expected_revision=0, variants=None)

    def test_rotation_is_limited_to_eight_positions(self):
        with self.assertRaises(ValidationError):
            variant(codes=(11,) * 9)

    def test_unknown_crop_is_rejected(self):
        request = definition(variants=[variant(codes=(999,), measures=())])

        with self.assertRaises(RotationDefinitionError):
            custom.validate_definition(request.variants)

    def test_ineligible_measure_is_rejected(self):
        request = definition(variants=[variant(codes=(5, 11))])

        with self.assertRaises(RotationDefinitionError):
            custom.validate_definition(request.variants)

    def test_duplicate_measure_is_rejected(self):
        with self.assertRaises(ValidationError):
            variant(measures=(9683, 9683))

    def test_none_is_available_in_every_position(self):
        value = snapshot()

        with custom.rotation_scope({value.id: value}):
            prepared = candidate_evaluator.prepare_candidates([value.id], ["100"])

        self.assertEqual(len(prepared), 4)
        self.assertEqual(prepared[0].rotation, ((11, None, None),) * 8)

    def test_empty_choices_only_generate_none(self):
        value = snapshot(variants=[variant(measures=())])

        with custom.rotation_scope({value.id: value}):
            prepared = candidate_evaluator.prepare_candidates([value.id], ["100"])

        self.assertEqual(len(prepared), 1)

    def test_short_cycle_repeats_at_requested_start_year(self):
        value = snapshot(variants=[variant(codes=(1, 11, 5), measures=())])

        with custom.rotation_scope({value.id: value}):
            identity = saedskifte_library.list_variants(value.id)[0]
            rotation = saedskifte_library.generate_rotation(value.id, identity, 2)

        self.assertEqual([crop for crop, _, _ in rotation], [11, 5, 1, 11, 5, 1, 11, 5])

    def test_disabling_early_sowing_deduplicates_candidates(self):
        value = snapshot()

        with custom.rotation_scope({value.id: value}):
            prepared = candidate_evaluator.prepare_candidates([value.id], ["100"], False)

        self.assertEqual(len(prepared), 1)

    def test_effective_driftsform_filters_organic_choices(self):
        value = snapshot(variants=[variant(codes=(11,), measures=(921,))])

        with custom.rotation_scope({value.id: value}, "Konventionel"):
            prepared = candidate_evaluator.prepare_candidates([value.id], ["100"])

        self.assertEqual(len(prepared), 1)

    def test_candidate_limit_includes_n_norm_levels(self):
        value = snapshot(variants=[variant(codes=(11,) * 6, measures=(968, 9682, 9683))])

        with custom.rotation_scope({value.id: value}):
            custom.check_expansion([value.id], ["100"])
            with self.assertRaises(RotationDefinitionError):
                candidate_evaluator.prepare_candidates([value.id], ["100", "80"])

    def test_disabled_measures_are_removed_before_counting_expansion(self):
        value = snapshot(variants=[variant(codes=(11,) * 8, measures=(9682, 9683))])

        with custom.rotation_scope({value.id: value}):
            prepared = candidate_evaluator.prepare_candidates([value.id], ["100"], False, False)

        self.assertEqual(len(prepared), 1)

    def test_scope_does_not_leak_to_later_requests(self):
        value = snapshot()
        with custom.rotation_scope({value.id: value}):
            identity = saedskifte_library.list_variants(value.id)[0]

        with self.assertRaises(RotationDefinitionError):
            saedskifte_library.get_raw_rotation(value.id, identity)

    def test_nested_scope_restores_outer_definition(self):
        outer, inner = snapshot(), snapshot()

        with custom.rotation_scope({outer.id: outer}):
            with custom.rotation_scope({inner.id: inner}):
                self.assertEqual(set(custom.current_groups()), {inner.id})
            restored = set(custom.current_groups())

        self.assertEqual(restored, {outer.id})

    def test_copy_of_ref_round_trips_without_numeric_ids(self):
        value = snapshot()
        with custom.rotation_scope({value.id: value}):
            ref = candidate_evaluator.prepare_candidates([value.id], ["100"])[-1].ref

        self.assertEqual(RotationCandidateRef.from_id(ref.to_id()), ref)

    def test_manual_override_cannot_add_an_unconfigured_measure(self):
        value = snapshot()
        override = RotationPositionOverride(
            position=0, afgrode_kode=11, udlaeg_set=True, udlaeg_kode=9682
        )
        with custom.rotation_scope({value.id: value}):
            ref = candidate_evaluator.prepare_candidates([value.id], ["100"])[0].ref

            with self.assertRaises(RotationDefinitionError):
                custom.validate_overrides(ref, [override], 1, "Konventionel")

    def test_removed_variant_cannot_be_reconstructed(self):
        value = snapshot()
        with custom.rotation_scope({value.id: value}):
            identity = saedskifte_library.list_variants(value.id)[0]
        changed = value.model_copy(update={"variants": [variant()]})

        with custom.rotation_scope({value.id: changed}):
            with self.assertRaises(RotationDefinitionError) as raised:
                saedskifte_library.generate_rotation(value.id, identity)

        self.assertEqual(raised.exception.code, "ROTATION_VARIANT_UNAVAILABLE")

    def test_short_cycle_keeps_eligible_measure_in_last_horizon_year(self):
        calculation_data(self)
        value = snapshot(variants=[variant(codes=(1, 11, 11))])

        with custom.rotation_scope({value.id: value}):
            identity = saedskifte_library.list_variants(value.id)[-1]
            ref = RotationCandidateRef(
                saedskiftevariant=value.id, variant=identity, n_norm_pct="100"
            )
            evaluated = candidate_evaluator.evaluate_candidate_for_mark(
                ref, 4, "Konventionel", 0, 100, False
            )

        self.assertEqual(evaluated.years[-1].year.udlaeg_kode, 9683)


@unittest.skipUnless(DATABASE, "Set OPTIMIZER_TEST_DATABASE_URL for PostgreSQL tests")
class RotationDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.schema = "rotation_test_" + uuid4().hex
        self.admin = create_engine(DATABASE)
        with self.admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        self.engine = create_engine(
            DATABASE, connect_args={"options": f"-csearch_path={self.schema}"}
        )
        self.sessions = sessionmaker(bind=self.engine)
        self.addCleanup(self.cleanup_database)
        metadata.create_all(
            self.engine,
            tables=[
                app_user_table,
                farm_table,
                farm_member_table,
                groups,
                members,
                setups,
                results,
                simulation_read_model_table,
                field_table,
                saedskifte_rotation_table,
                saedskifte_category_table,
            ],
        )
        self.enterContext(patch.object(repository, "SessionLocal", self.sessions))
        self.enterContext(patch.object(rotation_snapshot_store, "SessionLocal", self.sessions))
        self.enterContext(patch.object(saedskifte_library, "SessionLocal", self.sessions))
        saedskifte_library.clear_lookup_cache()
        self.addCleanup(saedskifte_library.clear_lookup_cache)
        reference_data(self)
        with self.sessions.begin() as session:
            for email in (EMAIL, OTHER, THIRD):
                session.execute(
                    insert(app_user_table).values(
                        email=email, password_hash="test", verified_at=datetime.now(UTC)
                    )
                )
            session.execute(
                insert(farm_table).values(
                    id="farm", data={"id": "farm", "name": "Farm", "owner_name": "Owner"}
                )
            )
            session.execute(insert(farm_member_table).values(farm_id="farm", email=EMAIL))
            for number in (1, 2):
                session.execute(
                    insert(saedskifte_rotation_table).values(
                        saedskiftevariant=1,
                        variant=number,
                        rotation=[
                            {"afgrode_kode": 11, "udlaeg_kode": 9683 if number == 2 else None},
                            {"afgrode_kode": None, "udlaeg_kode": 9683},
                        ]
                        + [{}] * 6,
                    )
                )
        app = FastAPI()
        app.include_router(api.router, prefix="/api/v0")
        app.include_router(rotation_candidates.router, prefix="/api/v0")
        app.include_router(simulations.router, prefix="/api/v0")
        app.exception_handlers.update(main.app.exception_handlers)
        app.dependency_overrides[current_user] = lambda: AuthenticatedUser(email=EMAIL)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def cleanup_database(self):
        self.engine.dispose()
        with self.admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{self.schema}" CASCADE'))
        self.admin.dispose()

    def select_group(self, group_id, simulation_id="simulation"):
        simulation = Simulation(
            id=simulation_id,
            farm_id="farm",
            name="Test",
            created_at="2026",
            rotation_saedskiftevarianter=[group_id],
            rotation_n_norm_procenter=["100"],
        )
        with self.sessions.begin() as session:
            session.execute(
                insert(setups).values(
                    id=simulation_id, farm_id="farm", data=simulation.model_dump(mode="json")
                )
            )
            session.execute(insert(results).values(simulation_id=simulation_id))
        return simulation

    def copy(self, group_id, body=None):
        return self.client.post(f"/api/v0/saedskifte-rotations/{group_id}/duplicate", json=body)

    def test_create_adds_creator_as_only_member(self):
        response = self.client.post(
            "/api/v0/saedskifte-rotations", json=definition().model_dump(mode="json", by_alias=True)
        )

        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(store.list_members(response.json()["id"], EMAIL), [EMAIL])

    def test_member_can_copy_without_farms(self):
        source = store.create_group(definition(), EMAIL)
        with self.sessions.begin() as session:
            session.execute(delete(farm_member_table))

        response = self.copy(source.id)

        self.assertEqual(response.status_code, 201, response.text)

    def test_farm_member_can_copy_currently_selected_private_group(self):
        source = store.create_group(definition(), OTHER)
        self.select_group(source.id)

        response = self.copy(source.id)

        self.assertEqual(response.status_code, 201, response.text)

    def test_farm_member_cannot_manage_selected_private_group(self):
        source = store.create_group(definition(), OTHER)
        self.select_group(source.id)

        response = self.client.patch(
            f"/api/v0/saedskifte-rotations/{source.id}",
            json={"expectedRevision": 0, "name": "Changed"},
        )

        self.assertEqual(response.status_code, 404)

    def test_unrelated_group_cannot_be_copied(self):
        source = store.create_group(definition(), OTHER)

        response = self.copy(source.id)

        self.assertEqual(response.status_code, 404)

    def test_standard_requires_current_simulation_selection(self):
        response = self.copy("1")

        self.assertEqual(response.status_code, 404)

    def test_selected_standard_can_be_copied(self):
        self.select_group("1")

        response = self.copy("1")

        self.assertEqual(response.status_code, 201, response.text)
        self.assertFalse(response.json()["isStandard"])
        self.assertEqual(len(response.json()["variants"]), 2)
        self.assertEqual(
            [p["afgrodeKode"] for p in response.json()["variants"][0]["positions"]], [11, 11]
        )

    def test_deselected_source_cannot_be_copied(self):
        source = store.create_group(definition(), OTHER)
        simulation = self.select_group(source.id)
        with self.sessions.begin() as session:
            session.execute(
                update(setups).values(
                    data={**simulation.model_dump(mode="json"), "rotation_saedskiftevarianter": []}
                )
            )

        response = self.copy(source.id)

        self.assertEqual(response.status_code, 404)

    def test_historical_results_do_not_grant_copy_access(self):
        source = store.create_group(definition(), OTHER)
        self.select_group("1")
        with self.sessions.begin() as session:
            session.execute(
                update(results).values(
                    output={"rotation_groups": {source.id: source.model_dump(mode="json")}}
                )
            )

        response = self.copy(source.id)

        self.assertEqual(response.status_code, 404)

    def test_former_farm_membership_does_not_grant_copy_access(self):
        source = store.create_group(definition(), OTHER)
        self.select_group(source.id)
        with self.sessions.begin() as session:
            session.execute(delete(farm_member_table))

        response = self.copy(source.id)

        self.assertEqual(response.status_code, 404)

    def test_former_group_membership_does_not_grant_copy_access(self):
        source = store.create_group(definition(), OTHER)
        store.add_member(source.id, OTHER, EMAIL)
        store.remove_member(source.id, OTHER, EMAIL)

        response = self.copy(source.id)

        self.assertEqual(response.status_code, 404)

    def test_copy_gets_fresh_identities_and_requester_only_membership(self):
        source = store.create_group(
            definition(variants=[variant(), variant(codes=(1,), measures=())]), OTHER
        )
        store.add_member(source.id, OTHER, EMAIL)

        copied = store.duplicate_group(source.id, EMAIL)

        self.assertNotEqual(copied.id, source.id)
        self.assertTrue({v.id for v in copied.variants}.isdisjoint(v.id for v in source.variants))
        self.assertEqual(store.list_members(copied.id, EMAIL), [EMAIL])
        self.assertEqual(copied.revision, 0)

    def test_copy_does_not_change_simulation_selection(self):
        source = store.create_group(definition(), EMAIL)
        simulation = self.select_group(source.id)

        store.duplicate_group(source.id, EMAIL)

        with self.sessions() as session:
            saved = session.execute(select(setups.c.data)).scalar_one()
        self.assertEqual(saved, simulation.model_dump(mode="json"))

    def test_copy_reads_latest_definition_and_is_independent(self):
        source = store.create_group(definition(), EMAIL)
        store.update_group(
            source.id, UpdateRotationGroupRequest(expected_revision=0, name="Latest"), EMAIL
        )

        copied = store.duplicate_group(source.id, EMAIL)
        store.delete_group(source.id, EMAIL)

        self.assertEqual(store.get_group(copied.id, EMAIL).name, "Kopi af Latest")

    def test_copy_is_allowed_while_calculating(self):
        source = store.create_group(definition(), OTHER)
        self.select_group(source.id)
        with self.sessions.begin() as session:
            session.execute(update(results).values(status="in_progress"))

        response = self.copy(source.id)

        self.assertEqual(response.status_code, 201, response.text)

    def test_blank_copy_name_is_rejected(self):
        source = store.create_group(definition(), EMAIL)

        response = self.copy(source.id, {"name": " "})

        self.assertEqual(response.status_code, 422)

    def test_read_only_standard_cannot_be_updated(self):
        response = self.client.patch(
            "/api/v0/saedskifte-rotations/1", json={"expectedRevision": 0, "name": "Changed"}
        )

        self.assertEqual(response.status_code, 422)

    def test_updating_a_missing_rotation_returns_not_found(self):
        response = self.client.patch(
            "/api/v0/saedskifte-rotations/999", json={"expectedRevision": 0, "name": "Changed"}
        )

        self.assertEqual(response.status_code, 404)

    def test_copyability_metadata_tracks_selection(self):
        before = store.get_group("1", EMAIL)
        self.select_group("1")

        after = store.get_group("1", EMAIL)

        self.assertFalse(before.can_copy)
        self.assertTrue(after.can_copy)

    def test_stale_edit_is_a_conflict(self):
        source = store.create_group(definition(), EMAIL)
        store.update_group(
            source.id, UpdateRotationGroupRequest(expected_revision=0, name="New"), EMAIL
        )

        response = self.client.patch(
            f"/api/v0/saedskifte-rotations/{source.id}",
            json={"expectedRevision": 0, "name": "Stale"},
        )

        self.assertEqual(response.status_code, 409)

    def test_last_member_cannot_be_removed(self):
        source = store.create_group(definition(), EMAIL)

        response = self.client.delete(f"/api/v0/saedskifte-rotations/{source.id}/members/{EMAIL}")

        self.assertEqual(response.status_code, 409)

    def test_sharing_normalizes_email(self):
        source = store.create_group(definition(), EMAIL)

        response = self.client.post(
            f"/api/v0/saedskifte-rotations/{source.id}/members",
            json={"email": " OTHER@EXAMPLE.COM "},
        )

        self.assertEqual(response.status_code, 201, response.text)
        self.assertIn(OTHER, store.list_members(source.id, EMAIL))

    def test_unverified_user_cannot_be_added(self):
        source = store.create_group(definition(), EMAIL)
        with self.sessions.begin() as session:
            session.execute(
                update(app_user_table)
                .where(app_user_table.c.email == OTHER)
                .values(verified_at=None)
            )

        response = self.client.post(
            f"/api/v0/saedskifte-rotations/{source.id}/members", json={"email": OTHER}
        )

        self.assertEqual(response.status_code, 404)

    def test_new_selection_requires_membership(self):
        source = store.create_group(definition(), OTHER)

        with self.assertRaises(RotationGroupNotFoundError):
            settings.create(
                "farm",
                CreateSimulationRequest(
                    name="New", saedskiftevarianter=[source.id], n_norm_procenter=["100"]
                ),
                EMAIL,
            )

    def test_existing_selection_can_be_kept_by_nonmember(self):
        source = store.create_group(definition(), OTHER)
        simulation = self.select_group(source.id)

        updated = settings.update_settings(
            "farm",
            simulation.id,
            UpdateSimulationRequest(
                expected_revision=0, saedskiftevarianter=[source.id], name="Renamed"
            ),
            EMAIL,
        )

        self.assertEqual(updated.name, "Renamed")

    def test_deletion_preserves_outputs_and_removes_future_selection(self):
        source = store.create_group(definition(), EMAIL)
        self.select_group(source.id)
        output = {"rotation_groups": {source.id: source.model_dump(mode="json")}, "saved": 123}
        with self.sessions.begin() as session:
            session.execute(update(results).values(status="completed", output=output))

        store.delete_group(source.id, EMAIL)

        with self.sessions() as session:
            self.assertEqual(session.execute(select(results.c.output)).scalar_one(), output)
            self.assertEqual(session.execute(select(results.c.status)).scalar_one(), "outdated")
            self.assertEqual(
                session.execute(select(setups.c.data)).scalar_one()["rotation_saedskiftevarianter"],
                [],
            )

    def test_deletion_conflicts_with_active_calculation(self):
        source = store.create_group(definition(), EMAIL)
        self.select_group(source.id)
        with self.sessions.begin() as session:
            session.execute(update(results).values(status="queued"))

        with self.assertRaises(RotationGroupConflictError):
            store.delete_group(source.id, EMAIL)

    def test_edit_does_not_cancel_active_run(self):
        source = store.create_group(definition(), EMAIL)
        self.select_group(source.id)
        with self.sessions.begin() as session:
            session.execute(update(results).values(status="in_progress"))

        store.update_group(
            source.id, UpdateRotationGroupRequest(expected_revision=0, name="New"), EMAIL
        )

        with self.sessions() as session:
            self.assertEqual(session.execute(select(results.c.status)).scalar_one(), "in_progress")
            self.assertEqual(session.execute(select(setups.c.revision)).scalar_one(), 0)

    def test_edit_marks_saved_results_outdated(self):
        source = store.create_group(definition(), EMAIL)
        self.select_group(source.id)
        with self.sessions.begin() as session:
            session.execute(update(results).values(status="completed"))

        store.update_group(
            source.id, UpdateRotationGroupRequest(expected_revision=0, name="New"), EMAIL
        )

        with self.sessions() as session:
            self.assertEqual(session.execute(select(results.c.status)).scalar_one(), "outdated")

    def test_migration_preserves_standard_lookup_rows(self):
        members.drop(self.engine)
        groups.drop(self.engine)
        path = (
            Path(__file__).parents[1]
            / "database/migrations/versions/20261104_0001_saedskifte_groups.py"
        )
        spec = importlib.util.spec_from_file_location("rotation_migration", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)

        with self.engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()

        with self.sessions() as session:
            self.assertEqual(len(session.execute(select(saedskifte_rotation_table)).all()), 2)

    def test_lookup_reload_preserves_custom_groups(self):
        source = store.create_group(definition(), EMAIL)
        url = self.engine.url.update_query_dict({"options": f"-csearch_path={self.schema}"})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "lookup.csv"
            write_lookup(path, [source_row(1, 1, "Plante", first_crop="11", second_undersow="")])

            load_saedskifte_lookup(path, url.render_as_string(hide_password=False))

        self.assertEqual(store.get_group(source.id, EMAIL).name, source.name)

    def enable_optimizer(self, simulation, *, kind="optimize"):
        calculation_data(self)
        self.enterContext(patch.object(jobs, "SessionLocal", self.sessions))
        self.enterContext(patch.object(optimization_store, "SessionLocal", self.sessions))
        self.enterContext(
            patch.dict(os.environ, {"APP_ENV": "production", "OPTIMIZER_QUEUE_URL": "test"})
        )
        self.enterContext(patch.object(jobs, "sqs_client", return_value=Mock()))
        self.enterContext(patch.object(jobs, "wake_worker"))
        field = FieldRecord(
            id="field", farm_id="farm", name="Field", area_ha=2, db2=0, n_load=0, leaching=0, fen=0
        )
        setup = simulation_store.split_field(field.model_dump(mode="json"))
        setup["calculation_context"] = None
        simulation.optimization_settings.kind = kind
        with self.sessions.begin() as session:
            session.execute(
                update(setups)
                .where(setups.c.id == simulation.id)
                .values(
                    data=simulation.model_dump(mode="json"),
                    fields={field.id: setup},
                    field_order=[field.id],
                )
            )
        return field

    def submit(self, simulation, *, run_id=None, kind="optimize"):
        request = OptimizeSimulationRequest(expected_revision=0, run_id=run_id or uuid4())
        return jobs.submit("farm", simulation.id, EMAIL, kind, request)

    def execute(self, simulation, run):
        worker.execute(
            simulation.id, run.run_id, SimpleNamespace(get_remaining_time_in_millis=lambda: 900_000)
        )
        return simulation_store.get_result("farm", simulation.id, EMAIL)

    def test_submission_uses_latest_group_without_group_membership(self):
        source = store.create_group(definition(), OTHER)
        simulation = self.select_group(source.id)
        self.enable_optimizer(simulation)
        store.update_group(
            source.id, UpdateRotationGroupRequest(expected_revision=0, name="Latest"), OTHER
        )

        run = self.submit(simulation)
        result = self.execute(simulation, run)

        self.assertEqual(result.status, "completed", result.error)
        self.assertEqual(result.rotation_groups[source.id].revision, 1)

    def test_submission_retry_preserves_captured_definition(self):
        source = store.create_group(definition(), EMAIL)
        simulation = self.select_group(source.id)
        self.enable_optimizer(simulation)
        run = self.submit(simulation)
        store.update_group(
            source.id, UpdateRotationGroupRequest(expected_revision=0, name="Changed"), EMAIL
        )

        retried = self.submit(simulation, run_id=run.run_id)
        result = self.execute(simulation, retried)

        self.assertEqual(result.rotation_groups[source.id].revision, 0)
        self.assertEqual(result.status, "outdated", result.error)

    def test_new_run_uses_updated_definition(self):
        source = store.create_group(definition(), EMAIL)
        simulation = self.select_group(source.id)
        self.enable_optimizer(simulation)
        self.execute(simulation, self.submit(simulation))
        store.update_group(
            source.id, UpdateRotationGroupRequest(expected_revision=0, name="Changed"), EMAIL
        )

        result = self.execute(simulation, self.submit(simulation))

        self.assertEqual(result.rotation_groups[source.id].revision, 1)
        self.assertEqual(result.status, "completed", result.error)

    def test_yearly_optimizer_can_shift_custom_rotations(self):
        source = store.create_group(
            definition(variants=[variant(codes=(1, 11), measures=())]), EMAIL
        )
        simulation = self.select_group(source.id)
        self.enable_optimizer(simulation, kind="yearly")

        result = self.execute(simulation, self.submit(simulation, kind="yearly"))

        self.assertEqual(result.status, "completed", result.error)
        self.assertEqual(result.selected_candidates["field"].ref.saedskiftevariant, source.id)

    def test_view_includes_current_custom_catalog_and_copy_access(self):
        source = store.create_group(definition(), OTHER)
        simulation = self.select_group(source.id)
        self.enable_optimizer(simulation)
        result = self.execute(simulation, self.submit(simulation))
        self.assertEqual(result.status, "completed", result.error)

        view = read_model_store.get_simulation_view("farm", simulation.id, EMAIL)

        choices = view["data"]["yearly_optimization_candidates"][0]["saedskifter"]
        self.assertTrue(all(choice["canCopy"] for choice in choices))
        self.assertEqual({choice["name"] for choice in choices}, {source.name})

    def test_removed_variant_requires_unlocking_a_fixed_field(self):
        source = store.create_group(definition(), EMAIL)
        simulation = self.select_group(source.id)
        self.enable_optimizer(simulation)
        result = self.execute(simulation, self.submit(simulation))
        self.assertEqual(result.status, "completed", result.error)
        chosen = result.selected_candidates["field"]
        with self.sessions.begin() as session:
            fields = session.execute(select(setups.c.fields)).scalar_one()
            fields["field"].update(
                {
                    "fixed_candidate": chosen.model_dump(mode="json"),
                    "allowed_rotation_ids": [chosen.ref.to_id()],
                    "fixed": {"rotation_id": chosen.ref.to_id(), "crop_rotation": []},
                }
            )
            session.execute(update(setups).values(fields=fields))
        store.update_group(
            source.id,
            UpdateRotationGroupRequest(
                expected_revision=0, variants=[variant(codes=(1,), measures=())]
            ),
            EMAIL,
        )

        result = self.execute(simulation, self.submit(simulation))

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.error.code, "INFEASIBLE")

    def test_a_selection_that_no_longer_exists_has_its_own_code(self):
        with self.sessions() as session:
            with self.assertRaises(RotationDefinitionError) as raised:
                rotation_snapshot_store.resolve_selected(session, [str(uuid4())])

        self.assertEqual(raised.exception.code, "ROTATION_DELETED")

    def test_reading_deleted_source_results_does_not_resolve_the_source(self):
        source = store.create_group(definition(), EMAIL)
        simulation = self.select_group(source.id)
        self.enable_optimizer(simulation)
        result = self.execute(simulation, self.submit(simulation))
        self.assertEqual(result.status, "completed", result.error)

        store.delete_group(source.id, EMAIL)
        view = read_model_store.get_simulation_view("farm", simulation.id, EMAIL)

        self.assertEqual(
            view["data"]["saved_result"]["rotation_groups"][source.id]["name"], source.name
        )

    def test_active_run_survives_a_later_definition_exceeding_the_limit(self):
        source = store.create_group(definition(), EMAIL)
        simulation = self.select_group(source.id)
        self.enable_optimizer(simulation)
        run = self.submit(simulation)
        store.update_group(
            source.id,
            UpdateRotationGroupRequest(
                expected_revision=0, variants=[variant(codes=(11,) * 8, measures=(9682, 9683))]
            ),
            EMAIL,
        )

        result = self.execute(simulation, run)
        view = read_model_store.get_simulation_view("farm", simulation.id, EMAIL)

        self.assertEqual(result.status, "outdated", result.error)
        self.assertEqual(
            view["data"]["rotation_options_error"]["code"], "TOO_MANY_CUSTOM_CANDIDATES"
        )
        self.assertIn("4096", view["data"]["rotation_options_error"]["message"])
        self.assertIsNotNone(view["data"]["saved_result"])

    def test_simulation_settings_keep_the_rotation_error_code(self):
        error = RotationDefinitionError("Too many", code="TOO_MANY_CUSTOM_CANDIDATES")

        with patch.object(
            simulations.simulation_settings_store, "update_settings", side_effect=error
        ):
            response = self.client.patch(
                "/api/v0/farms/farm/simulations/simulation", json={"expectedRevision": 0}
            )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.json()["detail"], {"code": "TOO_MANY_CUSTOM_CANDIDATES", "message": "Too many"}
        )

    def test_missing_rotation_has_a_not_found_code(self):
        response = self.client.get(
            "/api/v0/saedskifte-rotations/00000000-0000-0000-0000-000000000000"
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"]["code"], "ROTATION_NOT_FOUND")

    def test_selection_in_an_unrelated_farm_does_not_allow_copying(self):
        source = store.create_group(definition(), OTHER)
        self.select_group(source.id)
        with self.sessions.begin() as session:
            session.execute(delete(farm_member_table))
            session.execute(insert(farm_member_table).values(farm_id="farm", email=THIRD))

        response = self.copy(source.id)

        self.assertEqual(response.status_code, 404)

    def test_farm_candidate_catalog_includes_selected_nonmember_rotation(self):
        source = store.create_group(definition(), OTHER)
        self.select_group(source.id)

        response = self.client.get("/api/v0/farms/farm/rotation-candidates/kategorier")

        self.assertEqual(response.status_code, 200, response.text)
        options = [option for category in response.json() for option in category["saedskifter"]]
        own = next(option for option in options if option["saedskiftevariant"] == source.id)
        self.assertTrue(own["canCopy"])

    def test_farm_member_can_preview_a_selected_custom_candidate(self):
        source = store.create_group(definition(), OTHER)
        simulation = self.select_group(source.id)
        self.enable_optimizer(simulation)
        result = self.execute(simulation, self.submit(simulation))
        ref = result.selected_candidates["field"].ref

        response = self.client.post(
            f"/api/v0/farms/farm/simulations/{simulation.id}/fields/field/preview-rotation",
            json={"baseRef": ref.model_dump(mode="json", by_alias=True)},
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["ref"]["saedskiftevariant"], source.id)

    def autumn_rotation(self):
        source = store.create_group(definition(), EMAIL)
        simulation = self.select_group(source.id)
        simulation.godning = GodningSettings(
            autumn_allocations=[{"afgrode_kode": 11, "kg_n_ha": 40}]
        )
        field = self.enable_optimizer(simulation)
        with self.sessions.begin() as session:
            session.execute(
                insert(field_table).values(
                    id=field.id, farm_id="farm", data=field.model_dump(mode="json")
                )
            )
        result = self.execute(simulation, self.submit(simulation))
        return simulation, result.selected_candidates["field"].ref

    def test_custom_candidate_evaluation_preserves_autumn_allocation(self):
        simulation, ref = self.autumn_rotation()

        response = self.client.post(
            "/api/v0/farms/farm/rotation-candidates/evaluate",
            json={
                "fieldIds": ["field"],
                "godning": simulation.godning.model_dump(mode="json", by_alias=True),
                "candidateRefs": [ref.model_dump(mode="json", by_alias=True)],
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            response.json()[0]["candidates"][0]["years"][0]["autumnAllocatedKgNHa"], 40
        )

    def test_custom_rotation_preview_preserves_autumn_allocation(self):
        simulation, ref = self.autumn_rotation()

        response = self.client.post(
            f"/api/v0/farms/farm/simulations/{simulation.id}/fields/field/preview-rotation",
            json={"baseRef": ref.model_dump(mode="json", by_alias=True)},
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["years"][0]["autumnAllocatedKgNHa"], 40)

    def test_custom_manual_rotation_preserves_autumn_allocation(self):
        simulation, ref = self.autumn_rotation()

        response = self.client.post(
            f"/api/v0/farms/farm/simulations/{simulation.id}/fields/field/apply-rotation",
            json={"baseRef": ref.model_dump(mode="json", by_alias=True)},
        )

        self.assertEqual(response.status_code, 200, response.text)
        with self.sessions() as session:
            fields = session.execute(
                select(setups.c.fields).where(setups.c.id == simulation.id)
            ).scalar_one()
        self.assertEqual(
            fields["field"]["fixed_candidate"]["years"][0]["autumn_allocated_kg_n_ha"], 40
        )

    def test_preview_rejects_a_measure_not_allowed_by_the_group(self):
        source = store.create_group(definition(), EMAIL)
        simulation = self.select_group(source.id)
        self.enable_optimizer(simulation)
        result = self.execute(simulation, self.submit(simulation))
        ref = result.selected_candidates["field"].ref

        response = self.client.post(
            f"/api/v0/farms/farm/simulations/{simulation.id}/fields/field/preview-rotation",
            json={
                "baseRef": ref.model_dump(mode="json", by_alias=True),
                "overrides": [
                    {"position": 0, "afgrodeKode": 11, "udlaegSet": True, "udlaegKode": 9682}
                ],
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"]["code"], "UDLAEG_NOT_PERMITTED")

    def test_stateless_evaluation_rejects_an_unrelated_custom_rotation(self):
        source = store.create_group(definition(), OTHER)
        field = FieldRecord(
            id="field", farm_id="farm", name="Field", area_ha=2, db2=0, n_load=0, leaching=0, fen=0
        )
        with self.sessions.begin() as session:
            session.execute(
                insert(field_table).values(
                    id=field.id, farm_id="farm", data=field.model_dump(mode="json")
                )
            )
        with custom.rotation_scope({source.id: source}):
            ref = candidate_evaluator.prepare_candidates([source.id], ["100"])[0].ref

        response = self.client.post(
            "/api/v0/farms/farm/rotation-candidates/evaluate",
            json={
                "fieldIds": [field.id],
                "godning": {},
                "candidateRefs": [ref.model_dump(mode="json", by_alias=True)],
            },
        )

        self.assertEqual(response.status_code, 404)

    def test_locked_field_area_ranges_use_current_source_crops(self):
        source = store.create_group(definition(variants=[variant(measures=())]), EMAIL)
        simulation = self.select_group(source.id)
        self.enable_optimizer(simulation)
        result = self.execute(simulation, self.submit(simulation))
        self.assertEqual(result.status, "completed", result.error)
        chosen = result.selected_candidates["field"]
        with self.sessions.begin() as session:
            fields = session.execute(select(setups.c.fields)).scalar_one()
            fields["field"].update(
                {
                    "fixed_candidate": chosen.model_dump(mode="json"),
                    "allowed_rotation_ids": [chosen.ref.to_id()],
                    "fixed": {"rotation_id": chosen.ref.to_id(), "crop_rotation": []},
                }
            )
            session.execute(update(setups).values(fields=fields))
            read_model_store.refresh_simulation_view(session, simulation.id)
        changed = source.variants[0].model_copy(
            update={
                "positions": [RotationPosition(afgrode_kode=1), RotationPosition(afgrode_kode=1)]
            }
        )
        store.update_group(
            source.id, UpdateRotationGroupRequest(expected_revision=0, variants=[changed]), EMAIL
        )

        view = read_model_store.get_simulation_view("farm", simulation.id, EMAIL)

        self.assertEqual({entry["afgrode_kode"] for entry in view["data"]["crop_area_ranges"]}, {1})
