import json
import os
import subprocess
import sys
import textwrap
import unittest
from datetime import UTC, datetime, timedelta
from io import BytesIO
from unittest.mock import Mock, call, patch

from app.domain.creation import CreationActiveError
from app.domain.creation_job import CreationJob
from app.domain.optimization import OptimizationLeaseActiveError
from plantperform_optimizer import handler as worker


class HandlerTests(unittest.TestCase):
    def test_explicit_creation_and_optimization_route_independently_after_configuration(self):
        calls = []
        creation, optimization = Mock(), Mock()
        event = {
            "Records": [
                {
                    "messageId": "create",
                    "body": json.dumps(
                        {
                            "jobType": "create_simulation",
                            "simulationId": "new",
                            "jobId": "job",
                            "farmId": "farm",
                            "requestedBy": "member@example.com",
                            "expectedRevision": 0,
                            "parameters": {"name": "new", "optimizeOnCreate": True},
                        }
                    ),
                    "attributes": {"ApproximateReceiveCount": "2"},
                },
                {
                    "messageId": "optimize",
                    "body": json.dumps(
                        {
                            "jobType": "optimization",
                            "farmId": "farm",
                            "simulationId": "old",
                            "runId": "run",
                        }
                    ),
                },
            ]
        }

        def initialize_creation():
            self.assertEqual(calls[-1], "configured")
            calls.append("creation")
            return creation

        def initialize_optimization():
            self.assertEqual(calls[-1], "configured")
            calls.append("optimization")
            return optimization

        with (
            patch.object(
                worker, "initialize_configuration", side_effect=lambda: calls.append("configured")
            ),
            patch.object(worker, "initialize_creation", side_effect=initialize_creation),
            patch.object(worker, "initialize", side_effect=initialize_optimization),
        ):
            context = Mock()
            self.assertEqual(worker.handler(event, context), {"batchItemFailures": []})
        creation.execute.assert_called_once_with(
            CreationJob.model_validate_json(event["Records"][0]["body"]),
            context,
            sqs_delivery=True,
            receive_count=2,
        )
        optimization.execute.assert_called_once_with(
            "old", "run", context, sqs_delivery=True, farm_id="farm"
        )

    def test_invalid_envelopes_fail_without_loading_configuration_or_executors(self):
        valid = {"jobType": "optimization", "farmId": "farm", "simulationId": "sim", "runId": "run"}
        invalid = [
            [],
            None,
            {**valid, "jobType": "unknown"},
            {key: value for key, value in valid.items() if key != "jobType"},
        ]
        for kind, identifier in (("optimization", "runId"), ("create_simulation", "jobId")):
            envelope = {"jobType": kind, "farmId": "farm", "simulationId": "sim", identifier: "id"}
            for key in ("farmId", "simulationId", identifier):
                invalid.extend(
                    [
                        {k: v for k, v in envelope.items() if k != key},
                        {**envelope, key: " "},
                        {**envelope, key: 42},
                    ]
                )
        for envelope in invalid:
            with (
                self.subTest(envelope=envelope),
                patch.object(worker, "initialize_configuration") as configuration,
                patch.object(worker, "initialize_creation") as creation,
                patch.object(worker, "initialize") as optimization,
                patch.object(worker, "sqs_client", return_value=Mock()),
                patch.dict(os.environ, {"OPTIMIZER_QUEUE_URL": "queue"}),
                self.assertLogs(worker.logger, level="ERROR"),
            ):
                result = worker.handler(
                    {
                        "Records": [
                            {
                                "messageId": "invalid",
                                "receiptHandle": "receipt",
                                "body": json.dumps(envelope),
                            }
                        ]
                    },
                    Mock(),
                )
                self.assertEqual(result, {"batchItemFailures": [{"itemIdentifier": "invalid"}]})
                configuration.assert_not_called()
                creation.assert_not_called()
                optimization.assert_not_called()

    def test_invalid_creation_inputs_fail_before_initialization(self):
        valid = {
            "jobType": "create_simulation",
            "farmId": "farm",
            "simulationId": "sim",
            "jobId": "job",
            "requestedBy": "member@example.com",
            "expectedRevision": 0,
            "parameters": {"name": "new"},
        }
        invalid = [
            {k: v for k, v in valid.items() if k != key}
            for key in (
                "requestedBy",
                "expectedRevision",
                "parameters",
            )
        ]
        invalid.extend(
            [
                {**valid, "requestedBy": " "},
                {**valid, "expectedRevision": -1},
                {**valid, "expectedRevision": True},
                {**valid, "parameters": []},
                {**valid, "parameters": {}},
                {**valid, "parameters": {"name": ""}},
            ]
        )
        for envelope in invalid:
            with self.subTest(envelope=envelope), self.assertRaises(ValueError):
                worker.parse_envelope(json.dumps(envelope))

    def test_busy_creation_is_deferred_with_partial_batch_failure(self):
        envelope = {
            "jobType": "create_simulation",
            "farmId": "farm",
            "simulationId": "sim",
            "jobId": "job",
            "requestedBy": "member@example.com",
            "expectedRevision": 0,
            "parameters": {"name": "new"},
        }
        executor = Mock()
        executor.execute.side_effect = CreationActiveError("busy")
        queue = Mock()
        with (
            patch.object(worker, "initialize_configuration"),
            patch.object(worker, "initialize_creation", return_value=executor),
            patch.object(worker, "sqs_client", return_value=queue),
            patch.dict(os.environ, {"OPTIMIZER_QUEUE_URL": "queue"}),
        ):
            result = worker.handler(
                {
                    "Records": [
                        {
                            "messageId": "create",
                            "receiptHandle": "receipt",
                            "body": json.dumps(envelope),
                        }
                    ]
                },
                Mock(),
            )
        self.assertEqual(result, {"batchItemFailures": [{"itemIdentifier": "create"}]})
        queue.change_message_visibility.assert_called_once_with(
            QueueUrl="queue",
            ReceiptHandle="receipt",
            VisibilityTimeout=60,
        )

    def test_creation_bootstrap_needs_neither_solver_nor_api_dependencies(self):
        script = textwrap.dedent("""
            import importlib.abc
            import os
            import sys
            from io import BytesIO
            from unittest.mock import Mock, patch

            class BlockHeavyImports(importlib.abc.MetaPathFinder):
                def find_spec(self, fullname, path=None, target=None):
                    if fullname in {'plantperform_optimizer.worker'} or fullname.split('.')[0] in {
                        'ortools', 'fastapi', 'anyio',
                    }:
                        raise AssertionError('Creation imported: ' + fullname)

            sys.meta_path.insert(0, BlockHeavyImports())
            from plantperform_optimizer import handler
            os.environ.pop('DATABASE_URL', None)
            os.environ.pop('APP_ENV', None)
            client = Mock()
            client.get_object.return_value = {'Body': BytesIO(
                b'DATABASE_URL=postgresql+psycopg://test@localhost/test\\n'
            )}
            with (
                patch.object(handler.boto3, 'client', return_value=client),
                patch('dotenv.load_dotenv'),
            ):
                executor = handler.initialize_creation()
            assert callable(executor.execute)
            assert 'plantperform_optimizer.worker' not in sys.modules
            assert 'APP_ENV' not in os.environ
            assert os.environ['DB_POOL_SIZE'] == '2'
            client.get_object.assert_called_once_with(Bucket='config', Key='.env.test')
        """)
        result = subprocess.run(
            [sys.executable, "-c", script],
            env={**os.environ, "APP_CONFIG_BUCKET": "config", "APP_CONFIG_KEY": ".env.test"},
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_shared_worker_leaves_all_three_failures_for_sqs_redrive(self):
        from app.data import optimization_store
        from plantperform_optimizer import worker as executor

        event = {
            "Records": [
                {
                    "messageId": "job",
                    "body": (
                        '{"jobType":"optimization","farmId":"farm",'
                        '"simulationId":"sim","runId":"run"}'
                    ),
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
                    "body": (
                        '{"jobType":"optimization","farmId":"farm",'
                        '"simulationId":"sim","runId":"old"}'
                    ),
                    "receiptHandle": "receipt1",
                },
                {
                    "messageId": "retry",
                    "body": (
                        '{"jobType":"optimization","farmId":"farm",'
                        '"simulationId":"sim","runId":"new"}'
                    ),
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
                    "body": (
                        '{"jobType":"optimization","farmId":"farm",'
                        '"simulationId":"sim","runId":"run"}'
                    ),
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
        jobs.execute.assert_called_once_with(
            "sim", "run", unittest.mock.ANY, sqs_delivery=True, farm_id="farm"
        )

    def test_initialization_failure_retries_without_initializing_again(self):
        queue = Mock()
        event = {
            "Records": [
                {
                    "messageId": "cold",
                    "body": (
                        '{"jobType":"optimization","farmId":"farm",'
                        '"simulationId":"sim","runId":"run"}'
                    ),
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
                    "body": (
                        '{"jobType":"optimization","farmId":"farm",'
                        '"simulationId":"sim","runId":"run"}'
                    ),
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
                    "body": (
                        '{"jobType":"optimization","farmId":"farm",'
                        '"simulationId":"sim","runId":"run"}'
                    ),
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
