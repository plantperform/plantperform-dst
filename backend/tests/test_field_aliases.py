"""Personal labels survive shared farms and snapshots without calculation writes."""

import importlib.util
import unittest
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, inspect, select, update
from test_optimizer_lifecycle import EMAIL, DatabaseTests, field

from app.api.v0 import farm_fields, field_aliases
from app.auth import AuthenticatedUser, current_user
from app.data import field_alias_store, simulation_store
from app.data.db import (
    app_user_table,
    farm_member_table,
    farm_read_model_table,
    farm_table,
    field_table,
    simulation_read_model_table,
    simulation_result_table,
    simulation_table,
    user_field_alias_table,
)
from app.domain.field_alias import UpdateFieldAliasRequest

OTHER = "other@example.com"


class AliasRequestTests(unittest.TestCase):
    def test_normalizes_empty_aliases_and_preserves_required_input(self):
        for value in (None, "", " \t\n "):
            self.assertIsNone(UpdateFieldAliasRequest(alias=value).alias)
        self.assertEqual(UpdateFieldAliasRequest(alias="  Sømarken  ").alias, "Sømarken")
        from pydantic import ValidationError

        for payload in ({}, {"alias": 123}):
            with self.assertRaises(ValidationError):
                UpdateFieldAliasRequest.model_validate(payload)

    def test_both_routes_require_authentication(self):
        app = FastAPI()
        app.include_router(farm_fields.router)
        app.include_router(field_aliases.router)
        with TestClient(app) as client:
            self.assertEqual(client.get("/field-aliases").status_code, 401)
            self.assertEqual(
                client.patch(
                    "/farms/farm/fields/field/alias", json={"alias": "Private"}
                ).status_code,
                401,
            )


