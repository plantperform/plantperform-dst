"""Exercise both sharing APIs and consuming routes through the application router."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import delete, insert, update
from test_optimizer_lifecycle import EMAIL, DatabaseTests

from app import main
from app.auth import AuthenticatedUser, current_user
from app.data import db, membership
from app.services import preparation_jobs

VIEWER = "viewer@example.com"
OTHER = "other@example.com"


def authenticated(request: Request):
    return AuthenticatedUser(email=request.headers.get("x-test-email", EMAIL))


class MembershipTests(DatabaseTests):
    def setUp(self):
        super().setUp()
        self.group_id = str(uuid4())
        self.resources = {
            "/farms/farm": (membership.farms, "farm"),
            "/economics-modules/module": (membership.modules, "module"),
            f"/saedskifte-rotations/{self.group_id}": (membership.rotations, self.group_id),
        }
        db.metadata.create_all(
            self.engine,
            tables=[
                db.economics_module_table,
                db.economics_module_member_table,
                db.saedskifte_rotation_group_table,
                db.saedskifte_rotation_group_member_table,
            ],
        )
        with self.sessions.begin() as session:
            session.execute(
                insert(db.app_user_table),
                [
                    {"email": email, "password_hash": "test", "verified_at": datetime.now(UTC)}
                    for email in (VIEWER, OTHER)
                ],
            )
            session.execute(
                insert(db.economics_module_table).values(id="module", name="M", overrides={})
            )
            session.execute(
                insert(db.saedskifte_rotation_group_table).values(
                    id=self.group_id,
                    name="R",
                    variants=[{"id": str(uuid4()), "positions": [{"afgrode_kode": 11}]}],
                )
            )
            for store, resource_id in self.resources.values():
                if store is not membership.farms:
                    session.execute(
                        insert(store.members).values(
                            {store.resource_key: resource_id, "email": EMAIL}
                        )
                    )
                session.execute(
                    insert(store.members).values(
                        {
                            store.resource_key: resource_id,
                            "email": VIEWER,
                            "role": "viewer",
                        }
                    )
                )
        self.enterContext(patch.dict(main.app.dependency_overrides, {current_user: authenticated}))
        self.client = TestClient(main.app)

    def call(self, method, path, *, actor=EMAIL, **kwargs):
        return self.client.request(
            method, "/api/v0" + path, headers={"x-test-email": actor}, **kwargs
        )

    @property
    def definitions(self):
        return ("/economics-modules/module", f"/saedskifte-rotations/{self.group_id}")

    def select_definitions_for_farm_viewer(self):
        with self.sessions.begin() as session:
            session.execute(
                insert(db.farm_member_table).values(farm_id="farm", email=OTHER, role="viewer")
            )
            session.execute(
                update(db.simulation_table)
                .where(db.simulation_table.c.id == "sim")
                .values(
                    data=db.simulation_table.c.data.op("||")(
                        {
                            "economics_module_id": "module",
                            "rotation_saedskiftevarianter": [self.group_id],
                        }
                    )
                )
            )

    def test_current_selection_grants_viewer_on_both_definitions(self):
        self.select_definitions_for_farm_viewer()

        for path in self.definitions:
            with self.subTest(path=path):
                response = self.call("GET", path, actor=OTHER)

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["effectiveRole"], "viewer")

    def test_inherited_viewer_can_read_explicit_roster(self):
        self.select_definitions_for_farm_viewer()

        for path in self.definitions:
            for suffix in ("/members", "/memberships"):
                with self.subTest(path=path, suffix=suffix):
                    response = self.call("GET", path + suffix, actor=OTHER)

                    self.assertEqual(response.status_code, 200)
                    self.assertEqual({row["email"] for row in response.json()}, {EMAIL, VIEWER})

    def test_libraries_include_inherited_definitions(self):
        self.select_definitions_for_farm_viewer()

        for path, resource_id in [
            ("/economics-modules", "module"),
            ("/saedskifte-rotations?standard=false", self.group_id),
        ]:
            with self.subTest(path=path):
                response = self.call("GET", path, actor=OTHER)

                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    [r["effectiveRole"] for r in response.json() if r["id"] == resource_id],
                    ["viewer"],
                )

    def test_inherited_viewers_can_duplicate_definitions(self):
        self.select_definitions_for_farm_viewer()

        for path in self.definitions:
            with self.subTest(path=path):
                response = self.call("POST", path + "/duplicate", actor=OTHER)

                self.assertEqual(response.status_code, 201)
                self.assertEqual(response.json()["effectiveRole"], "editor")

    def test_inherited_viewers_cannot_edit_or_share_sources(self):
        self.select_definitions_for_farm_viewer()

        for path in self.definitions:
            for method, suffix, body in [
                ("PATCH", "", {"expectedRevision": 0, "name": "Edited"}),
                ("DELETE", "", None),
                ("POST", "/memberships", {"email": OTHER, "role": "editor"}),
            ]:
                with self.subTest(path=path, method=method):
                    response = self.call(method, path + suffix, actor=OTHER, json=body)

                    self.assertEqual(response.status_code, 403)

    def test_explicit_editor_promotion_takes_precedence(self):
        self.select_definitions_for_farm_viewer()

        for path in self.definitions:
            with self.subTest(path=path):
                promoted = self.call(
                    "PATCH", path + "/memberships/" + OTHER, json={"role": "editor"}
                )

                self.assertEqual(promoted.status_code, 200)
                self.assertEqual(
                    self.call("GET", path, actor=OTHER).json()["effectiveRole"], "editor"
                )

    def test_removing_explicit_membership_restores_inherited_access(self):
        self.select_definitions_for_farm_viewer()

        for path in self.definitions:
            with self.subTest(path=path):
                added = self.call(
                    "POST", path + "/memberships", json={"email": OTHER, "role": "editor"}
                )
                self.assertEqual(added.status_code, 201)

                removed = self.call("DELETE", path + "/memberships/" + OTHER)

                self.assertEqual(removed.status_code, 204)
                self.assertEqual(
                    self.call("GET", path, actor=OTHER).json()["effectiveRole"], "viewer"
                )

    def test_historical_snapshots_do_not_extend_viewer_access(self):
        self.select_definitions_for_farm_viewer()
        with self.sessions.begin() as session:
            session.execute(
                update(db.simulation_table).values(
                    data={
                        "economics_module_id": "standard",
                        "economics_snapshot": {"source_id": "module"},
                        "rotation_saedskiftevarianter": [],
                    }
                )
            )
            session.execute(
                update(db.simulation_result_table).values(
                    output={"rotation_groups": {self.group_id: {}}}
                )
            )

        for path in self.definitions:
            with self.subTest(path=path):
                self.assertEqual(self.call("GET", path, actor=OTHER).status_code, 404)

    def test_losing_farm_membership_revokes_inherited_access(self):
        self.select_definitions_for_farm_viewer()
        with self.sessions.begin() as session:
            session.execute(
                delete(db.farm_member_table).where(db.farm_member_table.c.email == OTHER)
            )

        for path in self.definitions:
            with self.subTest(path=path):
                self.assertEqual(
                    self.call("POST", path + "/duplicate", actor=OTHER).status_code, 404
                )

    def test_reusing_definitions_grants_viewer_access_on_the_destination_farm(self):
        self.select_definitions_for_farm_viewer()
        reader = "destination@example.com"
        with self.sessions.begin() as session:
            session.execute(insert(db.app_user_table).values(email=reader, password_hash="test"))
            session.execute(
                insert(db.farm_table).values(
                    id="destination", data={"id": "destination", "name": "B", "owner_name": "B"}
                )
            )
            session.execute(
                insert(db.farm_member_table),
                [
                    {"farm_id": "destination", "email": OTHER, "role": "editor"},
                    {"farm_id": "destination", "email": reader, "role": "viewer"},
                ],
            )

        with patch("app.services.rotations.choices.list_udlaeg_koder", return_value=[]):
            response = self.call(
                "POST",
                "/farms/destination/simulations",
                actor=OTHER,
                json={
                    "name": "Genbrug",
                    "economicsModuleId": "module",
                    "saedskiftevarianter": [self.group_id],
                    "nNormProcenter": ["100"],
                },
            )

        self.assertEqual(response.status_code, 201, response.text)
        for path in self.definitions:
            with self.subTest(path=path):
                self.assertEqual(
                    self.call("GET", path, actor=reader).json()["effectiveRole"], "viewer"
                )

    def test_viewer_can_read_complete_roster(self):
        expected = sorted(
            [{"email": EMAIL, "role": "editor"}, {"email": VIEWER, "role": "viewer"}],
            key=lambda row: row["email"],
        )
        for path in self.resources:
            with self.subTest(path=path):
                response = self.call("GET", path + "/memberships", actor=VIEWER)

                self.assertEqual(response.json(), expected)

    def make_creator_with_other_editor(self):
        with self.sessions.begin() as session:
            session.execute(
                update(db.farm_table).where(db.farm_table.c.id == "farm").values(created_by=EMAIL)
            )
            session.execute(
                insert(db.farm_member_table).values(farm_id="farm", email=OTHER, role="editor")
            )

    def test_roster_marks_only_the_creator(self):
        self.make_creator_with_other_editor()

        response = self.call("GET", "/farms/farm/memberships", actor=VIEWER)

        self.assertEqual(
            response.json(),
            [
                {"email": EMAIL, "role": "editor", "creator": True},
                {"email": OTHER, "role": "editor"},
                {"email": VIEWER, "role": "viewer"},
            ],
        )

    def test_other_editor_cannot_remove_or_demote_the_creator(self):
        self.make_creator_with_other_editor()
        for method, suffix, body in [
            ("PATCH", f"/memberships/{EMAIL}", {"role": "viewer"}),
            ("DELETE", f"/memberships/{EMAIL}", None),
            ("DELETE", f"/members/{EMAIL}", None),
        ]:
            with self.subTest(method=method, suffix=suffix):
                response = self.call(method, "/farms/farm" + suffix, actor=OTHER, json=body)

                self.assertEqual(response.status_code, 409)
        self.assertIn(
            {"email": EMAIL, "role": "editor", "creator": True},
            self.call("GET", "/farms/farm/memberships").json(),
        )

    def test_creator_who_steps_down_can_be_removed(self):
        self.make_creator_with_other_editor()
        self.call("PATCH", f"/farms/farm/memberships/{EMAIL}", json={"role": "viewer"})

        response = self.call("DELETE", f"/farms/farm/memberships/{EMAIL}", actor=OTHER)

        self.assertEqual(response.status_code, 204)

    def test_new_farm_marks_its_creator(self):
        farm = self.call("POST", "/farms", json={"name": "Ny gård", "ownerName": "Anders Bak"})

        roster = self.call("GET", f"/farms/{farm.json()['id']}/memberships")

        self.assertEqual(roster.json(), [{"email": EMAIL, "role": "editor", "creator": True}])

    def test_only_the_creator_can_delete_the_farm(self):
        self.make_creator_with_other_editor()

        self.assertEqual(self.call("DELETE", "/farms/farm", actor=OTHER).status_code, 403)
        self.assertEqual(self.call("DELETE", "/farms/farm").status_code, 204)

    def test_legacy_add_assigns_editor(self):
        for path in self.resources:
            with self.subTest(path=path):
                response = self.call("POST", path + "/members", json={"email": OTHER})

                self.assertEqual(response.status_code, 201)
                self.assertEqual(response.json(), {"email": OTHER})
                self.assertIn(
                    {"email": OTHER, "role": "editor"},
                    self.call("GET", path + "/memberships").json(),
                )

    def test_legacy_add_preserves_existing_viewer(self):
        for path in self.resources:
            with self.subTest(path=path):
                response = self.call("POST", path + "/members", json={"email": VIEWER})

                self.assertEqual(response.status_code, 409)
                self.assertIn(
                    {"email": VIEWER, "role": "viewer"},
                    self.call("GET", path + "/memberships").json(),
                )

    def test_editor_can_add_viewer(self):
        for path in self.resources:
            with self.subTest(path=path):
                response = self.call(
                    "POST", path + "/memberships", json={"email": OTHER.upper(), "role": "viewer"}
                )

                self.assertEqual(response.status_code, 201)
                self.assertEqual(response.json(), {"email": OTHER, "role": "viewer"})

    def test_editor_can_promote_viewer(self):
        for path in self.resources:
            with self.subTest(path=path):
                response = self.call(
                    "PATCH", f"{path}/memberships/{VIEWER}", json={"role": "editor"}
                )

                self.assertEqual(response.status_code, 200)
                self.assertIn(
                    {"email": VIEWER, "role": "editor"},
                    self.call("GET", path + "/memberships").json(),
                )

    def test_viewer_can_leave_through_both_apis(self):
        for path in self.resources:
            for route in ("members", "memberships"):
                with self.subTest(path=path, route=route):
                    if route == "memberships":
                        self.call(
                            "POST", path + "/memberships", json={"email": VIEWER, "role": "viewer"}
                        )

                    response = self.call("DELETE", f"{path}/{route}/{VIEWER.upper()}", actor=VIEWER)

                    self.assertEqual(response.status_code, 204)
                    self.assertEqual(
                        self.call("GET", path + "/memberships", actor=VIEWER).status_code, 404
                    )

    def test_viewer_cannot_manage_access(self):
        for path in self.resources:
            for method, suffix, body in [
                ("POST", "/members", {"email": OTHER}),
                ("POST", "/memberships", {"email": OTHER, "role": "viewer"}),
                ("PATCH", f"/memberships/{VIEWER}", {"role": "editor"}),
                ("DELETE", f"/members/{EMAIL}", None),
                ("DELETE", f"/memberships/{EMAIL}", None),
            ]:
                with self.subTest(path=path, method=method, suffix=suffix):
                    response = self.call(method, path + suffix, actor=VIEWER, json=body)

                    self.assertEqual(response.status_code, 403)

    def test_invalid_role_is_rejected(self):
        response = self.call(
            "POST", "/farms/farm/memberships", json={"email": OTHER, "role": "owner"}
        )

        self.assertEqual(response.status_code, 422)

    def test_viewer_cannot_mutate_resources(self):
        for path in self.resources:
            with self.subTest(path=path):
                response = self.call("DELETE", path, actor=VIEWER)

                self.assertEqual(response.status_code, 403)

    def test_concurrent_self_demotion_and_removal_retain_an_editor(self):
        for path in self.resources:
            self.call("POST", path + "/members", json={"email": OTHER})
            barrier = Barrier(2)

            def demote(path, barrier):
                barrier.wait(timeout=5)
                return self.call("PATCH", f"{path}/memberships/{EMAIL}", json={"role": "viewer"})

            def leave(path, barrier):
                barrier.wait(timeout=5)
                return self.call("DELETE", f"{path}/members/{OTHER}", actor=OTHER)

            with self.subTest(path=path), ThreadPoolExecutor(max_workers=2) as pool:
                attempts = [pool.submit(action, path, barrier) for action in (demote, leave)]

                statuses = sorted(attempt.result().status_code for attempt in attempts)

                self.assertIn(statuses, ([200, 409], [204, 409]))
                roster = self.call("GET", path + "/memberships", actor=VIEWER).json()
                self.assertEqual(sum(member["role"] == "editor" for member in roster), 1)

    def test_farm_writes_and_previews_require_editor_before_dispatch(self):
        for method, suffix in [
            ("POST", "fields"),
            ("PATCH", "fields/field/alias"),
            ("POST", "simulations"),
            ("PATCH", "simulations/sim"),
            ("POST", "simulations/sim/optimize"),
            ("POST", "simulations/sim/creation/retry"),
            ("POST", "simulations/sim/quota-value"),
            ("POST", "simulations/sim/economics/recalculate"),
            ("POST", "rotation-candidates/evaluate"),
            ("POST", "simulations/sim/fields/field/preview-rotation"),
            ("POST", "history/retry"),
        ]:
            with self.subTest(suffix=suffix):
                response = self.call(method, "/farms/farm/" + suffix, actor=VIEWER, json={})

                self.assertEqual(response.status_code, 403)
        self.queue.send_message.assert_not_called()

    def test_viewer_read_does_not_prepare_history(self):
        with self.sessions.begin() as session:
            session.execute(delete(db.farm_read_model_table))

        with patch.object(preparation_jobs, "_prepare_on_load") as prepare:
            response = self.call("GET", "/farms/farm/view", actor=VIEWER)

        self.assertEqual(response.json()["status"], "missing")
        prepare.assert_not_called()

    def test_viewer_poll_reports_missing_history_when_completed_row_has_no_data(self):
        with self.sessions.begin() as session:
            session.execute(update(db.farm_read_model_table).values(status="done", data=None))

        response = self.call("GET", "/farms/farm/view?include_data=false", actor=VIEWER)

        self.assertEqual(response.json()["status"], "missing")

    def test_viewer_can_copy_a_rotation(self):
        response = self.call(
            "POST", f"/saedskifte-rotations/{self.group_id}/duplicate", actor=VIEWER
        )

        self.assertEqual(response.status_code, 201)
        roster = self.call(
            "GET", f"/saedskifte-rotations/{response.json()['id']}/memberships", actor=VIEWER
        )
        self.assertEqual(roster.json(), [{"email": VIEWER, "role": "editor"}])

    def test_viewer_can_copy_a_module(self):
        response = self.call("POST", "/economics-modules/module/duplicate", actor=VIEWER)

        self.assertEqual(response.status_code, 201)
        roster = self.call(
            "GET", f"/economics-modules/{response.json()['id']}/memberships", actor=VIEWER
        )
        self.assertEqual(roster.json(), [{"email": VIEWER, "role": "editor"}])

    def test_module_viewer_can_use_profile_on_farm_they_edit(self):
        with self.sessions.begin() as session:
            session.execute(
                update(db.farm_member_table)
                .where(db.farm_member_table.c.email == VIEWER)
                .values(role="editor")
            )

        response = self.call(
            "PATCH",
            "/farms/farm/simulations/sim/economics",
            actor=VIEWER,
            json={"expectedRevision": 0, "economicsModuleId": "module"},
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["economicsModuleId"], "module")
