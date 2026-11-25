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
from app.services.optimization.failures import is_transient
from optimizer.configuration import initialize_configuration
from optimizer.memory import (
    allocation_failed,
    limit_address_space,
    memory_observation,
    memory_pressure,
)

logger = logging.getLogger(__name__)
VISIBILITY_SECONDS = EXECUTION_TIMEOUT_SECONDS + 5 * 60


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


def _child_execute(envelope, deadline, connection, claimed, memory_limit):
    try:
        limit_address_space(memory_limit)
        logging.basicConfig(level=logging.INFO)
        initialize_configuration()
        from optimizer.worker import execute

        result = execute(
            envelope["simulationId"],
            envelope["runId"],
            ExecutionContext(deadline),
            sqs_delivery=True,
            claimed=claimed,
            memory_limit=memory_limit,
        )
        connection.send(("result", result))
    except Exception as error:
        if allocation_failed(error):
            connection.send(
                (
                    "failure",
                    {"code": "OUT_OF_MEMORY", "message": "Optimeringen løb tør for hukommelse."},
                )
            )
        elif isinstance(error, OptimizationTerminalError):
            connection.send(
                ("result", ExecutionResult(DeliveryOutcome.DEAD_LETTER, error=error.error))
            )
        elif is_transient(error):
            connection.send(
                ("result", ExecutionResult(DeliveryOutcome.RETRY, retry_seconds(error)))
            )
        else:
            logger.exception("fargate_job_failed run_id=%s", envelope["runId"])
            connection.send(
                (
                    "failure",
                    {"code": "WORKER_ERROR", "message": "Optimeringen kunne ikke fuldføres."},
                )
            )
    finally:
        connection.close()


class TaskProtection:
    def __init__(self, agent_uri=None):
        self.url = (agent_uri or os.environ["ECS_AGENT_URI"]) + "/task-protection/v1/state"
        self.protected_until = 0

    def protect_for(self, seconds):
        if time.monotonic() + seconds >= self.protected_until:
            self.set(True)

    def set(self, enabled):
        self.protected_until = 0
        started = time.monotonic()
        payload = {"ProtectionEnabled": enabled}
        if enabled:
            payload["ExpiresInMinutes"] = VISIBILITY_SECONDS // 60
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
        if enabled:
            self.protected_until = started + 60 * payload["ExpiresInMinutes"]


