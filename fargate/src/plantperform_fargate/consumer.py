"""One-message SQS consumer with bounded child execution and coordinated shutdown."""

import json
import logging
import math
import multiprocessing
import os
import time
from copy import deepcopy
from datetime import UTC, datetime
from urllib.request import Request, urlopen

import boto3
from botocore.config import Config

from app.domain.optimization import (
    EXECUTION_TIMEOUT_SECONDS,
    RETRY_DELAY_SECONDS,
    DeliveryOutcome,
    ExecutionResult,
    OptimizationLeaseActiveError,
    OptimizationTerminalError,
)
from app.services.fargate_control import set_worker_count
from app.services.optimization.failures import is_transient
from plantperform_fargate.configuration import initialize_configuration
from plantperform_fargate.memory import memory_observation

logger = logging.getLogger(__name__)
VISIBILITY_SECONDS = 3900


def parse_envelope(body):
    envelope = json.loads(body)
    if not isinstance(envelope, dict) or envelope.get("jobType") != "optimization":
        raise ValueError("The Fargate queue accepts optimization jobs only")
    for key in ("farmId", "simulationId", "runId"):
        if not isinstance(envelope.get(key), str) or not envelope[key].strip():
            raise ValueError(f"Missing or invalid {key}")
    return envelope


def retry_seconds(error):
    if isinstance(error, OptimizationLeaseActiveError):
        return max(
            RETRY_DELAY_SECONDS,
            math.ceil((error.expires_at - datetime.now(UTC)).total_seconds()) + 1,
        )
    return RETRY_DELAY_SECONDS


class ExecutionContext:
    def __init__(self, deadline):
        self.deadline = deadline

    def get_remaining_time_in_millis(self):
        return max(0, int((self.deadline - time.monotonic()) * 1000))


def _child_execute(envelope, deadline, connection):
    logging.basicConfig(level=logging.INFO)
    claim = None

    def on_claim(*value):
        nonlocal claim
        claim = value
        connection.send(("claim", claim))

    try:
        initialize_configuration()
        from plantperform_fargate.worker import execute

        result = execute(
            envelope["simulationId"],
            envelope["runId"],
            ExecutionContext(deadline),
            sqs_delivery=True,
            farm_id=envelope["farmId"],
            on_claim=on_claim,
        )
        connection.send(("result", result))
    except Exception as error:
        logger.exception("fargate_job_failed run_id=%s", envelope["runId"])
        if is_transient(error):
            connection.send(
                ("result", ExecutionResult(DeliveryOutcome.RETRY, retry_seconds(error)))
            )
            return
        failure = (
            error.error
            if isinstance(error, OptimizationTerminalError)
            else {
                "code": "OUT_OF_MEMORY" if isinstance(error, MemoryError) else "WORKER_ERROR",
                "message": "Optimeringen løb tør for hukommelse."
                if isinstance(error, MemoryError)
                else "Optimeringen kunne ikke fuldføres.",
            }
        )
        try:
            from app.data import optimization_store

            if isinstance(error, OptimizationTerminalError):
                pass  # The terminal failure is already persisted.
            elif claim is not None:
                if not optimization_store.finish(*claim, error=failure):
                    optimization_store.check_delivery_state(claim[0], claim[1])
                    connection.send(("result", ExecutionResult(DeliveryOutcome.ACK)))
                    return
            else:
                failure = optimization_store.fail_unclaimed(
                    envelope["simulationId"],
                    envelope["runId"],
                    envelope["farmId"],
                    failure,
                )
                if failure is None:
                    connection.send(("result", ExecutionResult(DeliveryOutcome.ACK)))
                    return
            connection.send(("result", ExecutionResult(DeliveryOutcome.DEAD_LETTER, error=failure)))
        except OptimizationTerminalError as terminal:
            connection.send(
                ("result", ExecutionResult(DeliveryOutcome.DEAD_LETTER, error=terminal.error))
            )
        except Exception as persistence_error:
            logger.exception("fargate_job_failed failure_persistence run_id=%s", envelope["runId"])
            connection.send(
                ("result", ExecutionResult(DeliveryOutcome.RETRY, retry_seconds(persistence_error)))
            )
    finally:
        connection.close()


class TaskProtection:
    def __init__(self, agent_uri=None):
        self.url = (agent_uri or os.environ["ECS_AGENT_URI"]) + "/task-protection/v1/state"

    def set(self, enabled):
        payload = {"ProtectionEnabled": enabled}
        if enabled:
            payload["ExpiresInMinutes"] = 65
        request = Request(
            self.url,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="PUT",
        )
        with urlopen(request, timeout=5) as response:
            result = json.load(response)
        if result.get("protection", {}).get("ProtectionEnabled") is not enabled:
            raise RuntimeError(f"Task protection update failed: {result}")


