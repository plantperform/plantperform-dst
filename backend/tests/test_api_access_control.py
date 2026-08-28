import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://dst2:dst2@localhost:5432/dst2",
)

from fastapi import HTTPException

from app.api.v0 import registry, rotation_candidates, simulations
from app.auth import AuthenticatedUser, current_user

MEMBER = AuthenticatedUser(email="member@example.com")


def dependency_calls(route: object) -> set[object]:
    def collect(dependant: object) -> set[object]:
        calls = {getattr(dependant, "call", None)}
        for dependency in getattr(dependant, "dependencies", []):
            calls.update(collect(dependency))
        return calls

    return collect(route.dependant)  # type: ignore[attr-defined]


class SimulationAccessControlTests(unittest.TestCase):
    def assert_not_found(self, func: object, *args: object, **kwargs: object) -> None:
        with self.assertRaises(HTTPException) as context:
            func(*args, **kwargs)  # type: ignore[operator]
        self.assertEqual(context.exception.status_code, 404)

    def test_rework_routes_require_authentication(self) -> None:
        suffixes = (
            "/optimize-yearly",
            "/yearly-optimization-candidates",
            "/fields/{field_id}/candidate-detail",
            "/fields/{field_id}/preview-rotation",
            "/fields/{field_id}/apply-rotation",
            "/yearly-summary",
        )

        for suffix in suffixes:
            route = next(
                route for route in simulations.router.routes if route.path.endswith(suffix)
            )
            self.assertIn(current_user, dependency_calls(route), suffix)

    def test_yearly_optimization_forwards_member_email(self) -> None:
        with patch.object(
            simulations,
            "run_yearly_optimization",
            side_effect=simulations.OptimizationNotFoundError,
        ) as run_optimization:
            self.assert_not_found(
                simulations.post_farm_simulation_yearly_optimization,
                "farm-1",
                "simulation-1",
                MEMBER,
            )

        self.assertEqual(run_optimization.call_args.args[-1], MEMBER.email)

    def test_yearly_candidates_forwards_member_email(self) -> None:
        with patch.object(
            simulations,
            "list_simulation_field_candidates",
            return_value=None,
        ) as list_candidates:
            self.assert_not_found(
                simulations.get_farm_simulation_yearly_optimization_candidates,
                "farm-1",
                "simulation-1",
                MEMBER,
            )

        self.assertEqual(list_candidates.call_args.args[-1], MEMBER.email)

    def test_candidate_detail_forwards_member_email(self) -> None:
        with patch.object(
            simulations,
            "get_simulation_field_candidate_detail",
            return_value=None,
        ) as get_detail:
            self.assert_not_found(
                simulations.get_farm_simulation_field_candidate_detail,
                "farm-1",
                "simulation-1",
                "field-1",
                MEMBER,
            )

        self.assertEqual(get_detail.call_args.args[-1], MEMBER.email)

    def test_preview_rotation_forwards_member_email(self) -> None:
        with patch.object(
            simulations,
            "get_simulation",
            return_value=None,
        ) as get_simulation:
            self.assert_not_found(
                simulations.post_farm_simulation_field_preview_rotation,
                "farm-1",
                "simulation-1",
                "field-1",
                None,  # type: ignore[arg-type]
                MEMBER,
            )

        self.assertEqual(get_simulation.call_args.args[-1], MEMBER.email)

    def test_apply_rotation_forwards_member_email(self) -> None:
        request = SimpleNamespace(base_ref=object(), overrides=[], start_year=1)
        with patch.object(
            simulations,
            "apply_manual_rotation",
            side_effect=simulations.ManualRotationNotFoundError,
        ) as apply_rotation:
            self.assert_not_found(
                simulations.post_farm_simulation_field_apply_rotation,
                "farm-1",
                "simulation-1",
                "field-1",
                request,
                MEMBER,
            )

        self.assertEqual(apply_rotation.call_args.args[-2], MEMBER.email)

    def test_yearly_summary_forwards_member_email(self) -> None:
        with patch.object(
            simulations,
            "compute_yearly_summary",
            return_value=None,
        ) as yearly_summary:
            self.assert_not_found(
                simulations.get_farm_simulation_yearly_summary,
                "farm-1",
                "simulation-1",
                MEMBER,
            )

        self.assertEqual(yearly_summary.call_args.args[-1], MEMBER.email)


class RotationCandidateAccessControlTests(unittest.TestCase):
    def test_metadata_route_requires_farm_membership(self) -> None:
        route = next(
            route
            for route in rotation_candidates.router.routes
            if route.path.endswith("/n-norm-procenter")
        )

        calls = dependency_calls(route)
        self.assertIn(rotation_candidates._require_farm_member, calls)
        self.assertIn(current_user, calls)

    def test_metadata_rejects_non_member(self) -> None:
        with patch.object(rotation_candidates, "get_farm", return_value=None):
            with self.assertRaises(HTTPException) as context:
                rotation_candidates._require_farm_member("farm-1", MEMBER)

        self.assertEqual(context.exception.status_code, 404)

    def test_metadata_allows_member(self) -> None:
        with patch.object(rotation_candidates, "get_farm", return_value=object()):
            user = rotation_candidates._require_farm_member("farm-1", MEMBER)

        self.assertEqual(user, MEMBER)

    def test_evaluation_forwards_member_email(self) -> None:
        request = SimpleNamespace(field_ids=["field-1"])
        with patch.object(rotation_candidates, "list_fields", return_value=None) as list_fields:
            with self.assertRaises(HTTPException) as context:
                rotation_candidates.evaluate_rotation_candidates(
                    "farm-1",
                    request,  # type: ignore[arg-type]
                    object(),  # type: ignore[arg-type]
                    MEMBER,
                )

        self.assertEqual(context.exception.status_code, 404)
        self.assertEqual(list_fields.call_args.args, ("farm-1", MEMBER.email))


class RegistryAccessControlTests(unittest.TestCase):
    def test_registry_search_requires_authentication(self) -> None:
        route = next(
            route for route in registry.router.routes if route.path.endswith("/fields/search")
        )
        self.assertIn(current_user, dependency_calls(route))

        with self.assertRaises(HTTPException) as context:
            current_user(None)
        self.assertEqual(context.exception.status_code, 401)

    def test_registry_search_allows_verified_user_without_farm_membership(self) -> None:
        db = object()
        with patch.object(registry, "search_registry_fields", return_value=[]) as search_fields:
            result = registry.search_fields(db, MEMBER)

        self.assertEqual(result, [])
        search_fields.assert_called_once_with(db, cvr=None, limit=100)

    def test_owned_tile_rejects_non_member(self) -> None:
        db = object()
        with patch.object(registry, "get_owned_imk_ids", return_value=None) as get_owned_imk_ids:
            with self.assertRaises(HTTPException) as context:
                registry.get_tile(
                    1,
                    1,
                    1,
                    db,
                    MEMBER,
                    owned_by_farm_id="farm-1",
                )

        self.assertEqual(context.exception.status_code, 404)
        self.assertEqual(get_owned_imk_ids.call_args.args, (db, "farm-1", MEMBER.email))
