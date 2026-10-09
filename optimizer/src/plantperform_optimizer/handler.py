import json
import logging
import math
import os
import time
from datetime import UTC, datetime
from functools import lru_cache
from io import StringIO

import boto3
from botocore.config import Config
from dotenv import dotenv_values

from app.domain.creation import CreationActiveError
from app.domain.creation_job import CreationJob
from app.domain.optimization import RETRY_DELAY_SECONDS, OptimizationLeaseActiveError
from app.services.optimization.queue import sqs_client

logger = logging.getLogger(__name__)
logging.getLogger().setLevel(logging.INFO)


def initialize_configuration():
    if not os.getenv("DATABASE_URL"):
        response = boto3.client(
            "s3",
            config=Config(connect_timeout=3, read_timeout=5, retries={"total_max_attempts": 2}),
        ).get_object(
            Bucket=os.environ["APP_CONFIG_BUCKET"],
            Key=os.environ["APP_CONFIG_KEY"],
        )
        config = dotenv_values(stream=StringIO(response["Body"].read().decode()))
        os.environ["DATABASE_URL"] = config["DATABASE_URL"]
    os.environ.setdefault("DB_POOL_SIZE", "2")
    os.environ.setdefault("DB_MAX_OVERFLOW", "0")


@lru_cache(maxsize=1)
def initialize():
    initialize_configuration()
    from plantperform_optimizer import worker

    return worker


def initialize_creation():
    initialize_configuration()
    from app.services.creation import worker

    return worker


def _retry_message(record, visibility_timeout):
    try:
        sqs_client().change_message_visibility(
            QueueUrl=os.environ["OPTIMIZER_QUEUE_URL"],
            ReceiptHandle=record["receiptHandle"],
            VisibilityTimeout=visibility_timeout,
        )
    except Exception:
        logger.exception("optimizer_retry_visibility_failed")


def parse_envelope(body):
    """Reject malformed messages before configuration or executor initialization."""
    envelope = json.loads(body)
    if not isinstance(envelope, dict):
        raise ValueError("Job envelope must be an object")
    job_type = envelope.get("jobType")
    if job_type not in ("create_simulation", "optimization"):
        raise ValueError(f"Missing or unknown job type: {job_type}")
    identifier_key = "jobId" if job_type == "create_simulation" else "runId"
    for key in ("farmId", "simulationId", identifier_key):
        if not isinstance(envelope.get(key), str) or not envelope[key].strip():
            raise ValueError(f"Missing or invalid {key}")
    if job_type == "create_simulation":
        CreationJob.model_validate(envelope)
    return envelope, identifier_key


def handler(event, context):
    failures = []
    for record in event.get("Records", []):
        try:
            envelope, identifier_key = parse_envelope(record["body"])
            received = time.time()
            try:
                sent = int(record.get("attributes", {}).get("SentTimestamp", "")) / 1000
                delivery_seconds = round(max(0, received - sent), 3)
            except (TypeError, ValueError):
                delivery_seconds = None
            logger.info(
                "optimizer_received simulation_id=%s run_id=%s message_id=%s delivery_seconds=%s "
                "receive_count=%s",
                envelope["simulationId"],
                envelope[identifier_key],
                record["messageId"],
                delivery_seconds,
                record.get("attributes", {}).get("ApproximateReceiveCount"),
            )
            initializing = time.monotonic()
            try:
                initialize_configuration()
                job_type = envelope["jobType"]
                if job_type == "create_simulation":
                    executor = initialize_creation()
                elif job_type == "optimization":
                    executor = initialize()
                else:
                    raise ValueError(f"Unknown job type: {job_type}")
            finally:
                logger.info(
                    "optimizer_initialized run_id=%s duration_seconds=%.3f",
                    envelope[identifier_key],
                    time.monotonic() - initializing,
                )
            if job_type == "create_simulation":
                executor.execute(
                    CreationJob.model_validate(envelope),
                    context,
                    sqs_delivery=True,
                    receive_count=int(
                        record.get("attributes", {}).get("ApproximateReceiveCount", "1")
                    ),
                )
            else:
                executor.execute(
                    envelope["simulationId"],
                    envelope[identifier_key],
                    context,
                    sqs_delivery=True,
                    farm_id=envelope["farmId"],
                )
        except CreationActiveError:
            failures.append({"itemIdentifier": record["messageId"]})
            _retry_message(record, RETRY_DELAY_SECONDS)
        except OptimizationLeaseActiveError as error:
            failures.append({"itemIdentifier": record["messageId"]})
            visibility_timeout = max(
                RETRY_DELAY_SECONDS,
                math.ceil((error.expires_at - datetime.now(UTC)).total_seconds()) + 1,
            )
            logger.info(
                "optimizer_lease_active message_id=%s visibility_timeout=%s",
                record["messageId"],
                visibility_timeout,
            )
            _retry_message(record, visibility_timeout)
        except Exception:
            logger.exception("optimizer_message_failed message_id=%s", record["messageId"])
            failures.append({"itemIdentifier": record["messageId"]})
            _retry_message(record, RETRY_DELAY_SECONDS)
    return {"batchItemFailures": failures}
