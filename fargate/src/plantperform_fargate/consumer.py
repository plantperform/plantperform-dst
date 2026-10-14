"""One-message SQS consumer with bounded child execution and coordinated shutdown."""

import json
import logging
import math
import multiprocessing
import os
import time
from datetime import UTC, datetime
from urllib.request import Request, urlopen

import boto3
from botocore.config import Config

from app.domain.optimization import (
    EXECUTION_TIMEOUT_SECONDS,
    RETRY_DELAY_SECONDS,
    OptimizationLeaseActiveError,
)
from app.services.fargate_control import set_worker_count
from plantperform_fargate.configuration import initialize_configuration

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
    try:
        initialize_configuration()
        from plantperform_fargate.worker import execute

        execute(
            envelope["simulationId"],
            envelope["runId"],
            ExecutionContext(deadline),
            sqs_delivery=True,
            farm_id=envelope["farmId"],
            on_claim=lambda *claim: connection.send(("claim", claim)),
        )
        connection.send(("ack", None))
    except Exception as error:
        logger.exception("fargate_job_failed run_id=%s", envelope["runId"])
        connection.send(("retry", retry_seconds(error)))
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

    def _timeout(self, claim):
        if claim is None:
            return "retry", RETRY_DELAY_SECONDS
        simulation_id, run_id, token, revision = claim
        try:
            saved = self.store.finish(
                simulation_id,
                run_id,
                token,
                revision,
                error={"code": "TIMEOUT", "message": "Optimeringen overskred tidsgrænsen."},
            )
            if not saved:
                self.store.check_delivery_state(simulation_id, run_id)
            return "ack", None
        except Exception as error:
            logger.exception("fargate_timeout_persistence_failed run_id=%s", run_id)
            return "retry", retry_seconds(error)

    def execute(self, envelope):
        parent, child = self.process_context.Pipe(duplex=False)
        deadline = time.monotonic() + EXECUTION_TIMEOUT_SECONDS
        process = self.process_context.Process(
            target=_child_execute, args=(envelope, deadline, child)
        )
        claim = None
        outcome = None
        try:
            process.start()
            child.close()
            while outcome is None:
                if self.stop.is_set():
                    self._terminate(process)
                    return "interrupted", None
                if time.monotonic() >= deadline:
                    self._terminate(process)
                    return self._timeout(claim)
                if parent.poll(0.2):
                    try:
                        kind, value = parent.recv()
                    except EOFError:
                        break
                    if kind == "claim":
                        claim = value
                    else:
                        outcome = kind, value
                elif not process.is_alive():
                    break
            process.join(5)
            self._terminate(process)
            if outcome is not None:
                return outcome
            if claim is not None:
                try:
                    self.store.check_delivery_state(claim[0], claim[1])
                    return "ack", None
                except Exception as error:
                    return "retry", retry_seconds(error)
            return "retry", RETRY_DELAY_SECONDS
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

    def run(self):
        self.protection.set(True)
        while not self.stop.is_set():
            try:
                since = self.store.publication_clock()
                response = self.sqs.receive_message(
                    QueueUrl=self.queue_url,
                    MaxNumberOfMessages=1,
                    WaitTimeSeconds=20,
                    VisibilityTimeout=VISIBILITY_SECONDS,
                    MessageSystemAttributeNames=["SentTimestamp", "ApproximateReceiveCount"],
                )
                if self.stop.is_set():
                    break
                messages = response.get("Messages", [])
                if not messages:
                    if self.shutdown_if_idle(since):
                        return
                    continue
                record = messages[0]
                try:
                    envelope = parse_envelope(record["Body"])
                    self.protection.set(True)
                    logger.info(
                        "fargate_received run_id=%s message_id=%s receive_count=%s",
                        envelope["runId"],
                        record["MessageId"],
                        record.get("Attributes", {}).get("ApproximateReceiveCount"),
                    )
                    outcome, delay = self.execute(envelope)
                except Exception as error:
                    logger.exception("fargate_message_failed message_id=%s", record["MessageId"])
                    outcome, delay = "retry", retry_seconds(error)
                if self.stop.is_set() or outcome == "interrupted":
                    break
                if outcome == "ack":
                    self.sqs.delete_message(
                        QueueUrl=self.queue_url, ReceiptHandle=record["ReceiptHandle"]
                    )
                else:
                    self.sqs.change_message_visibility(
                        QueueUrl=self.queue_url,
                        ReceiptHandle=record["ReceiptHandle"],
                        VisibilityTimeout=min(43200, delay or RETRY_DELAY_SECONDS),
                    )
            except Exception:
                logger.exception("fargate_consumer_failed")
                self.stop.wait(5)
        # Forced stop never acknowledges an unfinished delivery.
        self.protection.set(False)


def consumer_sqs_client():
    return boto3.client(
        "sqs",
        endpoint_url=os.getenv("OPTIMIZER_SQS_ENDPOINT_URL"),
        config=Config(connect_timeout=3, read_timeout=30, retries={"total_max_attempts": 2}),
    )
