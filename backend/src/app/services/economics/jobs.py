"""Manual economics recalculation shares the existing local/SQS transport."""

import json
import os

from app.data import economics_recalculation_store as store
from app.data import repository
from app.domain.creation import CreationActiveError, CreationQueueUnavailableError
from app.domain.economics import EconomicsConflictError
from app.services.creation.jobs import _require_transport
from app.services.optimization.jobs import is_production
from app.services.optimization.queue import sqs_client


def _dispatch(job, background_tasks):
    try:
        if is_production():
            sqs_client().send_message(
                QueueUrl=os.environ["OPTIMIZER_QUEUE_URL"],
                DelaySeconds=0,
                MessageBody=json.dumps(job.envelope()),
            )
        else:
            from plantperform_optimizer.economics_worker import execute_local

            background_tasks.add_task(execute_local, job)
        store.mark_published(job)
    except Exception as error:
        with repository.SessionLocal() as session:
            row = store.locked_setup(session, job)
            if row is not None and row.creation_status in ("running", "done"):
                return
            session.rollback()
            store.set_status(session, job, "failed")
        raise CreationQueueUnavailableError(
            "Could not submit economics recalculation", job.simulation_id
        ) from error


def submit(farm_id, simulation_id, request, email, background_tasks):
    _require_transport(background_tasks, simulation_id)
    simulation_id, job = store.submit(farm_id, simulation_id, request, email)
    if simulation_id is None:
        return None
    if job:
        _dispatch(job, background_tasks)
    return repository.get_simulation(farm_id, simulation_id, email)


def retry(farm_id, simulation_id, email, background_tasks):
    _require_transport(background_tasks, simulation_id)
    try:
        simulation_id, job = store.retry(farm_id, simulation_id, email)
    except CreationActiveError as error:
        raise EconomicsConflictError("Recalculation is still running") from error
    if simulation_id is None:
        return None
    if job:
        _dispatch(job, background_tasks)
    return repository.get_simulation(farm_id, simulation_id, email)
