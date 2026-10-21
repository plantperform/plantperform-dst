import json
import os
import time
import unittest
from datetime import UTC, datetime, timedelta
from threading import Event, Timer
from unittest.mock import Mock, call, patch

from app.domain.optimization import (
    DeliveryOutcome,
    ExecutionResult,
    OptimizationLeaseActiveError,
    OptimizationTerminalError,
)
from plantperform_fargate import consumer

ENVELOPE = {
    "jobType": "optimization",
    "farmId": "farm",
    "simulationId": "sim",
    "runId": "run",
}
CLAIM = ("sim", "run", "token", 1)
FAILURE = {"code": "OUT_OF_MEMORY", "message": "memory"}


def successful_child(envelope, deadline, connection):
    connection.send(("claim", CLAIM))
    connection.send(("result", ExecutionResult(DeliveryOutcome.ACK, error={"pid": os.getpid()})))
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
                    "OPTIMIZER_DLQ_URL": "dlq",
                    "FARGATE_CLUSTER_NAME": "cluster",
                    "FARGATE_SERVICE_NAME": "service",
                },
            )
        )
        self.sqs, self.ecs, self.store, self.protection = Mock(), Mock(), Mock(), Mock()
        self.store.queued_publication_since.return_value = False
        self.store.delivery_result.return_value = None
        self.stop = Event()
        self.sqs.get_queue_attributes.return_value = {
            "Attributes": {
                "ApproximateNumberOfMessages": "0",
                "ApproximateNumberOfMessagesNotVisible": "0",
                "ApproximateNumberOfMessagesDelayed": "0",
            }
        }
        self.worker = consumer.Consumer(
            self.sqs,
            self.ecs,
            self.store,
            self.protection,
            self.stop,
        )

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
        self.sqs.receive_message.side_effect = [
            self.message("one"),
            self.message("two"),
            {},
        ]
        self.worker.execute = Mock(return_value=ExecutionResult(DeliveryOutcome.ACK))
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
        self.assertEqual(self.protection.set.call_args_list[-1], call(False))

    def test_submission_during_empty_poll_restores_one_and_processes_it(self):
        self.sqs.receive_message.side_effect = [{}, self.message(), {}]
        self.store.queued_publication_since.side_effect = [True, False]
        self.worker.execute = Mock(return_value=ExecutionResult(DeliveryOutcome.ACK))
        self.worker.run()
        self.assertEqual(
            [c.kwargs["desiredCount"] for c in self.ecs.update_service.call_args_list],
            [0, 1, 0],
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
            [c.kwargs["desiredCount"] for c in self.ecs.update_service.call_args_list],
            [0, 1],
        )
        self.assertEqual(self.sqs.receive_message.call_count, 1)

    def test_uncertain_stop_restores_service_and_does_not_exit(self):
        self.store.queued_publication_since.side_effect = RuntimeError("database unavailable")
        with self.assertLogs(consumer.logger, "ERROR"):
            self.assertFalse(self.worker.shutdown_if_idle(datetime.now(UTC)))
        self.assertEqual(
            [c.kwargs["desiredCount"] for c in self.ecs.update_service.call_args_list],
            [0, 1],
        )
        self.protection.set.assert_not_called()

    def test_failed_delivery_is_deferred_and_not_deleted(self):
        self.sqs.receive_message.side_effect = [self.message(), {}, self.message(), {}]
        self.worker.execute = Mock(
            side_effect=[
                ExecutionResult(DeliveryOutcome.RETRY, 61),
                ExecutionResult(DeliveryOutcome.ACK),
            ]
        )
        self.worker.run()
        self.sqs.delete_message.assert_called_once()
        self.assertEqual(self.sqs.receive_message.call_count, 4)
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
        self.sqs.send_message.assert_called_once()
        self.sqs.delete_message.assert_called_once()
        self.sqs.change_message_visibility.assert_not_called()

    def test_stop_during_job_never_acknowledges(self):
        self.sqs.receive_message.return_value = self.message()

        def interrupt(*_):
            self.stop.set()
            return ExecutionResult(DeliveryOutcome.ACK)

        self.worker.execute = interrupt
        self.worker.run()
        self.sqs.delete_message.assert_not_called()
        self.ecs.update_service.assert_not_called()

    def test_ack_failure_leaves_delivery_for_idempotent_redelivery(self):
        self.sqs.receive_message.side_effect = [self.message(), self.message(), {}]
        self.worker.execute = Mock(return_value=ExecutionResult(DeliveryOutcome.ACK))
        self.sqs.delete_message.side_effect = [RuntimeError("ack lost"), None]
        with patch.object(self.stop, "wait"), self.assertLogs(consumer.logger, "ERROR"):
            self.worker.run()
        self.sqs.change_message_visibility.assert_called_once()

    def test_each_execution_uses_a_fresh_spawned_process(self):
        with patch.object(consumer, "_child_execute", successful_child):
            first = self.worker.execute(ENVELOPE)
            second = self.worker.execute(ENVELOPE)
        self.assertEqual(first.outcome, "ack")
        self.assertEqual(second.outcome, "ack")
        self.assertNotEqual(first.error["pid"], second.error["pid"])
        self.assertNotEqual(first.error["pid"], os.getpid())

    def test_hard_timeout_stops_child_and_persists_using_its_lease(self):
        self.store.finish.return_value = True
        with (
            patch.object(consumer, "_child_execute", hanging_child),
            patch.object(consumer, "EXECUTION_TIMEOUT_SECONDS", 2),
        ):
            self.assertEqual(self.worker.execute(ENVELOPE).outcome, "dead_letter")
        self.store.finish.assert_called_once()
        self.assertEqual(self.store.finish.call_args.args, CLAIM)
        self.assertEqual(self.store.finish.call_args.kwargs["error"]["code"], "TIMEOUT")

    def test_timeout_persistence_failure_is_not_acknowledged(self):
        self.store.finish.side_effect = RuntimeError("database lost")
        with self.assertLogs(consumer.logger, "ERROR"):
            self.assertEqual(
                self.worker._timeout(CLAIM), ExecutionResult(DeliveryOutcome.RETRY, 60)
            )
        self.assertEqual(self.worker._timeout(None), ExecutionResult(DeliveryOutcome.RETRY, 60))

    def test_rejected_timeout_write_requires_delivery_state_confirmation(self):
        self.store.finish.return_value = False
        expires = datetime.now(UTC) + timedelta(minutes=30)
        self.store.check_delivery_state.side_effect = OptimizationLeaseActiveError(expires)
        with self.assertLogs(consumer.logger, "ERROR"):
            result = self.worker._timeout(CLAIM)
        self.assertEqual(result.outcome, "retry")
        self.assertGreater(result.retry_after, 1700)

    def test_crashed_child_fails_immediately_using_its_claim(self):
        with (
            patch.object(consumer, "_child_execute", crashed_child),
            self.assertLogs(level="ERROR"),
        ):
            result = self.worker.execute(ENVELOPE)
        self.assertEqual(result.outcome, "dead_letter")
        self.assertEqual(result.error["code"], "WORKER_CRASH")
        self.store.finish.assert_called_once()
        self.assertEqual(self.store.finish.call_args.args, CLAIM)
        self.assertEqual(self.store.finish.call_args.kwargs["error"]["code"], "WORKER_CRASH")
        self.assertTrue(self.store.finish.call_args.kwargs["stopped"])

    def test_oom_counter_increase_identifies_memory_exhaustion(self):
        with (
            patch.object(consumer, "_child_execute", crashed_child),
            patch.object(
                consumer,
                "memory_observation",
                side_effect=[
                    {"oom_kills": 2},
                    {"oom_kills": 3},
                ],
            ),
            self.assertLogs(level="ERROR"),
        ):
            result = self.worker.execute(ENVELOPE)
        self.assertEqual(result.outcome, "dead_letter")
        self.assertEqual(result.error["code"], "OUT_OF_MEMORY")
        self.assertEqual(self.store.finish.call_args.kwargs["error"]["code"], "OUT_OF_MEMORY")

    def test_forced_stop_kills_child_without_terminal_write(self):
        timer = Timer(1, self.stop.set)
        timer.start()
        try:
            with patch.object(consumer, "_child_execute", hanging_child):
                self.assertEqual(self.worker.execute(ENVELOPE).outcome, "interrupted")
        finally:
            timer.cancel()
        self.store.finish.assert_not_called()

    def test_consumer_client_allows_full_long_poll(self):
        with patch.object(consumer.boto3, "client") as client:
            consumer.consumer_sqs_client()
        self.assertGreater(client.call_args.kwargs["config"].read_timeout, 20)

    def failed_run(self):
        self.store.delivery_result.return_value = ExecutionResult(
            DeliveryOutcome.DEAD_LETTER, error=FAILURE
        )
        self.worker.process_context = Mock()

    def test_failed_or_ambiguous_send_retries_handoff_without_execution_or_loss(self):
        self.failed_run()
        self.sqs.send_message.side_effect = [ConnectionError("ack lost"), {}]
        self.sqs.receive_message.side_effect = [self.message(), {}, self.message(), {}]
        with patch.object(self.stop, "wait"), self.assertLogs(consumer.logger, "ERROR"):
            self.worker.run()
        self.assertEqual(self.sqs.send_message.call_count, 2)
        self.sqs.delete_message.assert_called_once()
        self.sqs.change_message_visibility.assert_called_once()
        self.worker.process_context.Process.assert_not_called()
        self.store.claim.assert_not_called()
        self.assertEqual(self.store.delivery_result.call_count, 2)
        self.assertEqual(
            self.sqs.send_message.call_args_list[0], self.sqs.send_message.call_args_list[1]
        )

    def test_ambiguous_send_may_duplicate_with_original_identity(self):
        self.failed_run()
        copies = []

        def send(**request):
            copies.append(request)
            if len(copies) == 1:
                raise ConnectionError("response lost after SQS accepted the copy")
            return {"MessageId": "dlq-copy"}

        self.sqs.send_message.side_effect = send
        self.sqs.receive_message.side_effect = [self.message(), self.message(), {}]
        with patch.object(self.stop, "wait"), self.assertLogs(consumer.logger, "ERROR"):
            self.worker.run()
        self.assertEqual(len(copies), 2)
        self.assertEqual(copies[0], copies[1])
        self.assertEqual(
            copies[0]["MessageAttributes"]["PlantPerformSourceMessageId"]["StringValue"], "run"
        )
        self.sqs.delete_message.assert_called_once()
        self.worker.process_context.Process.assert_not_called()

    def test_delete_failure_and_redelivery_may_duplicate_without_recomputing(self):
        self.failed_run()
        self.sqs.delete_message.side_effect = [ConnectionError("delete lost"), None]
        self.sqs.receive_message.side_effect = [self.message(), {}, self.message(), {}]
        with patch.object(self.stop, "wait"), self.assertLogs(consumer.logger, "ERROR"):
            self.worker.run()
        self.assertEqual(self.sqs.send_message.call_count, 2)
        self.assertEqual(self.sqs.delete_message.call_count, 2)
        self.worker.process_context.Process.assert_not_called()

    def test_replacement_after_failed_send_discards_old_request(self):
        self.failed_run()
        self.store.delivery_result.side_effect = [
            ExecutionResult(DeliveryOutcome.DEAD_LETTER, error=FAILURE),
            ExecutionResult(DeliveryOutcome.ACK),
        ]
        self.sqs.send_message.side_effect = ConnectionError("DLQ unavailable")
        self.sqs.receive_message.side_effect = [self.message(), self.message(), {}]
        with patch.object(self.stop, "wait"), self.assertLogs(consumer.logger, "ERROR"):
            self.worker.run()
        self.sqs.send_message.assert_called_once()
        self.sqs.delete_message.assert_called_once()
        self.worker.process_context.Process.assert_not_called()

    def test_completed_deleted_and_outdated_deliveries_skip_execution(self):
        self.store.delivery_result.return_value = ExecutionResult(DeliveryOutcome.ACK)
        self.worker.process_context = Mock()
        self.sqs.receive_message.side_effect = [self.message(), {}]
        self.worker.run()
        self.sqs.delete_message.assert_called_once()
        self.sqs.send_message.assert_not_called()
        self.worker.process_context.Process.assert_not_called()

    def test_dlq_preserves_body_and_binary_attributes_and_sends_before_deleting(self):
        self.failed_run()
        message = self.message()
        original = message["Messages"][0]
        original["MessageAttributes"] = {
            "binary": {"DataType": "Binary", "BinaryValue": b"\x00\xff"}
        }
        self.sqs.receive_message.side_effect = [message, {}]
        with self.assertLogs(consumer.logger, "ERROR"):
            self.worker.run()
        sent = self.sqs.send_message.call_args.kwargs
        self.assertEqual(sent["QueueUrl"], "dlq")
        self.assertEqual(sent["MessageBody"], original["Body"])
        self.assertEqual(
            sent["MessageAttributes"]["binary"], original["MessageAttributes"]["binary"]
        )
        self.assertEqual(len(original["MessageAttributes"]), 1)
        calls = [item[0] for item in self.sqs.method_calls]
        self.assertLess(calls.index("send_message"), calls.index("delete_message"))

    def test_dlq_preserves_all_ten_attributes(self):
        self.failed_run()
        message = self.message()
        original = message["Messages"][0]
        original["MessageAttributes"] = {
            str(index): {"DataType": "String", "StringValue": str(index)} for index in range(10)
        }
        self.sqs.receive_message.side_effect = [message, {}]
        with self.assertLogs(consumer.logger, "ERROR"):
            self.worker.run()
        self.assertEqual(
            self.sqs.send_message.call_args.kwargs["MessageAttributes"],
            original["MessageAttributes"],
        )

    def test_persisted_failure_is_used_if_child_died_after_saving_it(self):
        self.store.finish.return_value = False
        self.store.check_delivery_state.side_effect = OptimizationTerminalError(FAILURE)
        result = self.worker._failure(CLAIM, {"code": "WORKER_CRASH"})
        self.assertEqual(result, ExecutionResult(DeliveryOutcome.DEAD_LETTER, error=FAILURE))

    def test_failed_delivery_state_read_keeps_source_message(self):
        self.store.delivery_result.side_effect = ConnectionError("database unavailable")
        with self.assertLogs(consumer.logger, "ERROR"):
            self.assertEqual(
                self.worker.execute(ENVELOPE), ExecutionResult(DeliveryOutcome.RETRY, 60)
            )
        self.store.finish.assert_not_called()

    def test_previous_tasks_invisible_message_prevents_shutdown(self):
        self.sqs.receive_message.side_effect = [{}, {}]
        self.sqs.get_queue_attributes.side_effect = [
            {"Attributes": {"ApproximateNumberOfMessagesNotVisible": "1"}},
            {"Attributes": {"ApproximateNumberOfMessagesNotVisible": "0"}},
        ]
        self.worker.run()
        self.assertEqual(self.sqs.receive_message.call_count, 2)
        self.ecs.update_service.assert_called_once_with(
            cluster="cluster", service="service", desiredCount=0
        )

    def test_sigkill_without_oom_counter_is_reported_as_crash(self):
        from multiprocessing import get_context

        context = get_context("spawn")
        process = Mock(pid=1, exitcode=-9)
        process.is_alive.return_value = False
        parent, child = Mock(), Mock()
        parent.poll.return_value = True
        parent.recv.side_effect = [("claim", CLAIM), EOFError()]
        with (
            patch.object(context, "Process", return_value=process),
            patch.object(context, "Pipe", return_value=(parent, child)),
            patch.object(consumer, "memory_observation", return_value={"oom_kills": None}),
            self.assertLogs(consumer.logger, "ERROR"),
        ):
            self.worker.process_context = context
            self.assertEqual(self.worker.execute(ENVELOPE).outcome, "dead_letter")
        self.assertEqual(self.store.finish.call_args.kwargs["error"]["code"], "WORKER_CRASH")

    def test_protection_requires_confirmed_agent_response(self):
        response = Mock()
        response.read.return_value = b'{"protection":{"ProtectionEnabled":true}}'
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        with patch.object(consumer, "urlopen", return_value=response) as opening:
            consumer.TaskProtection("http://agent").set(True)
        body = json.loads(opening.call_args.args[0].data)
        self.assertEqual(body, {"ProtectionEnabled": True, "ExpiresInMinutes": 65})
