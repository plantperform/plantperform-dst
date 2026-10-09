"""Execution leases and recovery. Always lock setup before result."""

import logging
from datetime import UTC, datetime, timedelta
from time import monotonic
from uuid import uuid4

from sqlalchemy import select, update

from app.data.db import SessionLocal
from app.data.db import simulation_field_candidates_table as caches
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.data.simulation_store import _candidates, _fields, _model
from app.domain.optimization import (
    LEASE_DURATION_SECONDS,
    MAX_JOB_ATTEMPTS,
    RETRY_DELAY_SECONDS,
    OptimizationAttemptsExhaustedError,
    OptimizationLeaseActiveError,
)
from app.domain.rotation_candidate import RotationCandidateEvaluation

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
    """Load compact inputs after the claim has committed and is visible to polling."""
    timings = {}
    started = monotonic()
    with SessionLocal.begin() as session:
        setup = _execution_setup(session, simulation_id, run_id, token, revision, include_data=True)
        if setup is None:
            return None
        simulation = _model(session, simulation_id, setup)
        timings["setup"] = monotonic() - started
        started = monotonic()
        fields = _fields(session, simulation_id)
        timings["fields"] = monotonic() - started
        candidates = _candidates(session, simulation_id, compact=True, timings=timings)
    for phase, duration in timings.items():
        logger.info(
            "optimizer_phase simulation_id=%s run_id=%s phase=%s duration_seconds=%.3f "
            "field_count=%s candidate_count=%s",
            simulation_id,
            run_id,
            phase,
            duration,
            len(fields),
            sum(len(row.candidates) for row in candidates),
        )
    return simulation, fields, candidates


def hydrate_winners(simulation_id, run_id, token, revision, selected):
    """Extract only winning cached evaluations; overlays and computed shifts are already full."""
    with SessionLocal.begin() as session:
        if _execution_setup(session, simulation_id, run_id, token, revision) is None:
            return None
        hydrated = {}
        for field_id, candidate in selected.items():
            if candidate._cache_position is None:
                hydrated[field_id] = candidate
                continue
            data = session.execute(
                select(caches.c.data["candidates"][candidate._cache_position]).where(
                    caches.c.simulation_id == simulation_id,
                    caches.c.field_id == field_id,
                )
            ).scalar_one()
            full = RotationCandidateEvaluation.model_validate(data)
            if full.ref != candidate.ref:
                raise ValueError("Winning candidate no longer matches its cache position")
            hydrated[field_id] = full
        return hydrated


def finish(simulation_id, run_id, token, revision, *, output=None, error=None, retry=False):
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
            values.update(output=output, result_revision=revision)
        session.execute(
            update(results).where(results.c.simulation_id == simulation_id).values(**values)
        )
        return True


def recover_local_runs():
    """A single local backend cannot resume tasks from its previous process."""
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
