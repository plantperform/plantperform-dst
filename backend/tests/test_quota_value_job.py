"""Kvote value curve job, end to end against PostgreSQL, plus its API guards."""

import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select, update
from test_optimizer_lifecycle import (
    CONTEXT,
    EMAIL,
    DatabaseTests,
    candidate,
    replace_cached_candidates,
    setups,
)

from app.api.v0 import simulations as simulations_api
from app.data import quota_value_store, repository
from app.domain.optimization import NUM_YEARS
from app.domain.quota_value import (
    QuotaTradeRange,
    QuotaTradeSimulationRequest,
    QuotaValueRequest,
    QuotaValueResult,
)
from app.domain.rotation_candidate import SimulationFieldCandidates
from app.services.scenario import quota_trade, rotations
from plantperform_fargate import quota_value_worker, worker
from plantperform_fargate.quota_value_worker import execute_quota_value

KYSTVAND = 233


def _leaching(evaluation, kg_n_ha):
    for year in evaluation.years:
        year.leaching_kg_n_ha = kg_n_ha
    evaluation.avg_leaching_kg_n_ha = kg_n_ha
    return evaluation


class QuotaValueJobTests(DatabaseTests):
    def setUp(self):
        super().setUp()
        # The curve prepares its candidates as an Års-optimering does, from the
        # same fixture the optimization tests use.
        self.enterContext(patch.object(quota_value_worker, "prepare", side_effect=worker.prepare))
        # Both fields in one opland with 10 kg N/år kvote each (cap 20). Low: 10 kg
        # N/år and 200 kr; high: 30 kg N/år and 600 kr (2 ha, 50 % retention).
        low, high = _leaching(candidate(100, "1"), 10), _leaching(candidate(300, "2"), 30)
        with self.sessions.begin() as session:
            fields = session.execute(select(setups.c.fields)).scalar_one()
            for setup in fields.values():
                setup.update(kystvand_id=KYSTVAND, kvotegivende=True, udledningskvote_mark_kgn=10)
            session.execute(update(setups).values(fields=fields))
            replace_cached_candidates(
                session,
                {
                    f: SimulationFieldCandidates(
                        field_id=f, jbnr=5, candidates=[low, high]
                    ).model_dump(mode="json")
                    for f in fields
                },
            )

    def quota_request(self, **values):
        return QuotaValueRequest(
            **{"expected_revision": 0, "run_id": uuid4(), "price_kr_per_kg": 5, **values}
        )

    def run_yearly(self):
        run = self.submit(self.request(yearly=True), "yearly")
        worker.execute("sim", run.run_id, CONTEXT)
        self.assertEqual(self.result().status, "completed")

    def run_quota_value(self, request=None):
        result, created = quota_value_store.submit_quota_value(
            "farm", "sim", EMAIL, request or self.quota_request()
        )
        self.assertTrue(created)
        execute_quota_value("sim", result.run_id)
        return quota_value_store.get_quota_value("farm", "sim", EMAIL)

    def test_curve_is_computed_from_the_completed_yearly_run(self):
        self.run_yearly()
        # The default window (25 % of the 20 kg cap) is too narrow to change the
        # plan here; buying 20 kg lets one field go high, 40 kg both.
        result = self.run_quota_value(
            self.quota_request(trade_range=QuotaTradeRange(min_kg=-10, max_kg=40, step_kg=20))
        )
        self.assertEqual(result.status, "completed", result.error)
        self.assertFalse(result.outdated)
        self.assertEqual(result.price_kr_per_kg, 5)
        output = result.output
        self.assertAlmostEqual(output.base_db2, 400)
        [curve] = output.curves
        self.assertEqual(curve.kystvand_id, KYSTVAND)
        self.assertEqual(curve.unconstrained_trade_kg, 40)
        self.assertEqual(curve.base_cap_by_year, {2027 + i: 20 for i in range(NUM_YEARS)})
        points = {p.trade_kg: p for p in curve.points}
        self.assertEqual(sorted(points), [-10, 0, 20, 40])
        # Both fields at low already use the whole cap, so nothing can be sold.
        self.assertEqual(points[-10].status, "INFEASIBLE")
        self.assertAlmostEqual(points[0].db2, 400)
        self.assertAlmostEqual(points[20].db2, 800)
        self.assertAlmostEqual(points[40].db2, 1200)
        self.assertEqual(points[20].cap_by_year[2027], 40)
        self.assertEqual(points[20].n_load_by_year[2027], 40)
        self.assertEqual(len(points[20].changed_fields), 1)
        self.assertEqual({r.field_id for r in points[40].rotations}, {"field-a", "field-b"})
        self.assertEqual({c.field_id for c in points[40].changed_fields}, {"field-a", "field-b"})
        self.assertEqual(points[40].changed_fields[0].from_rotation_id, "1:1:100")
        self.assertEqual(points[40].changed_fields[0].to_rotation_id, "1:2:100")
        self.assertIsNone(output.interaction)

    def test_requires_a_completed_yearly_run(self):
        with self.assertRaises(quota_value_store.QuotaValueConflictError):
            quota_value_store.submit_quota_value("farm", "sim", EMAIL, self.quota_request())
        run = self.submit()
        worker.execute("sim", run.run_id, CONTEXT)
        with self.assertRaises(quota_value_store.QuotaValueConflictError):
            quota_value_store.submit_quota_value("farm", "sim", EMAIL, self.quota_request())

    def test_repeated_request_does_not_start_a_second_run(self):
        self.run_yearly()
        request = self.quota_request()
        _, created = quota_value_store.submit_quota_value("farm", "sim", EMAIL, request)
        self.assertTrue(created)
        result, created = quota_value_store.submit_quota_value("farm", "sim", EMAIL, request)
        self.assertFalse(created)
        self.assertEqual(result.status, "queued")
        with self.assertRaises(quota_value_store.QuotaValueConflictError):
            quota_value_store.submit_quota_value("farm", "sim", EMAIL, self.quota_request())

    def test_a_new_optimization_marks_the_curve_outdated(self):
        self.run_yearly()
        self.assertFalse(self.run_quota_value().outdated)
        self.run_yearly()
        self.assertTrue(quota_value_store.get_quota_value("farm", "sim", EMAIL).outdated)

    def test_edit_before_the_job_starts_fails_it_as_outdated(self):
        self.run_yearly()
        result, _ = quota_value_store.submit_quota_value("farm", "sim", EMAIL, self.quota_request())
        self.edit(name="renamed")
        execute_quota_value("sim", result.run_id)
        current = quota_value_store.get_quota_value("farm", "sim", EMAIL)
        self.assertEqual(current.status, "failed")
        self.assertEqual(current.error.code, "OUTDATED")

    def test_restart_fails_interrupted_runs(self):
        self.run_yearly()
        quota_value_store.submit_quota_value("farm", "sim", EMAIL, self.quota_request())
        quota_value_store.recover_local_quota_values()
        current = quota_value_store.get_quota_value("farm", "sim", EMAIL)
        self.assertEqual((current.status, current.error.code), ("failed", "WORKER_LOST"))

    def test_non_members_cannot_read_or_start_it(self):
        self.assertIsNone(quota_value_store.get_quota_value("farm", "sim", "outsider@example.com"))
        with self.assertRaises(quota_value_store.QuotaValueNotFoundError):
            quota_value_store.submit_quota_value(
                "farm", "sim", "outsider@example.com", self.quota_request()
            )

    def test_a_trade_is_created_as_its_own_simulation_with_the_plan_locked(self):
        self.run_yearly()
        self.run_quota_value(
            self.quota_request(trade_range=QuotaTradeRange(min_kg=-10, max_kg=40, step_kg=20))
        )

        def evaluate(base_ref, overrides, **kwargs):
            # The rotation library is not in the test schema; give back the
            # candidate the plan named, as the real evaluation would.
            return candidate(300 if base_ref.variant == "2" else 100, base_ref.variant)

        with patch.object(
            rotations.candidate_evaluator, "evaluate_with_overrides", side_effect=evaluate
        ):
            created = quota_trade.create_trade_simulation(
                "farm",
                "sim",
                QuotaTradeSimulationRequest(
                    kystvand_id=KYSTVAND, trade_kg=20, name="Køb 20", price_kr_per_kg=35
                ),
                EMAIL,
            )
        self.assertEqual(created.unmatched_fields, [])
        simulation = created.simulation
        self.assertEqual(simulation.name, "Køb 20")
        # The trade is kept on the simulation; its DB2 stays the crops' alone.
        self.assertEqual(simulation.quota_trade.trade_kg, 20)
        self.assertEqual(simulation.quota_trade.price_kr_per_kg, 35)
        stored = repository.get_simulation("farm", simulation.id, EMAIL)
        self.assertEqual(stored.quota_trade, simulation.quota_trade)
        self.assertEqual(simulation.optimization_settings.kind, "yearly")
        [caps] = simulation.optimization_settings.max_n_load_by_kystvandopland
        self.assertEqual(caps.max_n_load_by_year[2027], 40)
        base_fields = repository.list_simulation_fields("farm", "sim", EMAIL)
        fields = repository.list_simulation_fields("farm", simulation.id, EMAIL)
        # The same marker under new ids, each locked to the trade's rotation.
        self.assertEqual(sorted(f.name for f in fields), sorted(f.name for f in base_fields))
        self.assertTrue(set(f.id for f in fields).isdisjoint(f.id for f in base_fields))
        locked = {f.name: f.allowed_rotation_ids for f in fields}
        self.assertEqual(sorted(len(ids) for ids in locked.values()), [1, 1])
        # One field goes high for the 20 kg bought; the other stays low.
        self.assertEqual(sorted(ids[0] for ids in locked.values()), ["1:1:100", "1:2:100"])


