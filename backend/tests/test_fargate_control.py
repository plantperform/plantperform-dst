import os
import unittest
from unittest.mock import patch

from app.services import fargate_control
from app.services.calculation import CalculationContext


class FargateControlTests(unittest.TestCase):
    def test_missing_configuration_does_not_attempt_an_aws_call(self):
        with (
            patch.dict(os.environ, {"FARGATE_CLUSTER_NAME": "", "FARGATE_SERVICE_NAME": ""}),
            patch.object(fargate_control, "ecs_client") as client,
            patch.object(fargate_control, "SessionLocal"),
            self.assertLogs(fargate_control.logger, "ERROR"),
        ):
            fargate_control.record_publication("sim", "run")
        client.assert_not_called()

    def test_request_budget_is_45_seconds_and_uses_elapsed_time(self):
        with patch("app.services.calculation.time.monotonic", return_value=100) as clock:
            context = CalculationContext()
            self.assertEqual(context.get_remaining_time_in_millis(), 45000)
            clock.return_value = 108
            self.assertEqual(context.get_remaining_time_in_millis(), 37000)
            clock.return_value = 146
            self.assertEqual(context.get_remaining_time_in_millis(), 0)