class Consumer:
    @classmethod
    def from_environment(cls, stop):
        initialize_configuration()
        # Both imports create or reuse the database engine bound to the configured URL.
        from app.data import optimization_store
        from app.services.fargate_control import FargateService

        return cls(
            consumer_sqs_client(),
            FargateService.configured(),
            optimization_store,
            TaskProtection(),
            stop,
            large_service=FargateService.configured(large_target=True)
            if os.getenv("OPTIMIZER_LARGE_QUEUE_URL")
            else None,
        )

    def __init__(
        self, sqs, service, store, protection, stop, *, process_context=None, large_service=None
    ):
        self.sqs, self.service, self.store = sqs, service, store
        self.protection, self.stop = protection, stop
        self.queue_url = os.environ["OPTIMIZER_QUEUE_URL"]
        self.dlq_url = os.environ["OPTIMIZER_DLQ_URL"]
        self.tier = os.getenv("OPTIMIZER_WORKER_TIER", "standard")
        self.memory_limit = {"standard": 9, "large": 29}[self.tier] * 1024**3
        self.large_service = large_service
        self.large_queue_url = os.getenv("OPTIMIZER_LARGE_QUEUE_URL")
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

    def _failure(self, claim, failure, envelope):
        try:
            promote = (
                failure["code"] == "OUT_OF_MEMORY"
                and self.tier == "standard"
                and self.large_queue_url is not None
            )
            if promote:
                if self.store.promote_to_large(*claim):
                    logger.info(
                        "fargate_memory_handoff run_id=%s detail=%s",
                        claim[1],
                        failure.get("detail"),
                    )
                    return ExecutionResult(DeliveryOutcome.FORWARD_LARGE)
            elif self.store.finish(*claim, error=failure, stopped=True):
                return ExecutionResult(DeliveryOutcome.DEAD_LETTER, error=failure)
            return self._delivery_result(envelope) or ExecutionResult(
                DeliveryOutcome.RETRY, RETRY_DELAY_SECONDS
            )
        except OptimizationTerminalError as error:
            return ExecutionResult(DeliveryOutcome.DEAD_LETTER, error=error.error)
        except Exception as error:
            logger.exception("fargate_job_failed failure_persistence claim=%s", claim)
            return ExecutionResult(DeliveryOutcome.RETRY, retry_seconds(error))

    def _timeout(self, claim, envelope):
        return self._failure(
            claim,
            {"code": "TIMEOUT", "message": "Optimeringen overskred tidsgrænsen."},
            envelope,
        )

    def _delivery_result(self, envelope):
        return self.store.delivery_result(
            envelope["simulationId"], envelope["runId"], envelope["farmId"], self.tier
        )

    def claim_delivery(self, envelope):
        try:
            result = self._delivery_result(envelope)
            if result is not None:
                return result
            claimed = self.store.claim(
                envelope["simulationId"],
                envelope["runId"],
                farm_id=envelope["farmId"],
                sqs_delivery=True,
                tier=self.tier,
            )
            if claimed is not None:
                return claimed
            # State may have changed between the initial read and the row lock.
            return self._delivery_result(envelope) or ExecutionResult(
                DeliveryOutcome.RETRY, RETRY_DELAY_SECONDS
            )
        except OptimizationTerminalError as error:
            logger.error("fargate_job_failed run_id=%s error=%s", envelope["runId"], error)
            return ExecutionResult(DeliveryOutcome.DEAD_LETTER, error=error.error)
        except Exception as error:
            logger.exception("fargate_job_failed delivery_state run_id=%s", envelope["runId"])
            return ExecutionResult(DeliveryOutcome.RETRY, retry_seconds(error))

    def execute(self, envelope):
        deadline = time.monotonic() + EXECUTION_TIMEOUT_SECONDS
        claimed = self.claim_delivery(envelope)
        if isinstance(claimed, ExecutionResult):
            return claimed
        row, _, token = claimed
        claim = envelope["simulationId"], envelope["runId"], token, row["input_revision"]
        parent, child = self.process_context.Pipe(duplex=False)
        process = self.process_context.Process(
            target=_child_execute, args=(envelope, deadline, child, claimed, self.memory_limit)
        )
        failure = None
        outcome = None
        before_memory = memory_observation()
        try:
            process.start()
            child.close()
            while outcome is None and failure is None:
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
                    if kind == "failure":
                        failure = value
                    else:
                        outcome = value
                elif not process.is_alive():
                    break
                else:
                    pressure = memory_pressure(process.pid, self.memory_limit)
                    if pressure:
                        self._terminate(process)
                        failure = {
                            "code": "OUT_OF_MEMORY",
                            "message": "Optimeringen løb tør for hukommelse.",
                            "detail": pressure,
                        }
            process.join(5)
            self._terminate(process)
            if self.stop.is_set():
                return ExecutionResult(DeliveryOutcome.INTERRUPTED)
            if outcome is not None:
                return outcome
            if failure is not None:
                return self._failure(claim, failure, envelope)
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

    def shutdown_if_idle(self, woke_during_poll):
        try:
            if not self.service.scale_to_zero(woke_during_poll):
                return False
            # Stay protected at desired count zero while waiting for a retry or
            # DLQ handoff. Other tasks can retire after their own empty polls.
            now = time.monotonic()
            self.outstanding = {
                key: until for key, until in self.outstanding.items() if now < until
            }
            if self.outstanding:
                return False
            self.protection.set(False)
            logger.info("fargate_idle_shutdown")
            return True
        except Exception:
            logger.exception("fargate_shutdown_verification_failed")
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

    def run(self):
        self.protection.set(True)
        while not self.stop.is_set():
            record = None
            try:
                # Existing protection covers the final poll even when a sibling
                # has already requested zero and ECS is draining the service.
                self.protection.protect_for(90)
                with self.service.idle_poll() as woke_during_poll:
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
                        if self.shutdown_if_idle(woke_during_poll):
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
                    self.protection.protect_for(EXECUTION_TIMEOUT_SECONDS + 120)
                    logger.info(
                        "fargate_received run_id=%s message_id=%s receive_count=%s",
                        envelope["runId"],
                        message_id,
                        record.get("Attributes", {}).get("ApproximateReceiveCount"),
                    )
                    result = self.execute(envelope)
                if self.stop.is_set() or result.outcome == DeliveryOutcome.INTERRUPTED:
                    break
                if result.outcome in (DeliveryOutcome.FORWARD_LARGE, DeliveryOutcome.WAKE_LARGE):
                    send = result.outcome == DeliveryOutcome.FORWARD_LARGE
                    if send:
                        self.sqs.send_message(
                            QueueUrl=self.large_queue_url,
                            MessageBody=record["Body"],
                            MessageAttributes=record.get("MessageAttributes", {}),
                        )
                    self.large_service.wake_large(
                        envelope["simulationId"], envelope["runId"], sent=send
                    )
                    result = ExecutionResult(DeliveryOutcome.ACK)
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