class FieldAliasTests(DatabaseTests):
    def setUp(self):
        super().setUp()
        user_field_alias_table.create(self.engine)
        self.email = EMAIL
        app = FastAPI()
        app.include_router(farm_fields.router)
        app.include_router(field_aliases.router)
        app.dependency_overrides[current_user] = lambda: AuthenticatedUser(email=self.email)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        with self.sessions.begin() as session:
            session.execute(app_user_table.insert().values(email=OTHER, password_hash="test"))
            session.execute(farm_member_table.insert().values(farm_id="farm", email=OTHER))
            session.execute(farm_table.insert().values(id="farm-two", data={"name": "Second"}))
            session.execute(farm_member_table.insert().values(farm_id="farm-two", email=EMAIL))
            for farm_id, field_id in (("farm", "farm-field"), ("farm-two", "second-field")):
                value = field(field_id).model_copy(update={"farm_id": farm_id, "imk_id": 123})
                session.execute(
                    field_table.insert().values(
                        id=field_id, farm_id=farm_id, data=value.model_dump(mode="json")
                    )
                )
            snapshot = field("snapshot-field").model_copy(update={"imk_id": 123})
            session.execute(
                update(simulation_table)
                .where(simulation_table.c.id == "sim")
                .values(
                    fields={
                        snapshot.id: simulation_store.split_field(snapshot.model_dump(mode="json"))
                    },
                    field_order=[snapshot.id],
                )
            )

    def save(self, alias, *, farm="farm", field_id="farm-field", simulation_id=None):
        query = f"?simulation_id={simulation_id}" if simulation_id else ""
        return self.client.patch(
            f"/farms/{farm}/fields/{field_id}/alias{query}", json={"alias": alias}
        )

    def aliases(self):
        response = self.client.get("/field-aliases")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_two_members_have_independent_aliases_for_the_same_registry_field(self):
        self.assertEqual(
            self.save("  Sømarken  ").json(), {"fieldKey": "imk:123", "alias": "Sømarken"}
        )
        self.email = OTHER
        self.assertEqual(self.aliases(), {})
        self.assertEqual(self.save("My name").status_code, 200)
        self.assertEqual(self.aliases(), {"imk:123": "My name"})
        self.email = EMAIL
        self.assertEqual(self.aliases(), {"imk:123": "Sømarken"})

    def test_other_farms_and_simulation_uuids_resolve_to_the_same_alias(self):
        self.assertEqual(self.save("First").status_code, 200)
        second = self.save("Second", farm="farm-two", field_id="second-field")
        self.assertEqual(second.json(), {"fieldKey": "imk:123", "alias": "Second"})
        snapshot = self.save("Final", field_id="snapshot-field", simulation_id="sim")
        self.assertEqual(snapshot.json(), {"fieldKey": "imk:123", "alias": "Final"})
        self.assertEqual(self.aliases(), {"imk:123": "Final"})
        self.assertEqual(field_alias_store.list_aliases(EMAIL), {"imk:123": "Final"})

    def test_alias_survives_removal_reimport_and_farm_deletion(self):
        self.save("Persistent")
        with self.sessions.begin() as session:
            session.execute(delete(field_table).where(field_table.c.id == "farm-field"))
        self.assertEqual(self.aliases(), {"imk:123": "Persistent"})
        self.assertEqual(
            self.save("Snapshot", field_id="snapshot-field", simulation_id="sim").status_code, 200
        )
        imported = field("new-registration").model_copy(update={"imk_id": 123})
        with self.sessions.begin() as session:
            session.execute(
                field_table.insert().values(
                    id=imported.id, farm_id="farm", data=imported.model_dump(mode="json")
                )
            )
        self.assertEqual(
            self.save("Reimported", field_id=imported.id).json()["fieldKey"], "imk:123"
        )
        with self.sessions.begin() as session:
            session.execute(delete(farm_table).where(farm_table.c.id.in_(["farm", "farm-two"])))
        self.assertEqual(self.aliases(), {"imk:123": "Reimported"})

    def test_clearing_and_duplicate_aliases(self):
        legacy = field("legacy")
        with self.sessions.begin() as session:
            session.execute(
                field_table.insert().values(
                    id=legacy.id, farm_id="farm", data=legacy.model_dump(mode="json")
                )
            )
        self.save("Same")
        self.assertEqual(
            self.save("Same", field_id="legacy").json(),
            {"fieldKey": "field:legacy", "alias": "Same"},
        )
        self.assertEqual(self.aliases(), {"imk:123": "Same", "field:legacy": "Same"})
        for value in (None, "", "  \t\n"):
            self.save("Temporary")
            self.assertEqual(self.save(value).json(), {"fieldKey": "imk:123", "alias": None})
            self.assertEqual(self.aliases(), {"field:legacy": "Same"})

    def test_unknown_and_inaccessible_fields_or_simulations_return_not_found(self):
        self.email = OTHER
        cases = (
            {"farm": "farm-two", "field_id": "second-field"},
            {"farm": "missing"},
            {"field_id": "missing"},
            {"field_id": "second-field"},
            {"field_id": "snapshot-field"},
            {"field_id": "snapshot-field", "simulation_id": "missing"},
            {"farm": "farm-two", "field_id": "snapshot-field", "simulation_id": "sim"},
            {"field_id": "missing", "simulation_id": "sim"},
        )
        for kwargs in cases:
            with self.subTest(kwargs=kwargs):
                self.assertEqual(self.save("Unauthorized", **kwargs).status_code, 404)
        self.assertEqual(self.aliases(), {})

    def test_alias_edit_during_optimization_leaves_all_shared_data_unchanged(self):
        tables = (
            farm_table,
            field_table,
            simulation_table,
            simulation_result_table,
            farm_read_model_table,
            simulation_read_model_table,
        )
        with self.sessions.begin() as session:
            session.execute(update(simulation_result_table).values(status="in_progress"))
        with self.sessions() as session:
            before = [
                session.execute(select(table).order_by(*table.primary_key)).all()
                for table in tables
            ]
        self.assertEqual(
            self.save("Personal", field_id="snapshot-field", simulation_id="sim").status_code, 200
        )
        self.assertEqual(self.save("Personal").status_code, 200)
        with self.sessions() as session:
            after = [
                session.execute(select(table).order_by(*table.primary_key)).all()
                for table in tables
            ]
        self.assertEqual(after, before)
        self.queue.send_message.assert_not_called()

    def test_account_deletion_cleans_up_its_aliases(self):
        self.save("Private")
        self.email = OTHER
        self.save("Other")
        with self.sessions.begin() as session:
            session.execute(delete(app_user_table).where(app_user_table.c.email == EMAIL))
        self.assertEqual(field_alias_store.list_aliases(EMAIL), {})
        self.assertEqual(self.aliases(), {"imk:123": "Other"})

    def test_migration_upgrade_and_downgrade_only_touch_the_alias_table(self):
        path = (
            Path(__file__).parents[1]
            / "database/migrations/versions/20261014_0002_user_field_aliases.py"
        )
        spec = importlib.util.spec_from_file_location("alias_migration", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        user_field_alias_table.drop(self.engine)
        with self.engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                module.upgrade()
                self.assertIn("user_field_alias", inspect(connection).get_table_names())
                self.assertEqual(
                    inspect(connection).get_pk_constraint("user_field_alias")[
                        "constrained_columns"
                    ],
                    ["email", "field_key"],
                )
                connection.execute(
                    user_field_alias_table.insert().values(
                        email=EMAIL, field_key="imk:123", alias="Test"
                    )
                )
                self.assertEqual(
                    connection.execute(select(app_user_table.c.email)).scalars().all(),
                    [EMAIL, OTHER],
                )
                module.downgrade()
                self.assertNotIn("user_field_alias", inspect(connection).get_table_names())
