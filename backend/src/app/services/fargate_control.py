"""Coordinate publisher scale-out and protected workers' idle shutdown."""

import logging
import os
from datetime import timedelta
from functools import cache

import boto3
from botocore.config import Config
from sqlalchemy import func, select, update

from app.data.advisory_lock import advisory_key, advisory_session
from app.data.db import SessionLocal
from app.data.db import simulation_result_table as results

logger = logging.getLogger(__name__)


@cache
def ecs_client():
    return boto3.client(
        "ecs",
        config=Config(connect_timeout=3, read_timeout=5, retries={"total_max_attempts": 2}),
    )


class FargateService:
    def __init__(self, cluster, name):
        self.cluster = cluster
        self.name = name
        self.lock_key = advisory_key(f"plantperform:fargate:{cluster}/{name}")

    @classmethod
    def configured(cls):
        cluster = os.getenv("FARGATE_CLUSTER_NAME")
        name = os.getenv("FARGATE_SERVICE_NAME")
        if not cluster or not name:
            raise ValueError("Fargate scaling configuration is missing")
        return cls(cluster, name)

    def _request_count(self, count):
        ecs_client().update_service(cluster=self.cluster, service=self.name, desiredCount=count)
        logger.info(
            "fargate_scaled cluster=%s service=%s desired_count=%d", self.cluster, self.name, count
        )

    def scale_on_submission(self, session):
        # The source queue retains messages for four days. A task that
        # claimed one before expiry can still be finishing its solve.
        jobs = session.scalar(
            select(func.count())
            .select_from(results)
            .where(
                results.c.published_at.is_not(None),
                results.c.status.in_(("queued", "in_progress")),
                (results.c.published_at > func.now() - timedelta(days=4))
                | (results.c.lease_expires_at > func.now()),
            )
        )
        self._request_count(min(10, 1 + jobs // 3))

    def poll_started_at(self):
        with SessionLocal.begin() as session:
            session.execute(select(func.pg_advisory_xact_lock(self.lock_key)))
            return session.scalar(select(func.clock_timestamp()))

    def scale_to_zero(self, poll_started_at):
        with SessionLocal.begin() as session:
            session.execute(select(func.pg_advisory_xact_lock(self.lock_key)))
            published = select(results.c.simulation_id).where(
                results.c.published_at >= poll_started_at
            )
            if session.scalar(select(published.exists())):
                return False
            self._request_count(0)
            return True


def record_publication(simulation_id, run_id):
    marker = (
        update(results)
        .where(results.c.simulation_id == simulation_id, results.c.run_id == run_id)
        .values(published_at=func.clock_timestamp())
    )
    try:
        service = FargateService.configured()
    except ValueError:
        with SessionLocal.begin() as session:
            session.execute(marker)
        logger.exception("fargate_wakeup_failed")
        return

    # Keep the marker durable even if ECS times out. The same lock orders the
    # marker and wakeup against both ends of a worker's long poll.
    published = False
    try:
        with advisory_session(SessionLocal, service.lock_key) as session:
            with session.begin():
                session.execute(marker)
            published = True
            service.scale_on_submission(session)
    except Exception:
        if not published:
            raise
        logger.exception("fargate_wakeup_failed")
