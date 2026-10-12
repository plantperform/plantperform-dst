"""Dispatch revision-bound display preparation without importing worker code."""

import logging
import os

from sqlalchemy import select, update

from app.data import read_model_store, repository
from app.data.db import farm_read_model_table as farm_views
from app.data.db import farm_table
from app.data.db import simulation_read_model_table as simulation_views
from app.domain.read_model import preparation_job
from app.services.optimization.jobs import QueueUnavailableError, is_production
from app.services.optimization.queue import sqs_client

logger = logging.getLogger(__name__)


def require_transport(background_tasks):
    if is_production() and not os.getenv("OPTIMIZER_QUEUE_URL"):
        raise QueueUnavailableError("Beregningskøen er ikke konfigureret.")
    if not is_production() and background_tasks is None:
        raise QueueUnavailableError("Den lokale beregning er ikke konfigureret.")


def dispatch(job, background_tasks=None):
    try:
        if is_production():
            queue_url = os.getenv("OPTIMIZER_QUEUE_URL")
            if not queue_url:
                raise QueueUnavailableError("Beregningskøen er ikke konfigureret.")
            sqs_client().send_message(
                QueueUrl=queue_url,
                MessageBody=job.model_dump_json(by_alias=True),
            )
        else:
            from plantperform_optimizer.read_model_worker import execute_local

            background_tasks.add_task(execute_local, job)
        logger.info(
            "preparation_dispatched job_type=%s entity_id=%s revision=%s transport=%s",
            job.job_type,
            job.entity_id,
            job.expected_revision,
            "sqs" if is_production() else "local",
        )
    except Exception as error:
        table = farm_views if job.job_type == "prepare_farm_history" else simulation_views
        owner = table.c.farm_id if job.job_type == "prepare_farm_history" else table.c.simulation_id
        with repository.SessionLocal.begin() as session:
            session.execute(
                update(table)
                .where(
                    owner == job.entity_id,
                    table.c.input_revision == job.expected_revision,
                    table.c.generation == job.generation,
                    table.c.status == "queued",
                )
                .values(
                    status="failed",
                    view_version=table.c.view_version + 1,
                    error={
                        "code": "QUEUE_UNAVAILABLE",
                        "message": "Kunne ikke starte beregningen.",
                    },
                )
            )
        raise QueueUnavailableError("Kunne ikke sende beregningen til køen. Prøv igen.") from error


def register_fields(farm_id, requests, email, background_tasks):
    require_transport(background_tasks)
    registered = repository.register_fields(farm_id, requests, email)
    if registered is None:
        return None
    fields, job = registered
    if job:
        dispatch(job, background_tasks)
    return fields


def _prepare_on_load(kind, entity_id, background_tasks):
    with repository.SessionLocal.begin() as session:
        job = read_model_store.schedule_preparation(session, kind, entity_id)
    if job:
        try:
            dispatch(job, background_tasks)
        except QueueUnavailableError:
            # Dispatch persists the failure. Return it as view state so polling
            # and HTTP error retries do not repeatedly start another attempt.
            logger.exception("automatic_preparation_dispatch_failed entity_id=%s", entity_id)


def get_or_prepare_farm_view(farm_id, email, background_tasks, *, include_data=True):
    view = read_model_store.get_farm_view(farm_id, email, include_data=include_data)
    if view is None or not include_data or view["data"] is not None:
        return view
    _prepare_on_load("prepare_farm_history", farm_id, background_tasks)
    return read_model_store.get_farm_view(farm_id, email)


def get_or_prepare_simulation_view(
    farm_id, simulation_id, email, background_tasks, *, include_data=True
):
    view = read_model_store.get_simulation_view(
        farm_id, simulation_id, email, include_data=include_data
    )
    if (
        view is None
        or not include_data
        or view["data"] is not None
        or view["simulation"].creation_status != "done"
    ):
        return view
    _prepare_on_load("prepare_simulation_view", simulation_id, background_tasks)
    return read_model_store.get_simulation_view(farm_id, simulation_id, email)


def retry_history(farm_id, email, background_tasks):
    require_transport(background_tasks)
    with repository.SessionLocal.begin() as session:
        if not repository._member_exists(session, farm_id, email):
            return None
        job = read_model_store.schedule_preparation(
            session, "prepare_farm_history", farm_id, refresh=True
        )
    if job:
        dispatch(job, background_tasks)
    return read_model_store.get_farm_view(farm_id, email, include_data=False)


def dispatch_current_history(farm_id, background_tasks):
    with repository.SessionLocal() as session:
        revision = session.execute(
            select(farm_table.c.revision).where(farm_table.c.id == farm_id)
        ).scalar_one_or_none()
    if revision is not None:
        dispatch(preparation_job("prepare_farm_history", farm_id, revision), background_tasks)


def retry_simulation_view(farm_id, simulation_id, email, background_tasks):
    require_transport(background_tasks)
    with repository.SessionLocal.begin() as session:
        if not repository._member_exists(session, farm_id, email):
            return None
        from app.data.db import simulation_table

        if not session.execute(
            select(simulation_table.c.id).where(
                simulation_table.c.id == simulation_id, simulation_table.c.farm_id == farm_id
            )
        ).first():
            return None
        job = read_model_store.schedule_preparation(
            session, "prepare_simulation_view", simulation_id
        )
    if job:
        dispatch(job, background_tasks)
    return read_model_store.get_simulation_view(farm_id, simulation_id, email, include_data=False)
