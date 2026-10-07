import os
import unittest
from datetime import UTC, datetime, timedelta
from io import BytesIO
from unittest.mock import Mock, call, patch

from app.domain.optimization import OptimizationLeaseActiveError
from plantperform_optimizer import handler as worker


class HandlerTests(unittest.TestCase):
    def test_shared_worker_leaves_all_three_failures_for_sqs_redrive(self):
        from app.data import optimization_store
        from plantperform_optimizer import worker as executor

        event = {
            "Records": [
                {
                    "messageId": "job",
                    "body": '{"simulationId":"sim","runId":"run"}',
                    "receiptHandle": "receipt",
                }
            ]
        }
        claims = [
            (
                {
                    "attempts": attempt,
                    "kind": "optimize",
                    "parameters": {
                        "expectedRevision": 0,
                        "runId": "00000000-0000-0000-0000-000000000001",
                    },
                    "requested_by": "member@example.com",
                    "input_revision": 0,
                },
                "farm",
                "lease",
            )
            for attempt in range(3)
        ]
        queue = Mock()
        with (
            patch.object(worker, "initialize", return_value=executor),
            patch.dict(os.environ, {"OPTIMIZER_QUEUE_URL": "queue"}),
            patch.object(optimization_store, "claim", side_effect=claims),
            patch.object(optimization_store, "load_snapshot", return_value=(None, [], {})),
            patch.object(
                executor, "run_optimization", side_effect=RuntimeError("temporary")
            ) as solve,
            patch.object(optimization_store, "finish", return_value=True) as finish,
            patch.object(worker, "sqs_client", return_value=queue),
            self.assertLogs(level="ERROR"),
        ):
            context = Mock(get_remaining_time_in_millis=Mock(return_value=900_000))
            outcomes = [worker.handler(event, context) for _ in range(3)]
        self.assertEqual(
            outcomes,
            [
                {"batchItemFailures": [{"itemIdentifier": "job"}]},
                {"batchItemFailures": [{"itemIdentifier": "job"}]},
                {"batchItemFailures": [{"itemIdentifier": "job"}]},
            ],
        )
        self.assertEqual(solve.call_count, 3)
        self.assertEqual(
            [args.kwargs["retry"] for args in finish.call_args_list],
            [True, True, False],
        )
        self.assertEqual(
            queue.change_message_visibility.call_args_list,
            [
                call(QueueUrl="queue", ReceiptHandle="receipt", VisibilityTimeout=60),
                call(QueueUrl="queue", ReceiptHandle="receipt", VisibilityTimeout=60),
                call(QueueUrl="queue", ReceiptHandle="receipt", VisibilityTimeout=60),
            ],
        )

    def test_partial_batch_failure_and_short_retry_visibility(self):
        jobs = Mock()
        jobs.execute.side_effect = [None, RuntimeError("temporary")]
        event = {
            "Records": [
                {
                    "messageId": "ok",
                    "body": '{"simulationId":"sim","runId":"old"}',
                    "receiptHandle": "receipt1",
                },
                {
                    "messageId": "retry",
                    "body": '{"simulationId":"sim","runId":"new"}',
                    "receiptHandle": "receipt2",
                },
            ]
        }
        with (
            patch.object(worker, "initialize", return_value=jobs),
            patch.object(worker, "sqs_client", return_value=Mock()) as client,
            patch.dict(os.environ, {"OPTIMIZER_QUEUE_URL": "queue"}),
            self.assertLogs(worker.logger, level="ERROR"),
        ):
            result = worker.handler(event, Mock())
        self.assertEqual(result, {"batchItemFailures": [{"itemIdentifier": "retry"}]})
        client.return_value.change_message_visibility.assert_called_once_with(
            QueueUrl="queue", ReceiptHandle="receipt2", VisibilityTimeout=60
        )

    def test_non_sqs_event_does_not_initialize(self):
        with patch.object(worker, "initialize") as initialize:
            self.assertEqual(
                worker.handler({"source": "aws.events"}, Mock()), {"batchItemFailures": []}
            )
        initialize.assert_not_called()

    def test_active_lease_defers_delivery_without_short_retry(self):
        now = datetime.now(UTC)
        jobs = Mock()
        jobs.execute.side_effect = OptimizationLeaseActiveError(now + timedelta(seconds=900))
        queue = Mock()
        event = {
            "Records": [
                {
                    "messageId": "active",
                    "body": '{"simulationId":"sim","runId":"run"}',
                    "receiptHandle": "receipt",
                }
            ]
        }
        with (
            patch.object(worker, "initialize", return_value=jobs),
            patch.object(worker, "sqs_client", return_value=queue),
            patch.object(worker, "datetime") as clock,
            patch.dict(os.environ, {"OPTIMIZER_QUEUE_URL": "queue"}),
        ):
            clock.now.return_value = now
            self.assertEqual(
                worker.handler(event, Mock()),
                {"batchItemFailures": [{"itemIdentifier": "active"}]},
            )
        queue.change_message_visibility.assert_called_once_with(
            QueueUrl="queue", ReceiptHandle="receipt", VisibilityTimeout=901
        )
        jobs.execute.assert_called_once_with("sim", "run", unittest.mock.ANY, sqs_delivery=True)

    def test_initialization_failure_retries_without_initializing_again(self):
        queue = Mock()
        event = {
            "Records": [
                {
                    "messageId": "cold",
                    "body": '{"simulationId":"sim","runId":"run"}',
                    "receiptHandle": "receipt",
                }
            ]
        }
        with (
            patch.object(
                worker, "initialize", side_effect=RuntimeError("bootstrap failed")
            ) as init,
            patch.object(worker, "sqs_client", return_value=queue),
            patch.dict(os.environ, {"OPTIMIZER_QUEUE_URL": "queue"}),
            self.assertLogs(worker.logger, level="ERROR"),
        ):
            self.assertEqual(
                worker.handler(event, Mock()),
                {"batchItemFailures": [{"itemIdentifier": "cold"}]},
            )
        init.assert_called_once()
        queue.change_message_visibility.assert_called_once_with(
            QueueUrl="queue", ReceiptHandle="receipt", VisibilityTimeout=60
        )

    def test_visibility_failure_still_returns_failed_message(self):
        jobs, queue = Mock(), Mock()
        jobs.execute.side_effect = RuntimeError("worker failed")
        queue.change_message_visibility.side_effect = RuntimeError("SQS unavailable")
        event = {
            "Records": [
                {
                    "messageId": "retry",
                    "body": '{"simulationId":"sim","runId":"run"}',
                    "receiptHandle": "receipt",
                }
            ]
        }
        with (
            patch.object(worker, "initialize", return_value=jobs),
            patch.object(worker, "sqs_client", return_value=queue),
            patch.dict(os.environ, {"OPTIMIZER_QUEUE_URL": "queue"}),
            self.assertLogs(worker.logger, level="ERROR"),
        ):
            self.assertEqual(
                worker.handler(event, Mock()),
                {"batchItemFailures": [{"itemIdentifier": "retry"}]},
            )

    def test_receipt_timing_is_logged_before_initialization_and_execution(self):
        event = {
            "Records": [
                {
                    "messageId": "message",
                    "body": '{"simulationId":"sim","runId":"run"}',
                    "attributes": {"SentTimestamp": "100000", "ApproximateReceiveCount": "1"},
                }
            ]
        }
        jobs = Mock()

        def initialize():
            jobs.execute.assert_not_called()
            self.assertIn("optimizer_received", logs.output[0])
            self.assertIn("delivery_seconds=2.5", logs.output[0])
            return jobs

        with (
            patch.object(worker, "initialize", side_effect=initialize),
            patch.object(worker.time, "time", return_value=102.5),
            self.assertLogs(worker.logger, level="INFO") as logs,
        ):
            self.assertEqual(worker.handler(event, Mock()), {"batchItemFailures": []})
        jobs.execute.assert_called_once()
        self.assertIn("optimizer_initialized run_id=run", logs.output[1])

    def test_database_bootstrap_reads_only_database_configuration(self):
        worker.initialize.cache_clear()
        self.addCleanup(worker.initialize.cache_clear)
        env = {"APP_CONFIG_BUCKET": "config", "APP_CONFIG_KEY": ".env.test"}
        client = Mock()
        client.get_object.return_value = {
            "Body": BytesIO(
                b"DATABASE_URL=postgresql+psycopg://test@localhost/test\nAUTH_SECRET=ignored\n"
            )
        }
        with (
            patch.dict(os.environ, env, clear=True),
            patch.object(worker.boto3, "client", return_value=client),
        ):
            worker.initialize()
            self.assertEqual(os.environ["DB_POOL_SIZE"], "2")
            self.assertEqual(os.environ["DB_MAX_OVERFLOW"], "0")
            self.assertNotIn("AUTH_SECRET", os.environ)
            worker.initialize()
            client.get_object.assert_called_once_with(Bucket="config", Key=".env.test")
