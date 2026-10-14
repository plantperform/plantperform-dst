import os
import unittest
from unittest.mock import Mock, patch

from app.services import fargate_control
from app.services.calculation import CalculationContext


class FargateControlTests(unittest.TestCase):
    def test_wakeup_updates_only_the_configured_service_to_one(self):
        client = Mock()
        with (
            patch.dict(
                os.environ, {"FARGATE_CLUSTER_NAME": "cluster", "FARGATE_SERVICE_NAME": "worker"}
            ),
            patch.object(fargate_control, "ecs_client", return_value=client),
        ):
            fargate_control.wake_worker()
        client.update_service.assert_called_once_with(
            cluster="cluster", service="worker", desiredCount=1
        )

    def test_wakeup_failure_does_not_reject_an_accepted_job(self):
        with (
            patch.dict(
                os.environ, {"FARGATE_CLUSTER_NAME": "cluster", "FARGATE_SERVICE_NAME": "worker"}
            ),
            patch.object(fargate_control, "ecs_client", side_effect=RuntimeError("unavailable")),
            self.assertLogs(fargate_control.logger, "ERROR"),
        ):
            fargate_control.wake_worker()

    def test_missing_configuration_does_not_attempt_an_aws_call(self):
        with (
            patch.dict(os.environ, {"FARGATE_CLUSTER_NAME": "", "FARGATE_SERVICE_NAME": ""}),
            patch.object(fargate_control, "ecs_client") as client,
            self.assertLogs(fargate_control.logger, "ERROR"),
        ):
            fargate_control.wake_worker()
        client.assert_not_called()

    def test_request_budget_is_45_seconds_and_uses_elapsed_time(self):
        with patch("app.services.calculation.time.monotonic", return_value=100) as clock:
            context = CalculationContext()
            self.assertEqual(context.get_remaining_time_in_millis(), 45000)
            clock.return_value = 108
            self.assertEqual(context.get_remaining_time_in_millis(), 37000)
            clock.return_value = 146
            self.assertEqual(context.get_remaining_time_in_millis(), 0)
