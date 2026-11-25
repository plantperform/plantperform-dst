"""Execution leases and recovery. Always lock setup before result."""

import logging
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import Text, literal, select, update

from app.data import read_model_store, repository, saedskifte_store
from app.data.db import SessionLocal, field_table
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.data.simulation_store import _fields, split_field
from app.domain.field import FieldRecord
from app.domain.optimization import (
    ACTIVE_STATUSES,
    LARGE_ACTIVE_STATUSES,
    LEASE_DURATION_SECONDS,
    RETRY_DELAY_SECONDS,
    RUNNING_STATUSES,
    DeliveryOutcome,
    ExecutionResult,
    OptimizationAttemptsExhaustedError,
    OptimizationLeaseActiveError,
    OptimizationTerminalError,
    attempt_limit,
    effective_result_status,
    worker_tier,
)
from app.domain.simulation import Simulation

logger = logging.getLogger(__name__)


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


def _stored_status(row):
    return effective_result_status(row.status, (row.error or {}).get("code"))


def _raise_if_exhausted(row):
    if (
        row.status == "failed"
        and row.attempts >= attempt_limit(worker_tier(row.status, row.error))
        and (row.error or {}).get("code") == "WORKER_ERROR"
    ):
        raise OptimizationAttemptsExhaustedError(row.error)
    if _stored_status(row) == "failed":
        raise OptimizationTerminalError(
            row.error or {"code": "WORKER_ERROR", "message": "Optimeringen fejlede."}
        )


def check_delivery_state(simulation_id, run_id, tier="standard"):
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
    if worker_tier(row.status, row.error) != tier:
        if tier == "standard" and row.status == "queued_large":
            raise RuntimeError("The large queue handoff still requires confirmation")
        return
    _raise_if_exhausted(row)
    if row.status in RUNNING_STATUSES and row.lease_expires_at is not None:
        raise OptimizationLeaseActiveError(row.lease_expires_at)
    if row.status in ACTIVE_STATUSES:
        raise RuntimeError("The optimization run still requires execution")


def delivery_result(simulation_id, run_id, farm_id, tier="standard"):
    """Resolve redelivery without starting the optimizer or incrementing attempts."""
    with SessionLocal() as session:
        row = session.execute(
            select(
                setups.c.farm_id,
                setups.c.revision,
                results.c.run_id,
                results.c.input_revision,
                results.c.published_at,
                results.c.status,
                results.c.error,
                results.c.lease_expires_at,
            )
            .join(results, results.c.simulation_id == setups.c.id)
            .where(setups.c.id == simulation_id)
        ).first()
    if row is None:
        return ExecutionResult(DeliveryOutcome.ACK)
    if row.farm_id != farm_id:
        return ExecutionResult(
            DeliveryOutcome.DEAD_LETTER,
            error={"code": "INVALID_INPUT", "message": "Optimization message farm does not match"},
        )
    if row.run_id != run_id or row.input_revision != row.revision:
        return ExecutionResult(DeliveryOutcome.ACK)
    if worker_tier(row.status, row.error) != tier:
        if tier == "standard" and row.status == "queued_large":
            outcome = (
                DeliveryOutcome.FORWARD_LARGE
                if row.published_at is None
                else DeliveryOutcome.WAKE_LARGE
            )
            return ExecutionResult(outcome)
        return ExecutionResult(DeliveryOutcome.ACK)
    if _stored_status(row) == "failed":
        return ExecutionResult(
            DeliveryOutcome.DEAD_LETTER,
            error=row.error or {"code": "WORKER_ERROR", "message": "Optimeringen fejlede."},
        )
    if row.status not in ACTIVE_STATUSES:
        return ExecutionResult(DeliveryOutcome.ACK)
    if (
        row.status in RUNNING_STATUSES
        and row.lease_expires_at is not None
        and row.lease_expires_at >= datetime.now(UTC)
    ):
        raise OptimizationLeaseActiveError(row.lease_expires_at)
    return None


