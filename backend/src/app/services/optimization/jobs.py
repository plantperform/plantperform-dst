"""Submit optimization jobs without importing solver code in production."""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import select, update

from app.data.db import SessionLocal
from app.data.db import simulation_result_table as results
from app.data.simulation_store import _row, get_result, read_result
from app.services.optimization.local import execute_local_when_ready
from app.services.optimization.queue import sqs_client

if TYPE_CHECKING:
    from fastapi import BackgroundTasks

logger = logging.getLogger(__name__)


def is_production():
    return os.getenv("APP_ENV", "development").lower() == "production"


class SimulationNotFoundError(Exception):
    pass


class SubmissionConflictError(Exception):
    pass


class QueueUnavailableError(Exception):
    pass


def submit(
    farm_id,
    simulation_id,
    email,
    kind,
    request,
    *,
    background_tasks: BackgroundTasks | None = None,
    transport: str | None = None,
):
    started = time.monotonic()
    production = transport == "sqs" if transport is not None else is_production()
    queue_url = os.getenv("OPTIMIZER_QUEUE_URL")
    if production and not queue_url:
        raise QueueUnavailableError("Optimeringskøen er ikke konfigureret.")
    if not production and background_tasks is None:
        raise QueueUnavailableError("Den lokale optimering er ikke konfigureret.")
    run_id = str(request.run_id)
    with SessionLocal.begin() as session:
        setup = _row(session, farm_id, simulation_id, email, lock=True, include_data=False)
        if setup is None:
            raise SimulationNotFoundError
        result = session.execute(
            select(*[c for c in results.c if c.name != "output"])
            .where(results.c.simulation_id == simulation_id)
            .with_for_update()
        ).one()
        if setup.revision != request.expected_revision:
            raise SubmissionConflictError("Scenariet er ændret. Genindlæs før en ny optimering.")
        if result.run_id == run_id:
            if result.input_revision != setup.revision:
                raise SubmissionConflictError("Denne kørsel er forældet. Start en ny optimering.")
            if result.parameters != request.model_dump(mode="json") or result.kind != kind:
                raise SubmissionConflictError(
                    "Kørsels-id er allerede brugt med andre indstillinger."
                )
            if result.published_at is not None or result.status != "queued":
                # Preserve the full response for an idempotent request; new
                # submissions do not load previous output before dispatch.
                result = session.execute(
                    select(results).where(results.c.simulation_id == simulation_id)
                ).one()
                return read_result(result)
        else:
            if result.status in ("queued", "in_progress"):
                raise SubmissionConflictError("Scenariet har allerede en aktiv optimering.")
            session.execute(
                update(results)
                .where(results.c.simulation_id == simulation_id)
                .values(
                    status="queued",
                    run_id=run_id,
                    kind=kind,
                    requested_by=email,
                    parameters=request.model_dump(mode="json"),
                    input_revision=setup.revision,
                    queued_at=datetime.now(UTC),
                    published_at=None,
                    started_at=None,
                    finished_at=None,
                    lease_token=None,
                    lease_expires_at=None,
                    attempts=0,
                    error=None,
                ),
            )
        if not production:
            # Reserve dispatch under the same lock so repeated local submissions
            # cannot register another background task before the first response.
            session.execute(
                update(results)
                .where(results.c.simulation_id == simulation_id, results.c.run_id == run_id)
                .values(published_at=datetime.now(UTC))
            )
    try:
        if production:
            publishing = time.monotonic()
            sent = sqs_client().send_message(
                QueueUrl=queue_url,
                DelaySeconds=0,
                MessageBody=json.dumps(
                    {
                        "jobType": "optimization",
                        "farmId": farm_id,
                        "simulationId": simulation_id,
                        "runId": run_id,
                    }
                ),
            )
            logger.info(
                "optimizer_published simulation_id=%s run_id=%s message_id=%s "
                "publication_seconds=%.3f dispatch_seconds=%.3f",
                simulation_id,
                run_id,
                sent.get("MessageId"),
                time.monotonic() - publishing,
                time.monotonic() - started,
            )
            with SessionLocal.begin() as session:
                session.execute(
                    update(results)
                    .where(
                        results.c.simulation_id == simulation_id,
                        results.c.run_id == run_id,
                    )
                    .values(published_at=datetime.now(UTC))
                )
        else:
            background_tasks.add_task(execute_local_when_ready, simulation_id, run_id)
            logger.info(
                "optimizer_dispatched simulation_id=%s run_id=%s transport=local "
                "dispatch_seconds=%.3f",
                simulation_id,
                run_id,
                time.monotonic() - started,
            )
    except Exception as error:
        message = (
            "Kunne ikke sende optimeringen til køen. Prøv igen."
            if production
            else "Kunne ikke starte den lokale optimering. Prøv igen."
        )
        # An ambiguous SendMessage error must not fail a worker that already claimed the run.
        with SessionLocal.begin() as session:
            session.execute(
                update(results)
                .where(
                    results.c.simulation_id == simulation_id,
                    results.c.run_id == run_id,
                    results.c.status == "queued",
                )
                .values(
                    status="failed",
                    finished_at=datetime.now(UTC),
                    error={
                        "code": "QUEUE_UNAVAILABLE" if production else "WORKER_ERROR",
                        "message": message,
                    },
                )
            )
            current = session.execute(
                select(results).where(results.c.simulation_id == simulation_id)
            ).first()
        if current and current.run_id == run_id and current.status in ("in_progress", "completed"):
            return read_result(current)
        raise QueueUnavailableError(message) from error
    current = get_result(farm_id, simulation_id, email)
    if current is None:
        raise SimulationNotFoundError
    return current