class QuotaValueApiTests(unittest.TestCase):
    user = type("User", (), {"email": EMAIL})()

    def request(self):
        return QuotaValueRequest(expected_revision=0, run_id=uuid4(), price_kr_per_kg=5)

    def test_production_does_not_compute_the_curve_yet(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}):
            with self.assertRaises(HTTPException) as raised:
                simulations_api.post_farm_simulation_quota_value(
                    "farm", "sim", self.user, self.request(), BackgroundTasks()
                )
        self.assertEqual(raised.exception.status_code, 503)

    def test_new_runs_are_started_in_the_background_once(self):
        tasks = BackgroundTasks()
        result = QuotaValueResult(status="queued", run_id="run")
        with (
            patch.dict(os.environ, {"APP_ENV": "development"}),
            patch.object(
                simulations_api, "submit_quota_value", side_effect=[(result, True), (result, False)]
            ),
        ):
            simulations_api.post_farm_simulation_quota_value(
                "farm", "sim", self.user, self.request(), tasks
            )
            simulations_api.post_farm_simulation_quota_value(
                "farm", "sim", self.user, self.request(), tasks
            )
        self.assertEqual(len(tasks.tasks), 1)
        self.assertEqual(tasks.tasks[0].args, ("sim", "run"))

    def test_conflicts_and_missing_simulations_map_to_http_errors(self):
        cases = (
            (quota_value_store.QuotaValueConflictError("busy"), 409),
            (quota_value_store.QuotaValueNotFoundError(), 404),
        )
        for error, status_code in cases:
            with (
                self.subTest(status_code=status_code),
                patch.dict(os.environ, {"APP_ENV": "development"}),
                patch.object(simulations_api, "submit_quota_value", side_effect=error),
                self.assertRaises(HTTPException) as raised,
            ):
                simulations_api.post_farm_simulation_quota_value(
                    "farm", "sim", self.user, self.request(), BackgroundTasks()
                )
            self.assertEqual(raised.exception.status_code, status_code)
        with (
            patch.object(simulations_api, "get_quota_value", return_value=None),
            self.assertRaises(HTTPException) as raised,
        ):
            simulations_api.get_farm_simulation_quota_value("farm", "sim", self.user)
        self.assertEqual(raised.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
