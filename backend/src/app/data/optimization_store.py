"""Execution leases and recovery. Always lock setup before result."""

import logging
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import func, select, update

from app.data.db import SessionLocal
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.data.simulation_store import _fields
from app.domain.optimization import (
    LEASE_DURATION_SECONDS,
    MAX_JOB_ATTEMPTS,
    RETRY_DELAY_SECONDS,
    OptimizationAttemptsExhaustedError,
    OptimizationLeaseActiveError,
)

logger = logging.getLogger(__name__)


def publication_clock():
    """Use the publisher's database clock for the worker's shutdown barrier."""
    with SessionLocal() as session:
        return session.scalar(select(func.clock_timestamp()))


def queued_publication_since(since):
    with SessionLocal() as session:
        return (
            session.scalar(
                select(results.c.simulation_id)
                .where(results.c.status == "queued", results.c.published_at >= since)
                .limit(1)
            )
            is not None
        )


def fail_queued_run(simulation_id, run_id):
    """Initialization failure cannot overwrite a replacement or already claimed run."""
    with SessionLocal.begin() as session:
        if (
            session.execute(
                select(setups.c.id).where(setups.c.id == simulation_id).with_for_update()
            ).first()
            is None
        ):
            return
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
                    "code": "WORKER_ERROR",
                    "message": "Optimeringen kunne ikke starte. Prøv igen.",
                },
            )
        )


def _raise_if_exhausted(row):
    if (
        row.status == "failed"
        and row.attempts >= MAX_JOB_ATTEMPTS
        and (row.error or {}).get("code") == "WORKER_ERROR"
    ):
        raise OptimizationAttemptsExhaustedError("The optimization attempt limit was reached")


def check_delivery_state(simulation_id, run_id):
    """Only acknowledge a rejected write when this delivery no longer needs execution."""
    with SessionLocal() as session:
        row = session.execute(
            select(
                results.c.status,
                results.c.attempts,
                results.c.error,
                results.c.lease_expires_at,
            )
            .join(setups, setups.c.id == results.c.simulation_id)
            .where(
                results.c.simulation_id == simulation_id,
                results.c.run_id == run_id,
                results.c.input_revision == setups.c.revision,
            )
        ).first()
    if row is None:
        return
    _raise_if_exhausted(row)
    if row.status == "in_progress" and row.lease_expires_at is not None:
        raise OptimizationLeaseActiveError(row.lease_expires_at)
    if row.status in ("queued", "in_progress"):
        raise RuntimeError("The optimization run still requires execution")


def claim(simulation_id, run_id, *, sqs_delivery=False, farm_id=None):
    with SessionLocal.begin() as session:
        setup = session.execute(
            select(setups.c.id, setups.c.farm_id, setups.c.revision)
            .where(setups.c.id == simulation_id)
            .with_for_update()
        ).first()
        if setup is None:
            return None
        if farm_id is not None and setup.farm_id != farm_id:
            raise ValueError("Optimization message farm does not match the simulation")
        row = session.execute(
            select(*[c for c in results.c if c.name != "output"])
            .where(results.c.simulation_id == simulation_id)
            .with_for_update()
        ).one()
        if row.run_id != run_id or row.input_revision != setup.revision:
            return None
        if sqs_delivery:
            _raise_if_exhausted(row)
        if row.status not in ("queued", "in_progress"):
            return None
        now = datetime.now(UTC)
        if row.status == "in_progress":
            if row.lease_expires_at is None:
                raise RuntimeError("The active optimization run has no execution lease")
            if row.lease_expires_at >= now:
                if sqs_delivery:
                    raise OptimizationLeaseActiveError(row.lease_expires_at)
                return None
        if row.attempts >= MAX_JOB_ATTEMPTS:
            session.execute(
                update(results)
                .where(results.c.simulation_id == simulation_id)
                .values(
                    status="failed",
                    lease_token=None,
                    lease_expires_at=None,
                    finished_at=datetime.now(UTC),
                    error={
                        "code": "WORKER_ERROR",
                        "message": "Optimeringen nåede det maksimale antal forsøg. Prøv igen.",
                    },
                )
            )
        else:
            token = str(uuid4())
            session.execute(
                update(results)
                .where(results.c.simulation_id == simulation_id)
                .values(
                    status="in_progress",
                    started_at=now,
                    lease_token=token,
                    lease_expires_at=now + timedelta(seconds=LEASE_DURATION_SECONDS),
                    attempts=row.attempts + 1,
                )
            )
            return dict(row._mapping), setup.farm_id, token
    # Commit the terminal status before reporting an unsuccessful SQS delivery.
    if sqs_delivery:
        raise OptimizationAttemptsExhaustedError("The optimization attempt limit was reached")
    return None


def _execution_setup(session, simulation_id, run_id, token, revision, *, include_data=False):
    setup = session.execute(
        select(
            *(
                [setups.c.data, setups.c.revision, setups.c.creation_status]
                if include_data
                else [setups.c.revision]
            )
        )
        .where(setups.c.id == simulation_id)
        .with_for_update()
    ).first()
    if setup is None or setup.revision != revision:
        return None
    row = session.execute(
        select(
            results.c.run_id,
            results.c.status,
            results.c.input_revision,
            results.c.lease_token,
            results.c.lease_expires_at,
        )
        .where(results.c.simulation_id == simulation_id)
        .with_for_update()
    ).one()
    if (
        row.run_id != run_id
        or row.lease_token != token
        or row.input_revision != revision
        or row.status != "in_progress"
        or row.lease_expires_at is None
        or row.lease_expires_at < datetime.now(UTC)
    ):
        return None
    return setup


