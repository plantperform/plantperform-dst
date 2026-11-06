"""Authorization uses real keys/memberships in isolated PostgreSQL test schemas."""

import importlib.util
import os
import re
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated
from unittest.mock import patch
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import APIRouter, Depends, FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, insert, select, text, update
from sqlalchemy.orm import sessionmaker

from app import auth, embed_keys
from app.api.v0 import router as api_routes
from app.api.v0.router import router
from app.auth import AuthenticatedUser, current_user
from app.data import db, economics_store, repository, saedskifte_store
from app.domain.saedskifte import RotationGroupConflictError
from app.domain.simulation import Simulation
from app.request_metrics import RequestMetrics

DATABASE = os.getenv("OPTIMIZER_TEST_DATABASE_URL")
VIEWER = "teaching@example.com"
EDITOR = "editor@example.com"


@unittest.skipUnless(DATABASE, "Set OPTIMIZER_TEST_DATABASE_URL for PostgreSQL integration tests")
class EmbedTests(unittest.TestCase):
    def setUp(self):
        self.schema = "embed_test_" + uuid4().hex
        self.admin = create_engine(DATABASE)
        with self.admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        self.engine = create_engine(
            DATABASE, connect_args={"options": f"-csearch_path={self.schema}"}
        )
        self.addCleanup(self.cleanup_schema)
        self.sessions = sessionmaker(bind=self.engine)
        db.metadata.create_all(
            self.engine,
            tables=[
                db.app_user_table,
                db.embed_key_table,
                db.farm_table,
                db.farm_member_table,
                db.farm_read_model_table,
                db.simulation_table,
                db.simulation_read_model_table,
                db.simulation_result_table,
                db.economics_module_table,
                db.economics_module_member_table,
                db.saedskifte_rotation_group_table,
                db.saedskifte_rotation_group_member_table,
            ],
        )
        for module in (auth, embed_keys, repository):
            self.enterContext(patch.object(module, "SessionLocal", self.sessions))
        self.enterContext(
            patch.dict(
                os.environ,
                {
                    "AUTH_JWT_SECRET": "test-only-secret-" * 3,
                    "AUTH_REFRESH_PEPPER": "test-only-pepper-" * 3,
                    "APP_ENV": "test",
                },
            )
        )
        self.key = embed_keys.manage_key("create", VIEWER)
        self.headers = {"Authorization": f"Bearer {self.key}"}
        with self.sessions.begin() as session:
            session.execute(
                insert(db.app_user_table).values(
                    email=EDITOR,
                    password_hash="unused",
                    verified_at=datetime.now(UTC),
                )
            )
            for farm in ("shared", "private"):
                session.execute(
                    insert(db.farm_table).values(
                        id=farm,
                        data={"id": farm, "name": farm, "owner_name": "Example"},
                    )
                )
                session.execute(insert(db.farm_member_table).values(farm_id=farm, email=EDITOR))
            session.execute(insert(db.farm_member_table).values(farm_id="shared", email=VIEWER))
            simulation = Simulation(
                id="sim", farm_id="private", name="Private", created_at="2026-11-06"
            )
            session.execute(
                insert(db.simulation_table).values(
                    id="sim",
                    farm_id="private",
                    data=simulation.model_dump(mode="json"),
                )
            )
        self.app = FastAPI()
        self.app.add_middleware(RequestMetrics)
        self.app.include_router(router, prefix="/api/v0")

        @self.app.get("/new-protected-read")
        def new_read(user: Annotated[AuthenticatedUser, Depends(current_user)]):
            return {"email": user.email}

        self.client = self.enterContext(TestClient(self.app))

    def cleanup_schema(self):
        self.engine.dispose()
        with self.admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{self.schema}" CASCADE'))
        self.admin.dispose()

    def get(self, path):
        return self.client.get("/api/v0" + path, headers=self.headers)

    def test_embed_identity_is_anonymous(self):
        response = self.get("/auth/me")

        self.assertEqual(response.json(), {"email": None, "role": "viewer"})

    def test_shared_farm_is_readable(self):
        response = self.get("/farms/shared")

        self.assertEqual(response.status_code, 200)

    def test_farm_listing_contains_only_shared_farms(self):
        response = self.get("/farms")

        self.assertEqual([farm["id"] for farm in response.json()], ["shared"])

    def test_private_farm_is_not_found(self):
        response = self.get("/farms/private")

        self.assertEqual(response.status_code, 404)

    def test_wrong_farm_simulation_is_not_found(self):
        response = self.get("/farms/shared/simulations/sim/view")

        self.assertEqual(response.status_code, 404)

    def test_removing_share_blocks_existing_key(self):
        self.get("/farms/shared")
        with self.sessions.begin() as session:
            session.execute(
                delete(db.farm_member_table).where(db.farm_member_table.c.email == VIEWER)
            )

        response = self.get("/farms/shared")

        self.assertEqual(response.status_code, 404)

    def test_revoked_key_is_unauthorized(self):
        embed_keys.manage_key("revoke", VIEWER)

        response = self.get("/auth/me")

        self.assertEqual(response.status_code, 401)

    def test_rotation_invalidates_previous_key(self):
        embed_keys.manage_key("rotate", VIEWER)

        response = self.get("/auth/me")

        self.assertEqual(response.status_code, 401)

    def test_rotated_key_works(self):
        key = embed_keys.manage_key("rotate", VIEWER)

        response = self.client.get(
            "/api/v0/auth/me", headers={"Authorization": f"Bearer {key}"}
        )

        self.assertEqual(response.status_code, 200)

    def test_repeated_key_use_is_safe_for_multiple_frames(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            statuses = list(pool.map(lambda _: self.get("/auth/me").status_code, range(8)))

        self.assertEqual(statuses, [200] * 8)

    def test_invalid_key_is_unauthorized(self):
        response = self.client.get(
            "/api/v0/auth/me", headers={"Authorization": "Bearer pp_embed_" + "x" * 43}
        )

        self.assertEqual(response.status_code, 401)

    def test_deleted_viewer_invalidates_key(self):
        with self.sessions.begin() as session:
            session.execute(delete(db.app_user_table).where(db.app_user_table.c.email == VIEWER))

        response = self.get("/auth/me")

        self.assertEqual(response.status_code, 401)

    def test_migration_preserves_existing_accounts_as_editors(self):
        path = (
            Path(__file__).parents[1]
            / "database/migrations/versions/20261106_0001_public_embeds.py"
        )
        spec = importlib.util.spec_from_file_location("embed_migration", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with self.engine.begin() as connection:
            operations = Operations(MigrationContext.configure(connection))
            with patch.object(migration, "op", operations):
                migration.downgrade()
                migration.upgrade()

            role = connection.execute(
                select(db.app_user_table.c.role).where(db.app_user_table.c.email == EDITOR)
            ).scalar_one()

        self.assertEqual(role, "editor")

    def test_key_cannot_be_issued_for_editor(self):
        with self.assertRaisesRegex(ValueError, "viewer account"):
            embed_keys.manage_key("issue", EDITOR)

    def test_issue_does_not_replace_active_key(self):
        with self.assertRaisesRegex(ValueError, "active key already exists"):
            embed_keys.manage_key("issue", VIEWER)

    def test_only_key_hash_is_stored(self):
        with self.sessions() as session:
            stored = session.execute(select(db.embed_key_table.c.token_hash)).scalar_one()

        self.assertEqual(stored, auth.embed_key_hash(self.key))

    def test_role_change_invalidates_embed_key(self):
        with self.sessions.begin() as session:
            session.execute(
                update(db.app_user_table)
                .where(db.app_user_table.c.email == VIEWER)
                .values(role="editor")
            )

        response = self.get("/auth/me")

        self.assertEqual(response.status_code, 401)

    def test_normal_viewer_token_uses_current_role(self):
        token = auth._issue_access_token(EDITOR, auth._config())
        with self.sessions.begin() as session:
            session.execute(
                update(db.app_user_table)
                .where(db.app_user_table.c.email == EDITOR)
                .values(role="viewer")
            )

        response = self.client.post(
            "/api/v0/farms",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "New", "ownerName": "Example"},
        )

        self.assertEqual(response.status_code, 403)

    def test_normal_viewer_identity_includes_role(self):
        token = auth._issue_access_token(VIEWER, auth._config())

        response = self.client.get("/api/v0/auth/me", headers={"Authorization": f"Bearer {token}"})

        self.assertEqual(response.json(), {"email": VIEWER, "role": "viewer"})

    def test_normal_editor_identity_includes_role(self):
        token = auth._issue_access_token(EDITOR, auth._config())

        response = self.client.get("/api/v0/auth/me", headers={"Authorization": f"Bearer {token}"})

        self.assertEqual(response.json(), {"email": EDITOR, "role": "editor"})

    def test_editor_can_still_create_farms(self):
        token = auth._issue_access_token(EDITOR, auth._config())

        response = self.client.post(
            "/api/v0/farms",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "New", "ownerName": "Example"},
        )

        self.assertEqual(response.status_code, 200)

    def test_unreviewed_read_is_denied(self):
        response = self.client.get("/new-protected-read", headers=self.headers)

        self.assertEqual(response.status_code, 403)

    def test_new_handler_inherits_router_authorization(self):
        child = APIRouter()

        @child.get("/new")
        def new_read():
            return {"data": "editor-only"}

        protected = APIRouter()
        with patch.object(api_routes, "router", protected):
            api_routes.include_protected(child)
        app = FastAPI()
        app.include_router(protected)

        with TestClient(app) as client:
            response = client.get("/new", headers=self.headers)

        self.assertEqual(response.status_code, 403)

    def test_embed_can_load_current_user(self):
        response = self.get("/auth/me")

        self.assertEqual(response.status_code, 200)

    def test_embed_cannot_read_member_emails(self):
        response = self.get("/farms/shared/members")

        self.assertEqual(response.status_code, 403)

    def test_viewer_responses_are_not_cached(self):
        response = self.get("/farms/shared")

        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_missing_history_is_reported_without_preparation(self):
        response = self.get("/farms/shared/view")

        self.assertEqual(response.json()["status"], "missing")

    def test_reading_missing_history_does_not_call_preparation(self):
        with patch("app.api.v0.farms.get_or_prepare_farm_view") as prepare:
            self.get("/farms/shared/view")

        prepare.assert_not_called()

    def test_last_farm_editor_cannot_leave(self):
        result = repository.remove_farm_member("shared", EDITOR, EDITOR)

        self.assertEqual(result, "last_member")

    def test_viewer_can_be_removed_while_editor_remains(self):
        result = repository.remove_farm_member("shared", EDITOR, VIEWER)

        self.assertEqual(result, "removed")

    def test_last_economics_editor_cannot_leave(self):
        with self.sessions.begin() as session:
            session.execute(
                insert(db.economics_module_table).values(id="module", name="Example", overrides={})
            )
            session.execute(
                insert(db.economics_module_member_table),
                [{"module_id": "module", "email": email} for email in (EDITOR, VIEWER)],
            )

        result = economics_store.remove_member("module", EDITOR, EDITOR)

        self.assertEqual(result, "last_member")

    def test_last_rotation_editor_cannot_leave(self):
        with self.sessions.begin() as session:
            session.execute(
                insert(db.saedskifte_rotation_group_table).values(
                    id="group", name="Example", variants=[]
                )
            )
            session.execute(
                insert(db.saedskifte_rotation_group_member_table),
                [{"group_id": "group", "email": email} for email in (EDITOR, VIEWER)],
            )

        with self.assertRaises(RotationGroupConflictError):
            saedskifte_store.remove_member("group", EDITOR, EDITOR)


def dependencies(dependant):
    return {dependant.call}.union(*(dependencies(child) for child in dependant.dependencies))


# Each route gets its own case so failures identify the operation that permitted a write.
application_routes = [
    route
    for application_router in vars(api_routes).values()
    if isinstance(application_router, APIRouter)
    for route in application_router.routes
]
for route in application_routes:
    if not isinstance(route, APIRoute) or current_user not in dependencies(route.dependant):
        continue
    for method in route.methods - {"GET", "HEAD", "OPTIONS"}:
        path = re.sub(r"\{[^}]+\}", "example", route.path)

        def denied(self, method=method, path=path):
            response = self.client.request(method, "/api/v0" + path, headers=self.headers, json={})

            self.assertEqual(response.status_code, 403, response.text)

        setattr(EmbedTests, f"test_viewer_denied_{method.lower()}_{route.name}", denied)
