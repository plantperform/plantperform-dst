"""Load database configuration before importing persistence or solver modules."""

import os
from io import StringIO

import boto3
from botocore.config import Config
from dotenv import dotenv_values


def initialize_configuration():
    if not os.getenv("DATABASE_URL"):
        response = boto3.client(
            "s3",
            config=Config(connect_timeout=3, read_timeout=5, retries={"total_max_attempts": 2}),
        ).get_object(Bucket=os.environ["APP_CONFIG_BUCKET"], Key=os.environ["APP_CONFIG_KEY"])
        with response["Body"] as body:
            config = dotenv_values(stream=StringIO(body.read().decode()))
        if not config.get("DATABASE_URL"):
            raise ValueError("Database configuration is missing DATABASE_URL")
        os.environ["DATABASE_URL"] = config["DATABASE_URL"]
    os.environ.setdefault("DB_POOL_SIZE", "2")
    os.environ.setdefault("DB_MAX_OVERFLOW", "0")
    os.environ.setdefault("OPTIMIZER_SOLVER_THREADS", "4")