def claim(simulation_id, run_id, *, sqs_delivery=False, farm_id=None, tier="standard"):
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
            # The supervisor passes only request options to the capped child.
            # load_snapshot reads the captured simulation settings under its lease.
            select(
                *[c for c in results.c if c.name not in ("output", "parameters")],
                results.c.parameters.op("-")(literal("simulation_settings", type_=Text)).label(
                    "parameters"
                ),
            )
            .where(results.c.simulation_id == simulation_id)
            .with_for_update()
        ).one()
        if row.run_id != run_id or row.input_revision != setup.revision:
            return None
        if worker_tier(row.status, row.error) != tier:
            return None
        if sqs_delivery:
            _raise_if_exhausted(row)
        if row.status not in ACTIVE_STATUSES:
            return None
        now = datetime.now(UTC)
        if row.status in RUNNING_STATUSES:
            if row.lease_expires_at is None:
                raise RuntimeError("The active optimization run has no execution lease")
            if row.lease_expires_at >= now:
                if sqs_delivery:
                    raise OptimizationLeaseActiveError(row.lease_expires_at)
                return None
        if row.attempts >= attempt_limit(tier):
            error = {
                "code": "WORKER_ERROR",
                "message": "Optimeringen nåede det maksimale antal forsøg. Prøv igen.",
            }
            if tier == "large":
                error["worker_tier"] = "large"
            session.execute(
                update(results)
                .where(results.c.simulation_id == simulation_id)
                .values(
                    status="failed",
                    lease_token=None,
                    lease_expires_at=None,
                    finished_at=datetime.now(UTC),
                    error=error,
                )
            )
        else:
            token = str(uuid4())
            session.execute(
                update(results)
                .where(results.c.simulation_id == simulation_id)
                .values(
                    status="in_progress_large" if tier == "large" else "in_progress",
                    started_at=now,
                    lease_token=token,
                    lease_expires_at=now + timedelta(seconds=LEASE_DURATION_SECONDS),
                    attempts=row.attempts + 1,
                    # Receipt by the large worker also confirms an ambiguous send.
                    published_at=(row.published_at or now) if tier == "large" else row.published_at,
                )
            )
            return dict(row._mapping), setup.farm_id, token
    # Commit the terminal status before reporting an unsuccessful SQS delivery.
    if sqs_delivery:
        raise OptimizationAttemptsExhaustedError(error)
    return None


def promote_to_large(simulation_id, run_id, token, revision):
    """The supervisor has stopped the child. Only its own lease may be released."""
    with SessionLocal.begin() as session:
        current_revision = session.scalar(
            select(setups.c.revision).where(setups.c.id == simulation_id).with_for_update()
        )
        if current_revision != revision:
            return False
        promoted = session.execute(
            update(results)
            .where(
                results.c.simulation_id == simulation_id,
                results.c.run_id == run_id,
                results.c.input_revision == revision,
                results.c.status == "in_progress",
                results.c.lease_token == token,
            )
            .values(
                status="queued_large",
                published_at=None,
                lease_token=None,
                lease_expires_at=None,
                finished_at=None,
                error=None,
            )
        )
        return promoted.rowcount == 1


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
        or row.status not in RUNNING_STATUSES
        or row.lease_expires_at is None
        or row.lease_expires_at < datetime.now(UTC)
    ):
        return None
    return setup


