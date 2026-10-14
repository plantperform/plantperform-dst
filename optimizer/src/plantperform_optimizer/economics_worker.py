"""Explicit economics recalculation, preserving simulation identities and choices."""

import logging
import time
from copy import deepcopy
from types import SimpleNamespace

from sqlalchemy import update

from app.data import creation_store, read_model_store, simulation_store
from app.data import economics_recalculation_store as store
from app.data.db import simulation_table as setups
from app.domain.economics import EconomicsRecalculationJob
from app.domain.optimization import (
    EXECUTION_TIMEOUT_SECONDS,
    MAX_JOB_ATTEMPTS,
    RETRY_DELAY_SECONDS,
    OptimizationAttemptsExhaustedError,
)
from app.domain.simulation import Simulation
from app.services.economics.db_calculator import clear_lookup_cache
from app.services.economics.recalculation import recalculate_candidate, recalculate_document

logger = logging.getLogger(__name__)


def _deadline(context):
    if context.get_remaining_time_in_millis() < 10_000:
        raise TimeoutError("Economics recalculation deadline reached")


def _execute(session, job, context):
    """Reprice only saved chosen/manual results; alternative candidates do not exist here."""
    with session.begin():
        row = store.locked_setup(session, job)
        if row is None or row.creation_status != "running":
            return False
        simulation = Simulation.model_validate(row.data)
        original_fields = simulation_store._fields(session, job.simulation_id)
        setup_fields = deepcopy(row.fields)
        chosen = {
            field.id: simulation_store._selected_candidate(
                session, job.simulation_id, field.id, field.rotation_id
            )
            for field in original_fields
            if field.rotation_id
        }
    for field in original_fields:
        _deadline(context)
        setup = setup_fields[field.id]
        # Existing detail inputs also support old results without another optimization.
        jbnr = (setup.get("calculation_context") or {}).get("jbnr") or 4
        for name in ("baseline_candidate", "fixed_candidate", "manual_candidate"):
            if setup.get(name):
                setup[name] = recalculate_document(setup[name], simulation, job.snapshot, jbnr)
        candidate = chosen.get(field.id)
        if candidate is not None:
            value = recalculate_candidate(candidate, simulation, job.snapshot, jbnr)
            setup["economics_candidate"] = value.model_dump(mode="json")
        elif setup.get("baseline_candidate"):
            from app.domain.rotation_candidate import RotationCandidateEvaluation

            value = RotationCandidateEvaluation.model_validate(setup["baseline_candidate"])
        else:
            continue
        valued_field = field.model_copy(
            update={
                "db2": value.avg_db_kr_ha * field.area_ha,
                "fen": value.avg_fen * field.area_ha,
            }
        )
        values = {
            key: valued_field.model_dump(mode="json")[key] for key in simulation_store.OUTPUT_KEYS
        }
        if field.allowed_rotation_ids:
            setup["fixed_candidate"] = value.model_dump(mode="json")
            setup["fixed"] = values
        else:
            setup["baseline"] = values
            setup["baseline_revision"] = job.expected_revision
    _deadline(context)
    with session.begin():
        row = store.locked_setup(session, job)
        if row is None or row.creation_status != "running":
            return False
        session.execute(
            update(setups)
            .where(setups.c.id == job.simulation_id)
            .values(
                fields=setup_fields,
                data={**row.data, "economics_snapshot": job.snapshot.model_dump(mode="json")},
                creation_status="done",
            )
        )
        view, prepared = read_model_store.build_simulation(session, job.simulation_id)
        read_model_store.publish_simulation(
            session, job.simulation_id, job.expected_revision, view, prepared
        )
        return True


def execute(job, context, *, sqs_delivery=False, receive_count=1):
    job = EconomicsRecalculationJob.model_validate(job)
    with creation_store.execution_session(job.simulation_id) as session:
        with session.begin():
            row = store.locked_setup(session, job)
            if row is None or row.creation_status == "done":
                return
            if row.creation_status == "failed":
                if sqs_delivery:
                    raise OptimizationAttemptsExhaustedError("Economics recalculation failed")
                return
        if receive_count > MAX_JOB_ATTEMPTS:
            store.set_status(session, job, "failed")
            if sqs_delivery:
                raise OptimizationAttemptsExhaustedError(
                    "Economics recalculation attempts exhausted"
                )
            return
        store.set_status(session, job, "running")
        try:
            clear_lookup_cache()
            _execute(session, job, context)
        except Exception:
            logger.exception(
                "economics_recalculation_failed simulation_id=%s job_id=%s",
                job.simulation_id,
                job.job_id,
            )
            session.rollback()
            retry = receive_count < MAX_JOB_ATTEMPTS
            store.set_status(session, job, "queued" if retry else "failed")
            if retry or sqs_delivery:
                raise


def execute_local(job):
    for attempt in range(MAX_JOB_ATTEMPTS):
        deadline = time.monotonic() + EXECUTION_TIMEOUT_SECONDS
        context = SimpleNamespace(
            get_remaining_time_in_millis=lambda deadline=deadline: max(
                0, int((deadline - time.monotonic()) * 1000)
            )
        )
        try:
            execute(job, context, receive_count=attempt + 1)
            return
        except Exception:
            if attempt + 1 < MAX_JOB_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)
            else:
                with creation_store.execution_session(job.simulation_id) as session:
                    store.set_status(session, job, "failed")
