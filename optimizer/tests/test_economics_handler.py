"""Economics jobs reuse queue dispatch without invoking the optimizer."""

import json
import unittest
from unittest.mock import patch

from app.domain.economics import EconomicsRecalculationJob, EconomicsSnapshot, recalculation_job_id
from plantperform_optimizer import economics_worker, handler


class EconomicsHandlerTests(unittest.TestCase):
    def job(self):
        return EconomicsRecalculationJob(
            farm_id="farm",
            simulation_id="sim",
            job_id=recalculation_job_id("sim", 1),
            requested_by="member@example.com",
            expected_revision=1,
            snapshot=EconomicsSnapshot(),
        )

    def test_dispatch_uses_economics_executor(self):
        job = self.job()
        record = dict(
            body=json.dumps(job.envelope()),
            messageId="message",
            attributes={"ApproximateReceiveCount": "2"},
        )
        with (
            patch.object(handler, "initialize_configuration"),
            patch.object(handler, "initialize", side_effect=AssertionError),
            patch.object(economics_worker, "execute") as execute,
        ):
            self.assertEqual(
                handler.handler({"Records": [record]}, "context"), {"batchItemFailures": []}
            )
        execute.assert_called_once_with(job, "context", sqs_delivery=True, receive_count=2)

    def test_invalid_revision_or_overrides_rejected_before_dispatch(self):
        for invalid in (
            {"expectedRevision": True},
            {"expectedRevision": -1},
            {"snapshot": {"overrides": {"prices": {"any": -1}}}},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                handler.parse_envelope(json.dumps({**self.job().envelope(), **invalid}))
