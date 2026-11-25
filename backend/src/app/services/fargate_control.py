"""Coordinate publisher scale-out and protected workers' idle shutdown."""

import logging
import os
from contextlib import contextmanager
from datetime import timedelta
from functools import cache

import boto3
from botocore.config import Config
from sqlalchemy import func, select, update

from app.data.advisory_lock import advisory_key, advisory_session
from app.data.db import SessionLocal
from app.data.db import simulation_result_table as results
from app.domain.optimization import LARGE_ACTIVE_STATUSES, STANDARD_ACTIVE_STATUSES

logger = logging.getLogger(__name__)


@cache
def ecs_client():
    return boto3.client(
        "ecs",
        config=Config(connect_timeout=3, read_timeout=5, retries={"total_max_attempts": 2}),
    )


class FargateService:
    def __init__(self, cluster, name, tier="standard"):
        self.tier = tier
        self.cluster = cluster
        self.name = name
        self.lock_key = advisory_key(f"plantperform:fargate:{cluster}/{name}")
        self.wake_channel = f"optimizer_wake_{self.lock_key & 0xFFFFFFFFFFFFFFFF:016x}"

    @classmethod
    def configured(cls, *, large_target=False):
        cluster = os.getenv("FARGATE_CLUSTER_NAME")
        tier = "large" if large_target else os.getenv("OPTIMIZER_WORKER_TIER", "standard")
        name = os.getenv("FARGATE_LARGE_SERVICE_NAME" if large_target else "FARGATE_SERVICE_NAME")
        if not cluster or not name:
            raise ValueError("Fargate scaling configuration is missing")
        return cls(cluster, name, tier)

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
                results.c.status.in_(STANDARD_ACTIVE_STATUSES),
                (results.c.published_at > func.now() - timedelta(days=4))
                | (results.c.lease_expires_at > func.now()),
            )
        )
        if jobs:
            self._request_count(min(10, 1 + jobs // 3))

    def wake_large(self, simulation_id=None, run_id=None, *, sent=False):
        """Confirm the transfer before waking. Serialize with this service's idle polls."""
        active = select(results.c.simulation_id).where(
            results.c.status.in_(LARGE_ACTIVE_STATUSES),
            results.c.published_at.is_not(None),
            (results.c.published_at > func.now() - timedelta(days=4))
            | (results.c.lease_expires_at > func.now()),
        )
        with advisory_session(SessionLocal, self.lock_key) as session:
            with session.begin():
                if simulation_id is not None:
                    match = (results.c.simulation_id == simulation_id) & (
                        results.c.run_id == run_id
                    )
                    active = active.where(match, results.c.status == "queued_large")
                    if sent:
                        session.execute(
                            update(results)
                            .where(
                                match,
                                results.c.status.in_(LARGE_ACTIVE_STATUSES),
                                results.c.published_at.is_(None),
                            )
                            .values(published_at=func.clock_timestamp())
                        )
                pending = session.scalar(select(active.exists()))
                if pending:
                    session.execute(select(func.pg_notify(self.wake_channel, "")))
            if pending:
                services = ecs_client().describe_services(
                    cluster=self.cluster, services=[self.name]
                )["services"]
                if len(services) != 1:
                    raise RuntimeError(f"ECS service {self.name} is unavailable")
                if services[0]["desiredCount"] == 0:
                    self._request_count(1)

    @contextmanager
    def idle_poll(self):
        """Capture wakeups during one SQS receive without holding the service lock."""
        if self.tier == "large":
            with SessionLocal() as owner, owner.get_bind().connect() as connection:
                connection.execution_options(isolation_level="AUTOCOMMIT")
                # LISTEN belongs to this physical connection for exactly one poll.
                # Closing it removes the subscription instead of returning it to the pool.
                listener = connection.connection.driver_connection
                connection.detach()
                connection.exec_driver_sql(f"LISTEN {self.wake_channel}").close()

                def woke_during_poll(_session):
                    # Round-trip on the original connection under the service lock.
                    # A lost listener raises, so the worker keeps its protection.
                    connection.exec_driver_sql("SELECT 1").close()
                    return any(n.channel == self.wake_channel for n in listener.notifies(timeout=0))

                yield woke_during_poll
        else:
            with SessionLocal.begin() as session:
                session.execute(select(func.pg_advisory_xact_lock(self.lock_key)))
                started = session.scalar(select(func.clock_timestamp()))

            def published_during_poll(session):
                active = select(results.c.simulation_id).where(
                    results.c.status.in_(STANDARD_ACTIVE_STATUSES),
                    results.c.published_at >= started,
                )
                return session.scalar(select(active.exists()))

            yield published_during_poll

    def scale_to_zero(self, woke_during_poll):
        with SessionLocal.begin() as session:
            session.execute(select(func.pg_advisory_xact_lock(self.lock_key)))
            if woke_during_poll(session):
                return False
            self._request_count(0)
            return True


def record_publication(simulation_id, run_id):
    marker = (
        update(results)
        .where(
            results.c.simulation_id == simulation_id,
            results.c.run_id == run_id,
            results.c.status.in_(STANDARD_ACTIVE_STATUSES),
        )
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

    if os.getenv("FARGATE_LARGE_SERVICE_NAME"):
        try:
            FargateService.configured(large_target=True).wake_large()
        except Exception:
            logger.exception("fargate_large_wakeup_failed")
