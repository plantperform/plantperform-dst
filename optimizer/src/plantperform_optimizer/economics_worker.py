"""Explicit economics recalculation, preserving simulation identities and choices."""

import logging
import time
from copy import deepcopy
from types import SimpleNamespace

from sqlalchemy import select, update

from app.data import creation_store, read_model_store, repository, simulation_store
from app.data import economics_recalculation_store as store
from app.data.db import simulation_field_candidates_table as caches
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.data.optimizer_inputs import optimizer_input
from app.domain.economics import EconomicsRecalculationJob
from app.domain.optimization import (
    EXECUTION_TIMEOUT_SECONDS,
    MAX_JOB_ATTEMPTS,
    RETRY_DELAY_SECONDS,
    OptimizationAttemptsExhaustedError,
)
from app.domain.rotation_candidate import SimulationFieldCandidates
from app.domain.simulation import Simulation
from app.services.economics.db_calculator import clear_lookup_cache
from app.services.economics.recalculation import recalculate_candidate, recalculate_document

logger = logging.getLogger(__name__)


def _deadline(context):
    if context.get_remaining_time_in_millis() < 10_000:
        raise TimeoutError("Economics recalculation deadline reached")


def _execute(session, job, context):
    with session.begin():
        row = store.locked_setup(session, job)
        if row is None or row.creation_status != "running":
            return False
        simulation = Simulation.model_validate(row.data)
        output = (
            session.execute(
                select(results.c.output).where(results.c.simulation_id == job.simulation_id)
            ).scalar_one()
            or {}
        )
        original_fields = simulation_store._fields(session, job.simulation_id)
        setup_fields = deepcopy(row.fields)
        field_ids = list(row.field_order)
    field_map = {f.id: f for f in original_fields}
    selected = deepcopy(output.get("selected_candidates", {}))
    for field_id in field_ids:
        _deadline(context)
        with session.begin():
            if store.locked_setup(session, job) is None:
                return False
            cached = session.execute(
                select(caches.c.data).where(
                    caches.c.simulation_id == job.simulation_id, caches.c.field_id == field_id
                )
            ).scalar_one_or_none()
        field = field_map[field_id]
        setup = setup_fields[field_id]
        baseline = setup.get("baseline_candidate")
        if field.rotation_id is None and baseline is None and field.crop_rotation:
            with session.begin():
                if store.locked_setup(session, job) is None:
                    return False
                registry = repository._registry_context_for_imk_id(session, field.imk_id)
            value = repository.baseline_simulation_candidate(field, registry)
            baseline = value.model_dump(mode="json") if value else None
        if baseline is not None:
            baseline = recalculate_document(
                baseline, simulation, job.snapshot, baseline["years"][0]["db_detail"].get("jbnr", 4)
            )
            setup["baseline_candidate"] = baseline
            if field.rotation_id is None:
                field_map[field_id] = field.model_copy(
                    update=dict(
                        db2=baseline["avg_db_kr_ha"] * field.area_ha,
                        fen=baseline["avg_fen"] * field.area_ha,
                    )
                )
                setup["baseline"].update(db2=field_map[field_id].db2, fen=field_map[field_id].fen)
                setup["baseline_revision"] = job.expected_revision
        if cached is None:
            continue
        data = SimulationFieldCandidates.model_validate(cached)
        recalculated = []
        for candidate in data.candidates:
            _deadline(context)
            recalculated.append(
                recalculate_candidate(candidate, simulation, job.snapshot, data.jbnr)
            )
        data.candidates = recalculated
        setup = setup_fields[field_id]
        for name in ("fixed_candidate", "manual_candidate", "economics_candidate"):
            if setup.get(name):
                setup[name] = recalculate_document(setup[name], simulation, job.snapshot, data.jbnr)
        if field_id in selected:
            selected[field_id] = recalculate_document(
                selected[field_id], simulation, job.snapshot, data.jbnr
            )
        if field_id in selected:
            setup["economics_candidate"] = selected[field_id]
        field = field_map[field_id]
        merged = simulation_store.merge_setup_candidates(data, selected.get(field_id), setup)
        chosen = next((c for c in merged.candidates if c.ref.to_id() == field.rotation_id), None)
        if chosen:
            field = field.model_copy(
                update=dict(
                    db2=chosen.avg_db_kr_ha * field.area_ha, fen=chosen.avg_fen * field.area_ha
                )
            )
            field_map[field_id] = field
            if field.allowed_rotation_ids:
                setup["fixed"] = {
                    k: field.model_dump(mode="json")[k] for k in simulation_store.OUTPUT_KEYS
                }
            else:
                setup["baseline"] = {
                    k: field.model_dump(mode="json")[k] for k in simulation_store.OUTPUT_KEYS
                }
                setup["baseline_revision"] = job.expected_revision
        _deadline(context)
        with session.begin():
            if store.locked_setup(session, job) is None:
                return False
            session.execute(
                update(caches)
                .where(caches.c.simulation_id == job.simulation_id, caches.c.field_id == field_id)
                .values(data=data.model_dump(mode="json"), optimizer_input=optimizer_input(data))
            )
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
