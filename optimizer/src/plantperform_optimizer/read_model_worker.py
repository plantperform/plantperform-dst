"""Queued history calculations and compact simulation-view backfills."""

import logging
import time
from types import SimpleNamespace

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from app.data import creation_store, read_model_store, repository
from app.data.db import farm_read_model_table as farm_views
from app.data.db import farm_table, field_table
from app.data.db import field_historical_detail_table as details
from app.data.db import simulation_read_model_table as simulation_views
from app.data.db import simulation_table as setups
from app.domain.field import FieldRecord
from app.domain.optimization import (
    EXECUTION_TIMEOUT_SECONDS,
    MAX_JOB_ATTEMPTS,
    RETRY_DELAY_SECONDS,
    OptimizationAttemptsExhaustedError,
)
from app.domain.read_model import PreparationJob
from app.domain.soil import MissingSoilDataError
from app.services.read_models import compact_years, yearly_totals

logger = logging.getLogger(__name__)


def _tables(job):
    if job.job_type == "prepare_farm_history":
        return farm_table, farm_views, farm_views.c.farm_id
    return setups, simulation_views, simulation_views.c.simulation_id


def _locked(session, job):
    if session.get_bind().invalidated:
        raise RuntimeError("Preparation database connection was lost")
    owner, table, key = _tables(job)
    columns = [owner.c.revision]
    if owner is setups:
        columns.extend([owner.c.farm_id, owner.c.creation_status])
    row = session.execute(
        select(*columns).where(owner.c.id == job.entity_id).with_for_update()
    ).first()
    if row is None or row.revision != job.expected_revision:
        return None
    if owner is setups and (row.farm_id != job.farm_id or row.creation_status != "done"):
        return None
    view = session.execute(
        select(table.c.status, table.c.input_revision, table.c.generation, table.c.error)
        .where(key == job.entity_id)
        .with_for_update()
    ).first()
    if (
        view is None
        or view.input_revision != job.expected_revision
        or view.generation != job.generation
    ):
        return None
    return view


def _check_deadline(context):
    if context.get_remaining_time_in_millis() < 10_000:
        raise TimeoutError("Preparation deadline reached")


def _history(session, job, context):
    from app.services.economics import db_calculator
    from app.services.nles5.bridge_v2 import evaluate_leaching_position
    from app.services.rotations import afgroede_normer, afstromning, historisk_goedning
    from app.services.scenario.candidate_evaluator import compute_n_inputs

    # Lambda processes may outlive registry/reference-data imports.
    db_calculator.clear_lookup_cache()
    afgroede_normer.clear_lookup_cache()
    afstromning.clear_lookup_cache()
    historisk_goedning.clear_historisk_goedning_cache()
    compute_n_inputs.cache_clear()
    evaluate_leaching_position.cache_clear()
    with session.begin():
        if _locked(session, job) is None:
            return
        fields = [
            FieldRecord.model_validate(data)
            for data in session.execute(
                select(field_table.c.data)
                .where(field_table.c.farm_id == job.farm_id)
                .order_by(field_table.c.created_at, field_table.c.id)
            ).scalars()
        ]
        contexts = repository._registry_contexts_for_imk_ids(
            session,
            list({field.imk_id for field in fields if field.imk_id is not None}),
        )
    updated, field_years, rich = [], {}, {}
    for field in fields:
        _check_deadline(context)
        context_row = contexts.get(field.imk_id)
        years = repository._historical_years_for_context(context_row)
        count = len(years)
        candidate = SimpleNamespace(years=years, active_len=count)
        field_years[field.id] = compact_years(candidate)
        rich[field.id] = [year.model_dump(mode="json") for year in years]
        leaching = sum(year.leaching_kg_n_ha for year in years) / count * field.area_ha
        updated.append(
            field.model_copy(
                update={
                    "crop_rotation": [year.year for year in years],
                    "db2": sum(year.db_kr_ha for year in years) / count * field.area_ha,
                    "leaching": leaching,
                    "n_load": leaching * (1 - (field.retention or 0) / 100),
                    "fen": sum(year.fen_fe_ha for year in years) / count * field.area_ha,
                    "kvotegivende": bool(context_row.kvotegivende),
                    "jbnr": context_row.jbnr if context_row.jbnr is not None else field.jbnr,
                }
            )
        )
    data = {
        "fields": [field.model_dump(mode="json") for field in updated],
        "field_years": field_years,
        "yearly_summary": yearly_totals(updated, field_years, history=True),
    }
    _check_deadline(context)
    with session.begin():
        state = _locked(session, job)
        if state is None or state.status != "running":
            return
        for field in updated:
            session.execute(
                update(field_table)
                .where(field_table.c.id == field.id, field_table.c.farm_id == job.farm_id)
                .values(data=field.model_dump(mode="json"))
            )
            session.execute(
                insert(details)
                .values(
                    field_id=field.id,
                    input_revision=job.expected_revision,
                    years=rich[field.id],
                )
                .on_conflict_do_update(
                    index_elements=[details.c.field_id],
                    set_={
                        "input_revision": job.expected_revision,
                        "years": rich[field.id],
                    },
                )
            )
        session.execute(
            update(farm_views)
            .where(farm_views.c.farm_id == job.farm_id)
            .values(
                status="done",
                data=data,
                error=None,
                view_version=farm_views.c.view_version + 1,
            )
        )