def load_snapshot(simulation_id, run_id, token, revision):
    """Capture stable fields and small registry context, never read candidate caches."""
    from copy import deepcopy

    from app.data import read_model_store, repository
    from app.data.db import field_table
    from app.data.simulation_store import split_field
    from app.domain.field import FieldRecord
    from app.domain.simulation import Simulation

    with SessionLocal.begin() as session:
        setup = _execution_setup(session, simulation_id, run_id, token, revision, include_data=True)
        if setup is None:
            return None
        state = session.execute(
            select(setups.c.fields, setups.c.field_order, results.c.parameters)
            .join(results)
            .where(setups.c.id == simulation_id)
        ).one()
        data = dict(setup.data)
        captured = state.parameters.get("simulation_settings", data)
        simulation = Simulation.model_validate(
            {**captured, "name": data["name"], "revision": revision}
        )
        setup_fields = deepcopy(state.fields)
        order = list(state.field_order)
        if not data.get("fields_initialized", True):
            read_model_store.require_farm_ready(session, simulation.farm_id)
            original = (
                session.execute(
                    select(field_table.c.data)
                    .where(field_table.c.farm_id == simulation.farm_id)
                    .order_by(field_table.c.created_at, field_table.c.id)
                )
                .scalars()
                .all()
            )
            fields = [
                FieldRecord.model_validate(value).model_copy(update={"id": str(uuid4())})
                for value in original
            ]
            setup_fields = {
                field.id: split_field(field.model_dump(mode="json")) for field in fields
            }
            order = [field.id for field in fields]
            data["fields_initialized"] = True
        else:
            fields = _fields(session, simulation_id)
        missing = [field for field in fields if "calculation_context" not in setup_fields[field.id]]
        registry = repository._registry_contexts_for_imk_ids(
            session, list({field.imk_id for field in missing if field.imk_id is not None})
        )
        for field in missing:
            context = registry.get(field.imk_id)
            setup_fields[field.id]["calculation_context"] = (
                dict(context._mapping) if context else None
            )
        session.execute(
            update(setups)
            .where(setups.c.id == simulation_id)
            .values(fields=setup_fields, field_order=order, data=data)
        )
        if not simulation.fields_initialized:
            # Failures on the first attempt still leave the fields available for correction.
            read_model_store.publish_simulation(
                session,
                simulation_id,
                revision,
                {
                    "fields": [f.model_dump(mode="json") for f in fields],
                    "field_years": {},
                    "yearly_summary": [],
                    "crop_area_ranges": [],
                    "saved_result": None,
                    "comparison_availability": {"kind": "uncalculated"},
                },
                {"version": 3, "contributions": {}},
            )
        contexts = {field.id: setup_fields[field.id].get("calculation_context") for field in fields}
        return simulation, fields, setup_fields, contexts


def finish(
    simulation_id,
    run_id,
    token,
    revision,
    *,
    output=None,
    error=None,
    retry=False,
    setup_fields=None,
):
    with SessionLocal.begin() as session:
        setup = session.execute(
            select(setups.c.revision).where(setups.c.id == simulation_id).with_for_update()
        ).first()
        if setup is None or setup.revision != revision:
            return False
        row = session.execute(
            select(results).where(results.c.simulation_id == simulation_id).with_for_update()
        ).one()
        if (
            row.run_id != run_id
            or row.lease_token != token
            or row.input_revision != revision
            or row.status != "in_progress"
            or row.lease_expires_at < datetime.now(UTC)
        ):
            return False
        values = dict(
            status="queued" if retry else "failed" if error else "completed",
            lease_token=None,
            lease_expires_at=None,
            finished_at=None if retry else datetime.now(UTC),
            error=error,
        )
        if output is not None:
            # Keep successful provenance when later submissions replace result.run_id.
            output = {**output, "run_id": run_id, "result_revision": revision}
            values.update(output=output, result_revision=revision)
        session.execute(
            update(results).where(results.c.simulation_id == simulation_id).values(**values)
        )
        if output is not None:
            if setup_fields is not None:
                session.execute(
                    update(setups).where(setups.c.id == simulation_id).values(fields=setup_fields)
                )
            from app.data.read_model_store import publish_optimization

            publish_optimization(session, simulation_id, revision, run_id, output)
        return True


def recover_local_optimization_runs():
    """Mark interrupted local optimization runs failed at backend startup."""
    with SessionLocal() as session:
        rows = session.execute(
            select(results.c.simulation_id, results.c.run_id).where(
                results.c.status.in_(("queued", "in_progress"))
            )
        ).all()
    for row in rows:
        recover_run(row.simulation_id, row.run_id, interrupted=True)


def recover_run(simulation_id, run_id, *, dead_letter=False, interrupted=False):
    with SessionLocal.begin() as session:
        if (
            session.execute(
                select(setups.c.id).where(setups.c.id == simulation_id).with_for_update()
            ).first()
            is None
        ):
            return
        row = session.execute(
            select(results).where(results.c.simulation_id == simulation_id).with_for_update()
        ).one()
        now = datetime.now(UTC)
        if row.run_id != run_id or row.status not in ("queued", "in_progress"):
            return
        if row.status == "in_progress":
            expired = row.lease_expires_at is not None and row.lease_expires_at < now
        else:
            expired = (
                dead_letter
                or (
                    row.published_at is None
                    and row.queued_at < now - timedelta(seconds=RETRY_DELAY_SECONDS)
                )
                or row.queued_at < now - timedelta(days=4)
            )
        if interrupted or expired:
            session.execute(
                update(results)
                .where(results.c.simulation_id == simulation_id)
                .values(
                    status="failed",
                    lease_token=None,
                    lease_expires_at=None,
                    finished_at=now,
                    error={
                        "code": "WORKER_LOST",
                        "message": "Optimeringen kunne ikke fuldføres. Prøv igen.",
                    },
                )
            )