def load_snapshot(simulation_id, run_id, token, revision):
    """Capture stable fields and small registry context, never read candidate caches."""
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
    stopped=False,
):
    if stopped and (not error or retry or output is not None):
        raise ValueError("Stopped-child recovery may only persist a terminal failure")
    with SessionLocal.begin() as session:
        setup = session.execute(
            select(setups.c.revision).where(setups.c.id == simulation_id).with_for_update()
        ).first()
        if setup is None or setup.revision != revision:
            return False
        row = session.execute(
            select(
                results.c.run_id,
                results.c.lease_token,
                results.c.input_revision,
                results.c.status,
                results.c.lease_expires_at,
            )
            .where(results.c.simulation_id == simulation_id)
            .with_for_update()
        ).one()
        if (
            row.run_id != run_id
            or row.lease_token != token
            or row.input_revision != revision
            or row.status not in RUNNING_STATUSES
            or row.lease_expires_at is None
            or (not stopped and row.lease_expires_at < datetime.now(UTC))
        ):
            return False
        status = "completed"
        if error:
            status = effective_result_status("failed", error.get("code"))
        if retry:
            status = "queued_large" if row.status == "in_progress_large" else "queued"
        elif status == "failed" and row.status == "in_progress_large":
            error = {**error, "worker_tier": "large"}
        values = dict(
            status=status,
            lease_token=None,
            lease_expires_at=None,
            finished_at=None if retry else datetime.now(UTC),
            error=error,
        )
        if output is not None:
            # Keep successful provenance when later submissions replace result.run_id.
            output = {**output, "run_id": run_id, "result_revision": revision}
            if saedskifte_store.snapshots_outdated(session, output.get("rotation_groups", {})):
                values["status"] = "outdated"
            values.update(output=output, result_revision=revision)
        session.execute(
            update(results).where(results.c.simulation_id == simulation_id).values(**values)
        )
        if output is not None:
            if setup_fields is not None:
                session.execute(
                    update(setups).where(setups.c.id == simulation_id).values(fields=setup_fields)
                )
            read_model_store.publish_optimization(session, simulation_id, revision, run_id, output)
        return True


def fail_unclaimed(simulation_id, run_id, farm_id, error, *, tier="standard"):
    """Fail startup errors without taking an active claim away from another worker."""
    with SessionLocal.begin() as session:
        setup = session.execute(
            select(setups.c.farm_id, setups.c.revision)
            .where(setups.c.id == simulation_id)
            .with_for_update()
        ).first()
        if setup is not None and setup.farm_id == farm_id:
            row = session.execute(
                select(results).where(results.c.simulation_id == simulation_id).with_for_update()
            ).one()
            if worker_tier(row.status, row.error) != tier:
                return None
            if row.run_id == run_id and row.input_revision == setup.revision:
                if row.status in RUNNING_STATUSES and (
                    row.lease_expires_at is None or row.lease_expires_at >= datetime.now(UTC)
                ):
                    if row.lease_expires_at is None:
                        raise RuntimeError("The active optimization run has no execution lease")
                    raise OptimizationLeaseActiveError(row.lease_expires_at)
                if row.status in ACTIVE_STATUSES:
                    if row.status in LARGE_ACTIVE_STATUSES:
                        error = {**error, "worker_tier": "large"}
                    session.execute(
                        update(results)
                        .where(results.c.simulation_id == simulation_id)
                        .values(
                            status="failed",
                            error=error,
                            finished_at=datetime.now(UTC),
                            lease_token=None,
                            lease_expires_at=None,
                        )
                    )
                elif _stored_status(row) == "failed":
                    error = row.error or error
                else:
                    return None
                return error
    return None


def recover_local_optimization_runs():
    """Mark interrupted local optimization runs failed at backend startup."""
    with SessionLocal() as session:
        rows = session.execute(
            select(results.c.simulation_id, results.c.run_id).where(
                results.c.status.in_(ACTIVE_STATUSES)
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
        if row.run_id != run_id or row.status not in ACTIVE_STATUSES:
            return
        if row.status in RUNNING_STATUSES:
            expired = row.lease_expires_at is not None and row.lease_expires_at < now
        elif row.status == "queued_large":
            # The original delivery owns a pending handoff until the large send is confirmed.
            retained_since = row.published_at or row.queued_at
            expired = dead_letter or retained_since < now - timedelta(days=4)
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
            error = {
                "code": "WORKER_LOST",
                "message": "Optimeringen kunne ikke fuldføres. Prøv igen.",
            }
            if row.status in LARGE_ACTIVE_STATUSES:
                error["worker_tier"] = "large"
            session.execute(
                update(results)
                .where(results.c.simulation_id == simulation_id)
                .values(
                    status="failed",
                    lease_token=None,
                    lease_expires_at=None,
                    finished_at=now,
                    error=error,
                )
            )
