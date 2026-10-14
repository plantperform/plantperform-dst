import json
import os
import time
import unittest
from datetime import UTC, datetime, timedelta
from threading import Event, Timer
from unittest.mock import Mock, call, patch

from app.domain.optimization import OptimizationLeaseActiveError
from plantperform_fargate import consumer

ENVELOPE = {"jobType": "optimization", "farmId": "farm", "simulationId": "sim", "runId": "run"}
CLAIM = ("sim", "run", "token", 1)


def successful_child(envelope, deadline, connection):
    connection.send(("claim", CLAIM))
    connection.send(("ack", os.getpid()))
    connection.close()


def hanging_child(envelope, deadline, connection):
    connection.send(("claim", CLAIM))
    time.sleep(30)


def crashed_child(envelope, deadline, connection):
    connection.send(("claim", CLAIM))
    os._exit(1)


class ConsumerTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(
            patch.dict(
                os.environ,
                {
                    "OPTIMIZER_QUEUE_URL": "queue",
                    "FARGATE_CLUSTER_NAME": "cluster",
                    "FARGATE_SERVICE_NAME": "service",
                },
            )
        )
        self.sqs, self.ecs, self.store, self.protection = Mock(), Mock(), Mock(), Mock()
        self.store.queued_publication_since.return_value = False
        self.stop = Event()
        self.worker = consumer.Consumer(self.sqs, self.ecs, self.store, self.protection, self.stop)

    def message(self, run_id="run"):
        return {
            "Messages": [
                {
                    "MessageId": run_id,
                    "ReceiptHandle": run_id,
                    "Body": json.dumps({**ENVELOPE, "runId": run_id}),
                }
            ]
        }

    def test_two_jobs_then_exactly_one_empty_long_poll_stop_service_and_exit(self):
        self.sqs.receive_message.side_effect = [self.message("one"), self.message("two"), {}]
        self.worker.execute = Mock(return_value=("ack", None))
        self.worker.run()
        self.assertEqual(self.sqs.receive_message.call_count, 3)
        for request in self.sqs.receive_message.call_args_list:
            self.assertEqual(request.kwargs["WaitTimeSeconds"], 20)
            self.assertEqual(request.kwargs["MaxNumberOfMessages"], 1)
            self.assertEqual(request.kwargs["VisibilityTimeout"], 3900)
        self.assertEqual(self.sqs.delete_message.call_count, 2)
        self.ecs.update_service.assert_called_once_with(
            cluster="cluster", service="service", desiredCount=0
        )
        self.assertEqual(
            self.protection.set.call_args_list, [call(True), call(True), call(True), call(False)]
        )

    def test_submission_during_empty_poll_restores_one_and_processes_it(self):
        self.sqs.receive_message.side_effect = [{}, self.message(), {}]
        self.store.queued_publication_since.side_effect = [True, False]
        self.worker.execute = Mock(return_value=("ack", None))
        self.worker.run()
        self.assertEqual(
            [c.kwargs["desiredCount"] for c in self.ecs.update_service.call_args_list], [0, 1, 0]
        )
        self.sqs.delete_message.assert_called_once()
        self.store.queued_publication_since.assert_any_call(
            self.store.publication_clock.return_value
        )

    def test_submission_after_shutdown_check_is_handled_by_the_backend_wakeup(self):
        def late_wakeup(enabled):
            if not enabled:
                self.ecs.update_service(cluster="cluster", service="service", desiredCount=1)

        self.protection.set.side_effect = late_wakeup
        self.sqs.receive_message.return_value = {}
        self.worker.run()
        self.assertEqual(
            [c.kwargs["desiredCount"] for c in self.ecs.update_service.call_args_list], [0, 1]
        )
        self.assertEqual(self.sqs.receive_message.call_count, 1)

    def test_uncertain_stop_restores_service_and_does_not_exit(self):
        self.store.queued_publication_since.side_effect = RuntimeError("database unavailable")
        with self.assertLogs(consumer.logger, "ERROR"):
            self.assertFalse(self.worker.shutdown_if_idle(datetime.now(UTC)))
        self.assertEqual(
            [c.kwargs["desiredCount"] for c in self.ecs.update_service.call_args_list], [0, 1]
        )
        self.protection.set.assert_not_called()

    def test_failed_delivery_is_deferred_and_not_deleted(self):
        self.sqs.receive_message.side_effect = [self.message(), {}]
        self.worker.execute = Mock(return_value=("retry", 61))
        self.worker.run()
        self.sqs.delete_message.assert_not_called()
        self.sqs.change_message_visibility.assert_called_once_with(
            QueueUrl="queue", ReceiptHandle="run", VisibilityTimeout=61
        )

    def test_malformed_and_legacy_jobs_are_not_executed_or_acknowledged(self):
        for envelope in (
            [1],
            {},
            {**ENVELOPE, "jobType": "create_simulation"},
            {**ENVELOPE, "runId": " "},
        ):
            with self.subTest(envelope=envelope), self.assertRaises(ValueError):
                consumer.parse_envelope(json.dumps(envelope))
        message = self.message()
        message["Messages"][0]["Body"] = "bad json"
        self.sqs.receive_message.side_effect = [message, {}]
        self.worker.execute = Mock()
        with self.assertLogs(consumer.logger, "ERROR"):
            self.worker.run()
        self.worker.execute.assert_not_called()
        self.sqs.delete_message.assert_not_called()
        self.sqs.change_message_visibility.assert_called_once()

    def test_stop_during_job_never_acknowledges(self):
        self.sqs.receive_message.return_value = self.message()

        def interrupt(_):
            self.stop.set()
            return "ack", None

        self.worker.execute = interrupt
        self.worker.run()
        self.sqs.delete_message.assert_not_called()
        self.ecs.update_service.assert_not_called()

    def test_ack_failure_leaves_delivery_for_idempotent_redelivery(self):
        self.sqs.receive_message.side_effect = [self.message(), {}]
        self.worker.execute = Mock(return_value=("ack", None))
        self.sqs.delete_message.side_effect = RuntimeError("ack lost")
        with patch.object(self.stop, "wait"), self.assertLogs(consumer.logger, "ERROR"):
            self.worker.run()
        self.sqs.change_message_visibility.assert_not_called()

    def test_each_execution_uses_a_fresh_spawned_process(self):
        with patch.object(consumer, "_child_execute", successful_child):
            first = self.worker.execute(ENVELOPE)
            second = self.worker.execute(ENVELOPE)
        self.assertEqual(first[0], "ack")
        self.assertEqual(second[0], "ack")
        self.assertNotEqual(first[1], second[1])
        self.assertNotEqual(first[1], os.getpid())

    def test_hard_timeout_stops_child_and_persists_using_its_lease(self):
        self.store.finish.return_value = True
        with (
            patch.object(consumer, "_child_execute", hanging_child),
            patch.object(consumer, "EXECUTION_TIMEOUT_SECONDS", 2),
        ):
            self.assertEqual(self.worker.execute(ENVELOPE), ("ack", None))
        self.store.finish.assert_called_once()
        self.assertEqual(self.store.finish.call_args.args, CLAIM)
        self.assertEqual(self.store.finish.call_args.kwargs["error"]["code"], "TIMEOUT")

    def test_timeout_persistence_failure_is_not_acknowledged(self):
        self.store.finish.side_effect = RuntimeError("database lost")
        with self.assertLogs(consumer.logger, "ERROR"):
            self.assertEqual(self.worker._timeout(CLAIM), ("retry", 60))
        self.assertEqual(self.worker._timeout(None), ("retry", 60))

    def test_rejected_timeout_write_requires_delivery_state_confirmation(self):
        self.store.finish.return_value = False
        expires = datetime.now(UTC) + timedelta(minutes=30)
        self.store.check_delivery_state.side_effect = OptimizationLeaseActiveError(expires)
        with self.assertLogs(consumer.logger, "ERROR"):
            result, delay = self.worker._timeout(CLAIM)
        self.assertEqual(result, "retry")
        self.assertGreater(delay, 1700)

    def test_crashed_child_defers_until_its_active_lease_expires(self):
        self.store.check_delivery_state.side_effect = OptimizationLeaseActiveError(
            datetime.now(UTC) + timedelta(minutes=30)
        )
        with patch.object(consumer, "_child_execute", crashed_child):
            result, delay = self.worker.execute(ENVELOPE)
        self.assertEqual(result, "retry")
        self.assertGreater(delay, 1700)
        self.store.finish.assert_not_called()

    def test_forced_stop_kills_child_without_terminal_write(self):
        timer = Timer(1, self.stop.set)
        timer.start()
        try:
            with patch.object(consumer, "_child_execute", hanging_child):
                self.assertEqual(self.worker.execute(ENVELOPE), ("interrupted", None))
        finally:
            timer.cancel()
        self.store.finish.assert_not_called()

    def test_consumer_client_allows_full_long_poll(self):
        with patch.object(consumer.boto3, "client") as client:
            consumer.consumer_sqs_client()
        self.assertGreater(client.call_args.kwargs["config"].read_timeout, 20)

    def test_protection_requires_confirmed_agent_response(self):
        response = Mock()
        response.read.return_value = b'{"protection":{"ProtectionEnabled":true}}'
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        with patch.object(consumer, "urlopen", return_value=response) as opening:
            consumer.TaskProtection("http://agent").set(True)
        body = json.loads(opening.call_args.args[0].data)
        self.assertEqual(body, {"ProtectionEnabled": True, "ExpiresInMinutes": 65})
