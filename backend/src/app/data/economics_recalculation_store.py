"""Only explicit recalculation reserves work; selection edits are metadata-only."""

from sqlalchemy import func, select, update

from app.data import creation_store, economics_store, read_model_store, repository, simulation_store
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.domain.economics import (
    STANDARD_ID,
    EconomicsConflictError,
    EconomicsRecalculationJob,
    EconomicsSnapshot,
    recalculation_job_id,
)


def select_module(farm_id, simulation_id, request, email):
    with repository.SessionLocal.begin() as session:
        row = _setup(session, farm_id, simulation_id, email)
        if row is None:
            return None
        if row.revision != request.expected_revision:
            raise EconomicsConflictError("Simulation changed; reload before saving")
        _require_editable(session, simulation_id, row)
        selected = request.economics_module_id or STANDARD_ID
        economics_store.resolve_snapshot(session, selected, email)
        if selected != row.data.get("economics_module_id", STANDARD_ID):
            session.execute(
                update(setups)
                .where(setups.c.id == simulation_id)
                .values(data={**row.data, "economics_module_id": selected})
            )
            # This keeps the already-calculated view and advances its revision;
            # invalidate_simulation does not dispatch or queue preparation.
            simulation_store.invalidate(session, simulation_id)
        return simulation_store._get_simulation(session, farm_id, simulation_id, email)


def _setup(session, farm_id, simulation_id, email):
    if not repository._member_exists(session, farm_id, email):
        return None
    return session.execute(
        select(setups.c.data, setups.c.revision, setups.c.creation_status)
        .where(setups.c.id == simulation_id, setups.c.farm_id == farm_id)
        .with_for_update()
    ).first()


def _require_editable(session, simulation_id, row):
    # A fresh explicit request can replace failed economics work. Replaying its
    # old captured inputs remains a separate retry action.
    if row.creation_status == "failed" and row.data.get("economics_recalculation"):
        return
    creation_store.require_ready(session, simulation_id)


def _job(farm_id, simulation_id, revision, operation):
    return EconomicsRecalculationJob(
        farm_id=farm_id,
        simulation_id=simulation_id,
        job_id=recalculation_job_id(simulation_id, revision),
        expected_revision=revision,
        requested_by=operation["requested_by"],
        snapshot=operation["snapshot"],
    )


def submit(farm_id, simulation_id, request, email):
    with repository.SessionLocal.begin() as session:
        row = _setup(session, farm_id, simulation_id, email)
        if row is None:
            return None, None
        previous = row.data.get("economics_recalculation", {})
        parameters = request.model_dump(mode="json")
        if previous.get("request_id") == str(request.request_id):
            if previous["parameters"] != parameters:
                raise EconomicsConflictError("Recalculation request ID already used")
            # Dispatch belongs to the first reservation, including the interval
            # before publication. Concurrent HTTP retries must not enqueue twice.
            return simulation_id, None
        if row.revision != request.expected_revision:
            raise EconomicsConflictError("Simulation changed; reload before recalculating")
        _require_editable(session, simulation_id, row)
        active = session.execute(
            select(results.c.status)
            .where(results.c.simulation_id == simulation_id)
            .with_for_update()
        ).scalar_one()
        if active in ("queued", "in_progress"):
            raise EconomicsConflictError("Simulation already has active optimization")
        snapshot = (
            economics_store.resolve_snapshot(
                session, row.data.get("economics_module_id", STANDARD_ID), email
            )
            if request.refresh_from_module
            else EconomicsSnapshot.model_validate(row.data.get("economics_snapshot", {}))
        )
        operation = dict(
            request_id=str(request.request_id),
            parameters=parameters,
            requested_by=email,
            snapshot=snapshot.model_dump(mode="json"),
            published=False,
        )
        simulation_store.invalidate(session, simulation_id)
        revision = row.revision + 1
        session.execute(
            update(setups)
            .where(setups.c.id == simulation_id)
            .values(
                data={**row.data, "economics_recalculation": operation}, creation_status="queued"
            )
        )
        read_model_store.initialize_simulation(session, simulation_id, revision)
        return simulation_id, _job(farm_id, simulation_id, revision, operation)


def retry(farm_id, simulation_id, email):
    with creation_store.execution_session(simulation_id) as session, session.begin():
        row = _setup(session, farm_id, simulation_id, email)
        if row is None:
            return None, None
        operation = row.data.get("economics_recalculation")
        if row.creation_status != "failed" or operation is None:
            raise EconomicsConflictError("Only failed economics recalculations can be retried")
        operation = {**operation, "published": False}
        revision = row.revision + 1
        session.execute(
            update(setups)
            .where(setups.c.id == simulation_id)
            .values(
                data={**row.data, "economics_recalculation": operation},
                revision=revision,
                creation_status="queued",
                updated_at=func.now(),
            )
        )
        read_model_store.initialize_simulation(session, simulation_id, revision)
        return simulation_id, _job(farm_id, simulation_id, revision, operation)


def locked_setup(session, job):
    if getattr(session.get_bind(), "invalidated", False):
        raise RuntimeError("Recalculation database connection was lost")
    row = session.execute(
        select(setups).where(setups.c.id == job.simulation_id).with_for_update()
    ).first()
    if row is None or row.revision != job.expected_revision:
        return None
    if row.farm_id != job.farm_id or job.job_id != recalculation_job_id(row.id, row.revision):
        raise ValueError("Invalid economics recalculation envelope")
    operation = row.data.get("economics_recalculation")
    if (
        operation is None
        or operation["snapshot"] != job.snapshot.model_dump(mode="json")
        or operation["requested_by"] != job.requested_by
    ):
        raise ValueError("Recalculation snapshot differs from the captured request")
    return row


def set_status(session, job, status):
    with session.begin():
        row = locked_setup(session, job)
        if row is None or row.creation_status == "done":
            return False
        session.execute(
            update(setups).where(setups.c.id == job.simulation_id).values(creation_status=status)
        )
        return True


def mark_published(job):
    with repository.SessionLocal.begin() as session:
        row = locked_setup(session, job)
        if row:
            data = {
                **row.data,
                "economics_recalculation": {
                    **row.data["economics_recalculation"],
                    "published": True,
                },
            }
            session.execute(
                update(setups).where(setups.c.id == job.simulation_id).values(data=data)
            )
