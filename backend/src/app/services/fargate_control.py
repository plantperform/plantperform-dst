"""Wake the environment's ECS service after durable optimization publication."""

import logging
import os

import boto3
from botocore.config import Config

logger = logging.getLogger(__name__)


def ecs_client():
    return boto3.client(
        "ecs",
        config=Config(connect_timeout=3, read_timeout=5, retries={"total_max_attempts": 2}),
    )


def set_worker_count(client, count):
    client.update_service(
        cluster=os.environ["FARGATE_CLUSTER_NAME"],
        service=os.environ["FARGATE_SERVICE_NAME"],
        desiredCount=count,
    )


def wake_worker():
    try:
        if not os.getenv("FARGATE_CLUSTER_NAME") or not os.getenv("FARGATE_SERVICE_NAME"):
            raise ValueError("Fargate wakeup configuration is missing")
        set_worker_count(ecs_client(), 1)
    except Exception:
        # SQS owns the accepted job. Its visible-message alarm recovers a missed wakeup.
        logger.exception("fargate_wakeup_failed")
