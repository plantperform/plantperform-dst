"""Public settings must not control the worker's execution budget."""

import unittest
from uuid import uuid4

from app.domain.optimization import (
    EXECUTION_TIMEOUT_SECONDS,
    OptimizationSettings,
    OptimizeSimulationRequest,
    YearlyOptimizeSimulationRequest,
)
from app.domain.simulation import CreateSimulationRequest, Simulation, UpdateSimulationRequest


class ServerDurationTests(unittest.TestCase):
    def test_legacy_durations_are_ignored_by_both_request_models(self):
        for model in (OptimizeSimulationRequest, YearlyOptimizeSimulationRequest):
            for name in ("timeLimitSeconds", "time_limit_seconds"):
                for value in (1, 90, 7200, -1, "invalid"):
                    with self.subTest(model=model.__name__, name=name, value=value):
                        request = model.model_validate(
                            {"expectedRevision": 0, "runId": str(uuid4()), name: value}
                        )
                        self.assertNotIn(name, request.model_dump(by_alias=True))
                        self.assertNotIn("time_limit_seconds", request.model_fields)
        self.assertEqual(EXECUTION_TIMEOUT_SECONDS, 3600)

    def test_create_edit_and_existing_simulations_ignore_saved_durations(self):
        legacy = {
            "kind": "yearly",
            "timeLimitSeconds": 1,
            "time_limit_seconds": 7200,
            "db2SwingPct": 20,
            "excludedAfgrodekoder": [11],
        }
        models = [
            OptimizationSettings.model_validate(legacy),
            CreateSimulationRequest(name="New", optimization_settings=legacy).optimization_settings,
            UpdateSimulationRequest(
                expected_revision=0, optimization_settings=legacy
            ).optimization_settings,
            Simulation(
                id="sim",
                farm_id="farm",
                name="Saved",
                created_at="2026-10-14",
                optimization_settings=legacy,
            ).optimization_settings,
        ]
        for settings in models:
            data = settings.model_dump(by_alias=True)
            self.assertNotIn("timeLimitSeconds", data)
            self.assertNotIn("time_limit_seconds", data)
            self.assertEqual(settings.kind, "yearly")
            self.assertEqual(settings.db2_swing_pct, 20)
            self.assertEqual(settings.excluded_afgrodekoder, [11])