class Consumer:
    def __init__(self, sqs, ecs, store, protection, stop, *, process_context=None):
        self.sqs, self.ecs, self.store = sqs, ecs, store
        self.protection, self.stop = protection, stop
        self.queue_url = os.environ["OPTIMIZER_QUEUE_URL"]
        self.dlq_url = os.environ["OPTIMIZER_DLQ_URL"]
        self.outstanding = {}
        self.process_context = process_context or multiprocessing.get_context("spawn")

    def _terminate(self, process):
        if process.is_alive():
            process.terminate()
            process.join(5)
        if process.is_alive():
            process.kill()
            process.join(5)
        if process.is_alive():
            raise RuntimeError("Optimization child could not be stopped")

    def _failure(self, claim, failure, envelope=None):
        try:
            if claim is not None:
                if not self.store.finish(*claim, error=failure, stopped=True):
                    self.store.check_delivery_state(claim[0], claim[1])
                    return ExecutionResult(DeliveryOutcome.ACK)
            elif envelope is not None:
                failure = self.store.fail_unclaimed(
                    envelope["simulationId"],
                    envelope["runId"],
                    envelope["farmId"],
                    failure,
                )
                if failure is None:
                    return ExecutionResult(DeliveryOutcome.ACK)
            else:
                return ExecutionResult(DeliveryOutcome.RETRY, RETRY_DELAY_SECONDS)
            return ExecutionResult(DeliveryOutcome.DEAD_LETTER, error=failure)
        except OptimizationTerminalError as error:
            return ExecutionResult(DeliveryOutcome.DEAD_LETTER, error=error.error)
        except Exception as error:
            logger.exception("fargate_job_failed failure_persistence claim=%s", claim)
            return ExecutionResult(DeliveryOutcome.RETRY, retry_seconds(error))

    def _timeout(self, claim, envelope=None):
        return self._failure(
            claim,
            {"code": "TIMEOUT", "message": "Optimeringen overskred tidsgrænsen."},
            envelope,
        )

    def execute(self, envelope):
        try:
            result = self.store.delivery_result(
                envelope["simulationId"], envelope["runId"], envelope["farmId"]
            )
            if result is not None:
                return result
        except Exception as error:
            logger.exception("fargate_job_failed delivery_state run_id=%s", envelope["runId"])
            return ExecutionResult(DeliveryOutcome.RETRY, retry_seconds(error))
        parent, child = self.process_context.Pipe(duplex=False)
        deadline = time.monotonic() + EXECUTION_TIMEOUT_SECONDS
        process = self.process_context.Process(
            target=_child_execute, args=(envelope, deadline, child)
        )
        claim = None
        outcome = None
        before_memory = memory_observation()
        try:
            process.start()
            child.close()
            while outcome is None:
                if self.stop.is_set():
                    self._terminate(process)
                    return ExecutionResult(DeliveryOutcome.INTERRUPTED)
                if time.monotonic() >= deadline:
                    self._terminate(process)
                    return self._timeout(claim, envelope)
                if parent.poll(0.2):
                    try:
                        kind, value = parent.recv()
                    except EOFError:
                        break
                    if kind == "claim":
                        claim = value
                    else:
                        outcome = value
                elif not process.is_alive():
                    break
            process.join(5)
            self._terminate(process)
            if self.stop.is_set():
                return ExecutionResult(DeliveryOutcome.INTERRUPTED)
            if outcome is not None:
                return outcome
            after_memory = memory_observation()
            before_kills, after_kills = before_memory["oom_kills"], after_memory["oom_kills"]
            oom = (
                before_kills is not None and after_kills is not None and after_kills > before_kills
            )
            logger.error(
                "fargate_job_failed run_id=%s child_exitcode=%s claim=%s memory_before=%s "
                "memory_after=%s failure=%s",
                envelope["runId"],
                process.exitcode,
                claim,
                before_memory,
                after_memory,
                "OUT_OF_MEMORY" if oom else "WORKER_CRASH",
            )
            return self._failure(
                claim,
                {
                    "code": "OUT_OF_MEMORY" if oom else "WORKER_CRASH",
                    "message": "Optimeringen løb tør for hukommelse."
                    if oom
                    else "Optimeringens beregningsproces stoppede uventet.",
                    "detail": {"exitCode": process.exitcode, "memory": after_memory},
                },
                envelope,
            )
        finally:
            child.close()
            parent.close()
            if process.pid is not None:
                self._terminate(process)
                process.close()

    def shutdown_if_idle(self, since):
        # Remain protected while lowering desiredCount and checking publications.
        try:
            set_worker_count(self.ecs, 0)
            if self.store.queued_publication_since(since):
                set_worker_count(self.ecs, 1)
                return False
            self.protection.set(False)
            logger.info("fargate_idle_shutdown")
            return True
        except Exception:
            logger.exception("fargate_shutdown_verification_failed")
            # An uncertain stop must not override a producer's wakeup.
            set_worker_count(self.ecs, 1)
            return False

    def publish_dead_letter(self, record, failure, envelope=None):
        attributes = deepcopy(record.get("MessageAttributes", {}))
        for key, value in (
            ("PlantPerformSourceMessageId", record["MessageId"]),
            ("PlantPerformFailureCode", failure["code"]),
        ):
            if len(attributes) < 10 and key not in attributes:
                attributes[key] = {"DataType": "String", "StringValue": value}
        try:
            self.sqs.send_message(
                QueueUrl=self.dlq_url, MessageBody=record["Body"], MessageAttributes=attributes
            )
        except Exception:
            logger.exception(
                "fargate_job_failed dead_letter_send message_id=%s run_id=%s code=%s",
                record["MessageId"],
                (envelope or {}).get("runId"),
                failure["code"],
            )
            raise
        logger.error(
            "fargate_job_failed dead_letter_published message_id=%s run_id=%s code=%s",
            record["MessageId"],
            (envelope or {}).get("runId"),
            failure["code"],
        )

    def _queue_busy(self):
        attributes = self.sqs.get_queue_attributes(
            QueueUrl=self.queue_url,
            AttributeNames=[
                "ApproximateNumberOfMessages",
                "ApproximateNumberOfMessagesNotVisible",
                "ApproximateNumberOfMessagesDelayed",
            ],
        )["Attributes"]
        return any(int(value) for value in attributes.values())

    def run(self):
        self.protection.set(True)
        while not self.stop.is_set():
            record = None
            try:
                self.protection.set(True)
                since = self.store.publication_clock()
                response = self.sqs.receive_message(
                    QueueUrl=self.queue_url,
                    MaxNumberOfMessages=1,
                    WaitTimeSeconds=20,
                    VisibilityTimeout=VISIBILITY_SECONDS,
                    MessageSystemAttributeNames=["All"],
                    MessageAttributeNames=["All"],
                )
                if self.stop.is_set():
                    break
                messages = response.get("Messages", [])
                if not messages:
                    busy = self._queue_busy()
                    self.outstanding = {
                        key: until
                        for key, until in self.outstanding.items()
                        if time.monotonic() < until
                    }
                    if busy or self.outstanding:
                        self.protection.set(True)
                        continue
                    if self.shutdown_if_idle(since):
                        return
                    continue
                record = messages[0]
                message_id = record["MessageId"]
                self.outstanding[message_id] = time.monotonic() + VISIBILITY_SECONDS + 40
                envelope = None
                try:
                    envelope = parse_envelope(record["Body"])
                except ValueError:
                    logger.exception("fargate_message_failed message_id=%s", message_id)
                    result = ExecutionResult(
                        DeliveryOutcome.DEAD_LETTER,
                        error={
                            "code": "INVALID_MESSAGE",
                            "message": "Invalid optimization envelope",
                        },
                    )
                else:
                    self.protection.set(True)
                    logger.info(
                        "fargate_received run_id=%s message_id=%s receive_count=%s",
                        envelope["runId"],
                        message_id,
                        record.get("Attributes", {}).get("ApproximateReceiveCount"),
                    )
                    result = self.execute(envelope)
                if self.stop.is_set() or result.outcome == DeliveryOutcome.INTERRUPTED:
                    break
                if result.outcome == DeliveryOutcome.DEAD_LETTER:
                    self.publish_dead_letter(record, result.error, envelope)
                if self.stop.is_set():
                    break
                if result.outcome in (DeliveryOutcome.ACK, DeliveryOutcome.DEAD_LETTER):
                    self.sqs.delete_message(
                        QueueUrl=self.queue_url, ReceiptHandle=record["ReceiptHandle"]
                    )
                    self.outstanding.pop(message_id, None)
                else:
                    logger.warning(
                        "fargate_job_failed retry_scheduled message_id=%s delay_seconds=%s",
                        message_id,
                        result.retry_after or RETRY_DELAY_SECONDS,
                    )
                    self.sqs.change_message_visibility(
                        QueueUrl=self.queue_url,
                        ReceiptHandle=record["ReceiptHandle"],
                        VisibilityTimeout=min(43200, result.retry_after or RETRY_DELAY_SECONDS),
                    )
                    self.outstanding[message_id] = (
                        time.monotonic()
                        + min(43200, result.retry_after or RETRY_DELAY_SECONDS)
                        + 40
                    )
            except Exception:
                logger.exception("fargate_consumer_failed")
                if record is not None:
                    try:
                        self.sqs.change_message_visibility(
                            QueueUrl=self.queue_url,
                            ReceiptHandle=record["ReceiptHandle"],
                            VisibilityTimeout=RETRY_DELAY_SECONDS,
                        )
                        self.outstanding[record["MessageId"]] = (
                            time.monotonic() + RETRY_DELAY_SECONDS + 40
                        )
                    except Exception:
                        logger.exception("fargate_message_failed visibility_update")
                self.stop.wait(5)
        self.protection.set(False)


def consumer_sqs_client():
    return boto3.client(
        "sqs",
        endpoint_url=os.getenv("OPTIMIZER_SQS_ENDPOINT_URL"),
        config=Config(connect_timeout=3, read_timeout=30, retries={"total_max_attempts": 2}),
    )
