"""Dispatch complete creation inputs through SQS or local background tasks."""

import json
import logging
import os
from time import monotonic

from sqlalchemy import update

from app.data import creation_store, repository
from app.data.db import simulation_table as setups
from app.domain.creation import CreationQueueUnavailableError
from app.services.optimization.jobs import is_production
from app.services.optimization.queue import sqs_client

logger = logging.getLogger(__name__)


def _require_transport(background_tasks, simulation_id=None):
    if is_production() and not os.getenv("OPTIMIZER_QUEUE_URL"):
        raise CreationQueueUnavailableError("Oprettelseskøen er ikke konfigureret.", simulation_id)
    if not is_production() and background_tasks is None:
        raise CreationQueueUnavailableError(
            "Den lokale oprettelse er ikke konfigureret.", simulation_id
        )


def _dispatch(job, *, background_tasks=None):
    try:
        if is_production():
            sent = sqs_client().send_message(
                QueueUrl=os.environ["OPTIMIZER_QUEUE_URL"],
                DelaySeconds=0,
                MessageBody=json.dumps(job.envelope()),
            )
            logger.info(
                "creation_published simulation_id=%s job_id=%s message_id=%s",
                job.simulation_id,
                job.job_id,
                sent.get("MessageId"),
            )
        else:
            from app.services.creation.worker import execute_local

            background_tasks.add_task(execute_local, job)
    except Exception as error:
        message = "Kunne ikke starte oprettelsen. Prøv igen."
        with repository.SessionLocal.begin() as session:
            current = creation_store.locked_setup(session, job)
            if current is not None and current.creation_status in ("running", "done"):
                return  # An ambiguous publication already reached the worker.
            if current is not None and current.creation_status == "queued":
                session.execute(
                    update(setups)
                    .where(setups.c.id == job.simulation_id)
                    .values(creation_status="failed")
                )
        raise CreationQueueUnavailableError(message, job.simulation_id) from error


def submit(farm_id, request, email, *, background_tasks=None):
    started = monotonic()
    _require_transport(background_tasks)
    created = creation_store.create(farm_id, request, email)
    if created is None:
        return None
    simulation_id, job = created
    if job is not None:
        _dispatch(job, background_tasks=background_tasks)
    logger.info(
        "creation_submitted simulation_id=%s duration_seconds=%.3f",
        simulation_id,
        monotonic() - started,
    )
    return repository.get_simulation(farm_id, simulation_id, email)


def retry(farm_id, simulation_id, email, *, optimize_on_create=False, background_tasks=None):
    _require_transport(background_tasks, simulation_id)
    job = creation_store.retry(farm_id, simulation_id, email, optimize_on_create=optimize_on_create)
    if job is None:
        return None
    _dispatch(job, background_tasks=background_tasks)
    return repository.get_simulation(farm_id, simulation_id, email)
