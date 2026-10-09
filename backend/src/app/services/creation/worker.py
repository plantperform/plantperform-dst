"""Create candidates from current inputs on every attempt, with bounded per-field memory."""

import logging
import time
from datetime import UTC, datetime
from types import SimpleNamespace

from sqlalchemy import select, update

from app.data import creation_store, repository, simulation_store
from app.data.db import simulation_result_table as results
from app.data.optimizer_inputs import optimizer_input_json
from app.domain.creation_job import CreationJob, optimization_run_id
from app.domain.optimization import (
    EXECUTION_TIMEOUT_SECONDS,
    MAX_JOB_ATTEMPTS,
    RETRY_DELAY_SECONDS,
    OptimizationAttemptsExhaustedError,
    OptimizeSimulationRequest,
)
from app.domain.soil import MissingSoilDataError
from app.services.optimization import jobs as optimization_jobs
from app.services.optimization.crop_area_ranges import crop_area_ranges
from app.services.scenario.candidate_evaluator import prepare_candidates

logger = logging.getLogger(__name__)


def _check_deadline(context):
    if context.get_remaining_time_in_millis() < 10_000:
        raise TimeoutError("Creation execution deadline reached")


def _optimization_error(session, job):
    simulation_id, request = job.simulation_id, job.parameters
    if not request.optimize_on_create or not request.constraints.crop_area_limits:
        return None
    with session.begin():
        if creation_store.locked_setup(session, job) is None:
            return None
        fields = simulation_store._fields(session, simulation_id)
        candidates = simulation_store._candidates(session, simulation_id, compact=True)
    ranges = {
        r.afgrode_kode: r
        for r in crop_area_ranges(
            fields,
            {row.field_id: row.candidates for row in candidates},
        )
    }
    violations = []
    for limit in request.constraints.crop_area_limits:
        area = ranges.get(limit.afgrode_kode)
        lowest_max = min(area.min_average_ha, max(area.min_ha_by_year)) if area else 0
        highest_min = (
            max(area.max_average_ha, min(min(area.max_ha_by_year), area.yearly_max_average_ha))
            if area
            else 0
        )
        if (limit.min_area_ha is not None and limit.min_area_ha > highest_min + 0.005) or (
            area is not None
            and limit.max_area_ha is not None
            and limit.max_area_ha < lowest_max - 0.005
        ):
            violations.append({"cropCode": limit.afgrode_kode, "years": []})
    if violations:
        return {
            "code": "INFEASIBLE",
            "message": (
                "De kopierede afgrødekrav kan ikke opfyldes med simuleringens sædskifter. "
                "Ret dem under Regler, før du kører Optimér."
            ),
            "detail": {"cropAreaViolations": violations},
        }
    return None


def handoff(session, job, *, sqs_delivery):
    """The reserved optimization result is the durable publication marker."""
    started = time.monotonic()
    run_id = optimization_run_id(job.simulation_id, job.expected_revision)
    with session.begin():
        row = creation_store.locked_setup(session, job)
        if row is None or row.creation_status != "done":
            return None
        result = session.execute(
            select(
                results.c.parameters, results.c.run_id, results.c.status, results.c.published_at
            ).where(results.c.simulation_id == job.simulation_id)
        ).one()
        if result.run_id != run_id or result.status != "queued" or result.published_at is not None:
            return None
    tasks = None
    if not sqs_delivery:
        from fastapi import BackgroundTasks

        tasks = BackgroundTasks()
    try:
        optimization_jobs.submit(
            job.farm_id,
            job.simulation_id,
            job.requested_by,
            "optimize",
            OptimizeSimulationRequest.model_validate(result.parameters),
            background_tasks=tasks,
            transport="sqs" if sqs_delivery else "local",
        )
    except (
        optimization_jobs.QueueUnavailableError,
        optimization_jobs.SubmissionConflictError,
        optimization_jobs.SimulationNotFoundError,
    ) as error:
        # Creation succeeded; expose follow-up failure through optimization state.
        with session.begin():
            if creation_store.locked_setup(session, job) is not None:
                session.execute(
                    update(results)
                    .where(
                        results.c.simulation_id == job.simulation_id,
                        results.c.run_id == run_id,
                        results.c.status == "queued",
                    )
                    .values(
                        status="failed",
                        finished_at=datetime.now(UTC),
                        error={"code": "QUEUE_UNAVAILABLE", "message": str(error)},
                    )
                )
    logger.info(
        "creation_handoff simulation_id=%s duration_seconds=%.3f",
        job.simulation_id,
        time.monotonic() - started,
    )
    return tasks


