"""SQS transport shared by submission and worker retry visibility updates."""

import os

import boto3
from botocore.config import Config


def sqs_client():
    return boto3.client(
        "sqs",
        endpoint_url=os.getenv("OPTIMIZER_SQS_ENDPOINT_URL"),
        config=Config(connect_timeout=3, read_timeout=5, retries={"total_max_attempts": 2}),
    )