def _simulation(session, job, context):
    # No source locks during the potentially large scan. The final revision check
    # rejects a snapshot whose setup or successful result changed while preparing.
    from app.data.db import simulation_result_table as results

    with session.begin():
        state = session.execute(
            select(results.c.run_id, results.c.result_revision, results.c.status).where(
                results.c.simulation_id == job.simulation_id
            )
        ).one()
        data, prepared = read_model_store.build_simulation(session, job.simulation_id)
    _check_deadline(context)
    with session.begin():
        view = _locked(session, job)
        if view is None or view.status != "running":
            return
        current = session.execute(
            select(results.c.run_id, results.c.result_revision, results.c.status)
            .where(results.c.simulation_id == job.simulation_id)
            .with_for_update()
        ).one()
        if current != state:
            raise RuntimeError("Simulation result changed during view preparation")
        read_model_store.publish_simulation(
            session, job.simulation_id, job.expected_revision, data, prepared
        )


def _fail(session, job, error, retry):
    with session.begin():
        state = _locked(session, job)
        if state is not None and state.status != "done":
            _, table, key = _tables(job)
            session.execute(
                update(table)
                .where(key == job.entity_id)
                .values(
                    status="queued" if retry else "failed",
                    view_version=table.c.view_version + 1,
                    error={
                        "code": "INVALID_INPUT"
                        if isinstance(error, (MissingSoilDataError, ValueError))
                        else "PREPARATION_FAILED",
                        "message": "Beregningsdata kunne ikke forberedes. Prøv igen.",
                    },
                )
            )


def execute(job, context, *, sqs_delivery=False, receive_count=1):
    job = PreparationJob.model_validate(job)
    scope = (
        f"farm-history:{job.farm_id}"
        if job.job_type == "prepare_farm_history"
        else job.simulation_id
    )
    started = time.monotonic()
    try:
        with creation_store.execution_session(scope) as session:
            with session.begin():
                state = _locked(session, job)
                if state is None or state.status == "done":
                    return
                if state.status == "failed":
                    if sqs_delivery and (state.error or {}).get("code") != "INVALID_INPUT":
                        raise OptimizationAttemptsExhaustedError("Preparation attempts exhausted")
                    return
                _, table, key = _tables(job)
                exhausted = receive_count > MAX_JOB_ATTEMPTS
                session.execute(
                    update(table)
                    .where(key == job.entity_id)
                    .values(
                        status="failed" if exhausted else "running",
                        view_version=table.c.view_version + 1,
                        error={
                            "code": "PREPARATION_FAILED",
                            "message": "Beregningsdata kunne ikke forberedes.",
                        }
                        if exhausted
                        else None,
                    )
                )
            if exhausted:
                if sqs_delivery:
                    raise OptimizationAttemptsExhaustedError("Preparation attempts exhausted")
                return
            try:
                if job.job_type == "prepare_farm_history":
                    _history(session, job, context)
                else:
                    _simulation(session, job, context)
            except (MissingSoilDataError, ValueError) as error:
                _fail(session, job, error, False)
                logger.exception("preparation_invalid_inputs entity_id=%s", job.entity_id)
            except Exception as error:
                retry = receive_count < MAX_JOB_ATTEMPTS
                if session.get_bind().invalidated:
                    raise
                session.rollback()
                _fail(session, job, error, retry)
                if retry or sqs_delivery:
                    raise
    finally:
        logger.info(
            "preparation_finished job_type=%s entity_id=%s revision=%s duration_seconds=%.3f",
            job.job_type,
            job.entity_id,
            job.expected_revision,
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
            logger.exception("local_preparation_attempt_failed entity_id=%s", job.entity_id)
            if attempt + 1 < MAX_JOB_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)