def _generate(session, job, context, *, sqs_delivery, receive_count):
    try:
        loading = time.monotonic()
        loaded = creation_store.start_attempt(session, job)
        if loaded is None:
            return False
        fields, contexts = loaded
        request = job.parameters
        logger.info(
            "creation_inputs_loaded simulation_id=%s field_count=%s duration_seconds=%.3f",
            job.simulation_id,
            len(fields),
            time.monotonic() - loading,
        )
        _check_deadline(context)
        prepared = prepare_candidates(
            request.saedskiftevarianter,
            request.n_norm_procenter,
            request.tidlig_saaning,
            request.mellemafgrode,
        )
        for index, field in enumerate(fields):
            _check_deadline(context)
            phase = time.monotonic()
            setup, candidates = repository.prepare_simulation_field(
                field, contexts.get(field.imk_id), request, prepared=prepared
            )
            generation = time.monotonic() - phase
            phase = time.monotonic()
            full_json = candidates.model_dump_json() if candidates.candidates else None
            compact_json = optimizer_input_json(candidates) if candidates.candidates else None
            serialization = time.monotonic() - phase
            _check_deadline(context)
            phase = time.monotonic()
            if not creation_store.checkpoint(
                session, job, field.id, setup, full_json, compact_json
            ):
                return False
            logger.info(
                "creation_field simulation_id=%s field_index=%s candidate_count=%s "
                "generation_seconds=%.3f serialization_seconds=%.3f persistence_seconds=%.3f",
                job.simulation_id,
                index,
                len(candidates.candidates),
                generation,
                serialization,
                time.monotonic() - phase,
            )
            del candidates, full_json, compact_json, setup
        _check_deadline(context)
        error = _optimization_error(session, job)
        _check_deadline(context)
        return creation_store.complete(session, job, optimization_error=error)
    except (MissingSoilDataError, ValueError):
        logger.exception("creation_invalid_input simulation_id=%s", job.simulation_id)
        creation_store.fail(session, job)
        return False
    except Exception:
        logger.exception(
            "creation_attempt_failed simulation_id=%s job_id=%s", job.simulation_id, job.job_id
        )
        retry = receive_count < MAX_JOB_ATTEMPTS
        saved = creation_store.fail(session, job, retry=retry)
        if not saved:
            if session.get_bind().invalidated:
                raise  # Do not write through a replacement connection without its lock.
            return False  # Deleted or superseded while calculating this field.
        if retry or sqs_delivery:
            raise
        return False


def execute(job, context, *, sqs_delivery=False, receive_count=1):
    job = CreationJob.model_validate(job)
    started = time.monotonic()
    tasks = None
    try:
        with creation_store.execution_session(job.simulation_id) as session:
            row = creation_store.claim(session, job)
            if row is None:
                return
            if row.creation_status == "failed":
                if sqs_delivery and receive_count >= MAX_JOB_ATTEMPTS:
                    raise OptimizationAttemptsExhaustedError("Creation attempts exhausted")
                return
            if row.creation_status != "done" and receive_count > MAX_JOB_ATTEMPTS:
                creation_store.fail(session, job)
                if sqs_delivery:
                    raise OptimizationAttemptsExhaustedError("Creation attempts exhausted")
                return
            if row.creation_status != "done" and not _generate(
                session, job, context, sqs_delivery=sqs_delivery, receive_count=receive_count
            ):
                return
            tasks = handoff(session, job, sqs_delivery=sqs_delivery)
        # Release the creation connection before running the local optimizer.
        if tasks is not None and tasks.tasks:
            import anyio

            anyio.run(tasks)
    finally:
        logger.info(
            "creation_finished simulation_id=%s job_id=%s duration_seconds=%.3f",
            job.simulation_id,
            job.job_id,
            time.monotonic() - started,
        )


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
            logger.exception("local_creation_attempt_failed simulation_id=%s", job.simulation_id)
            if attempt + 1 < MAX_JOB_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)
            else:
                creation_store.recover_local_job(job)
