import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.domain.read_model import preparation_job
from plantperform_optimizer import handler


class PreparationHandlerTests(unittest.TestCase):
    def test_history_and_view_jobs_use_preparation_worker_not_solver(self):
        for kind in ("prepare_farm_history", "prepare_simulation_view"):
            job = preparation_job(kind, "farm", 2, "sim" if kind.endswith("view") else None)
            executor = SimpleNamespace(execute=Mock())
            record = {
                "body": job.model_dump_json(by_alias=True),
                "messageId": "message",
                "attributes": {"ApproximateReceiveCount": "2"},
            }
            with (
                patch.object(handler, "initialize_configuration"),
                patch.object(handler, "initialize_preparation", return_value=executor),
                patch.object(handler, "initialize", side_effect=AssertionError),
            ):
                self.assertEqual(
                    handler.handler({"Records": [record]}, "context"), {"batchItemFailures": []}
                )
            executor.execute.assert_called_once_with(
                job, "context", sqs_delivery=True, receive_count=2
            )

    def test_bad_identity_and_missing_revision_fail_before_initialization(self):
        job = preparation_job("prepare_farm_history", "farm", 2)
        for patch_value in (
            {"jobId": "wrong"},
            {"expectedRevision": -1},
            {"simulationId": "other"},
        ):
            envelope = {**job.model_dump(mode="json", by_alias=True), **patch_value}
            with self.assertRaises(ValueError):
                handler.parse_envelope(json.dumps(envelope))
