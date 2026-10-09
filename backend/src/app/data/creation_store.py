"""Creation status and atomic field writes. Always lock the simulation first."""

import hashlib
from contextlib import contextmanager
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import Text, bindparam, cast, delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from app.data import repository
from app.data.db import farm_table, field_table
from app.data.db import simulation_field_candidates_table as caches
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.data.simulation_store import merge_constraints, split_field
from app.domain.creation import CreationActiveError, CreationConflictError, CreationNotReadyError
from app.domain.creation_job import CreationJob, creation_job_id, optimization_run_id
from app.domain.field import FieldRecord
from app.domain.optimization import OptimizeSimulationRequest
from app.domain.simulation import CreateSimulationRequest, OptimizationConstraints, Simulation


def require_ready(session, simulation_id):
    status = session.execute(
        select(setups.c.creation_status).where(setups.c.id == simulation_id)
    ).scalar_one_or_none()
    if status is not None and status != "done":
        raise CreationNotReadyError("Simuleringen er ikke færdig med at blive oprettet.")


def job_for(farm_id, simulation_id, revision, request, email):
    return CreationJob(
        farm_id=farm_id,
        simulation_id=simulation_id,
        job_id=creation_job_id(simulation_id, revision),
        requested_by=email,
        expected_revision=revision,
        parameters=request,
    )


def create(farm_id, request, email):
    request_id = str(request.request_id or uuid4())
    simulation_id = str(uuid5(NAMESPACE_URL, f"plantperform:simulation:{farm_id}:{request_id}"))
    with repository.SessionLocal.begin() as session:
        if not repository._farm_exists(session, farm_id, email):
            return None
        # Serialize duplicate POSTs before deciding which one must dispatch.
        if (
            session.execute(
                select(farm_table.c.id).where(farm_table.c.id == farm_id).with_for_update()
            ).first()
            is None
        ):
            return None
        if session.execute(select(setups.c.id).where(setups.c.id == simulation_id)).first():
            return simulation_id, None
        simulation = Simulation(
            id=simulation_id,
            farm_id=farm_id,
            name=request.name,
            created_at=datetime.now(UTC).isoformat(),
            constraints=request.constraints,
            rotation_saedskiftevarianter=request.saedskiftevarianter,
            rotation_n_norm_procenter=request.n_norm_procenter,
            godning=request.godning,
            eea_fdato=request.eea_fdato,
            eea_precision_dagsbasis=request.eea_precision_dagsbasis,
            praecisionsjordbrug=request.praecisionsjordbrug,
            tidlig_saaning=request.tidlig_saaning,
            mellemafgrode=request.mellemafgrode,
        )
        session.execute(
            insert(setups).values(
                id=simulation_id,
                farm_id=farm_id,
                data=simulation.model_dump(mode="json", exclude={"creation_status"}),
                fields={},
                field_order=[],
                creation_status="queued",
            )
        )
        session.execute(insert(results).values(simulation_id=simulation_id))
        return simulation_id, job_for(farm_id, simulation_id, 0, request, email)


def advisory_key(simulation_id):
    digest = hashlib.sha256(f"plantperform:creation:{simulation_id}".encode()).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


@contextmanager
def execution_session(simulation_id):
    """Retain the advisory lock and physical connection across short transactions."""
    with repository.SessionLocal() as owner, owner.get_bind().connect() as connection:
        key = advisory_key(simulation_id)
        acquired = False
        try:
            acquired = connection.execute(select(func.pg_try_advisory_lock(key))).scalar_one()
            connection.commit()
            if not acquired:
                raise CreationActiveError("Simulation creation is already running")
            with Session(bind=connection) as session:
                yield session
        finally:
            if acquired:
                # Never reconnect here: a replacement connection would not own this lock.
                if connection.invalidated or connection.closed:
                    connection.invalidate()
                else:
                    try:
                        connection.rollback()
                        released = connection.execute(
                            select(func.pg_advisory_unlock(key))
                        ).scalar_one()
                        connection.commit()
                        if not released:
                            raise RuntimeError("Creation advisory lock was lost")
                    except Exception:
                        connection.invalidate()
                        raise


def locked_setup(session, job):
    if getattr(session.get_bind(), "invalidated", False):
        raise RuntimeError("Creation database connection was lost")
    row = session.execute(
        select(setups.c.id, setups.c.farm_id, setups.c.revision, setups.c.creation_status)
        .where(setups.c.id == job.simulation_id)
        .with_for_update()
    ).first()
    if row is None:
        return None
    if row.farm_id != job.farm_id:
        raise ValueError("Creation message farm does not match the simulation")
    if row.revision != job.expected_revision or job.job_id != creation_job_id(row.id, row.revision):
        return None
    return row


def claim(session, job):
    with session.begin():
        row = locked_setup(session, job)
        if row is None:
            return None
        if row.creation_status not in ("done", "failed"):
            session.execute(
                update(setups).where(setups.c.id == row.id).values(creation_status="running")
            )
        return row


def start_attempt(session, job):
    """Read current inputs once and atomically replace all previous partial work."""
    with session.begin():
        row = locked_setup(session, job)
        if row is None or row.creation_status != "running":
            return None
        request = job.parameters
        data = (
            session.execute(
                select(field_table.c.data)
                .where(field_table.c.farm_id == row.farm_id)
                .order_by(field_table.c.created_at, field_table.c.id)
            )
            .scalars()
            .all()
        )
        fields = [
            FieldRecord.model_validate(value).model_copy(update={"id": str(uuid4())}, deep=True)
            for value in data
        ]
        contexts = repository._registry_contexts_for_imk_ids(
            session, list({field.imk_id for field in fields if field.imk_id is not None})
        )
        constraints = merge_constraints(OptimizationConstraints(), request.constraints, len(fields))
        if constraints.globally_allowed_rotation_ids is not None:
            farm = repository._get_farm(session, row.farm_id, job.requested_by)
            if farm is None:
                raise ValueError("Farm is no longer accessible")
            library_ids = {rotation.id for rotation in farm.rotation_library}
            for rotation_id in constraints.globally_allowed_rotation_ids:
                if rotation_id not in library_ids:
                    raise ValueError(f"Unknown globally allowed rotation id: {rotation_id}")
        session.execute(delete(caches).where(caches.c.simulation_id == job.simulation_id))
        session.execute(
            update(setups)
            .where(setups.c.id == job.simulation_id)
            .values(
                fields={field.id: split_field(field.model_dump(mode="json")) for field in fields},
                field_order=[field.id for field in fields],
            )
        )
        return fields, contexts


def checkpoint(session, job, field_id, setup, full_json, compact_json):
    with session.begin():
        row = locked_setup(session, job)
        if row is None or row.creation_status != "running":
            return False
        if full_json is not None:
            session.execute(
                insert(caches).values(
                    id=str(uuid4()),
                    simulation_id=job.simulation_id,
                    field_id=field_id,
                    data=cast(bindparam("candidate_json", type_=Text), JSONB),
                    optimizer_input=cast(bindparam("optimizer_json", type_=Text), JSONB),
                ),
                {"candidate_json": full_json, "optimizer_json": compact_json},
            )
        if setup.get("fixed_candidate"):
            session.execute(
                update(setups)
                .where(setups.c.id == job.simulation_id)
                .values(
                    fields=func.jsonb_set(
                        setups.c.fields,
                        [field_id],
                        cast(bindparam("field_setup", type_=JSONB), JSONB),
                    )
                ),
                {"field_setup": setup},
            )
        return True


def complete(session, job, *, optimization_error=None):
    with session.begin():
        row = locked_setup(session, job)
        if row is None or row.creation_status != "running":
            return False
        session.execute(update(setups).where(setups.c.id == row.id).values(creation_status="done"))
        if job.parameters.optimize_on_create:
            now = datetime.now(UTC)
            request = OptimizeSimulationRequest(
                expected_revision=row.revision,
                run_id=optimization_run_id(row.id, row.revision),
                time_limit_seconds=90,
            )
            session.execute(
                update(results)
                .where(results.c.simulation_id == row.id)
                .values(
                    status="failed" if optimization_error else "queued",
                    kind="optimize",
                    run_id=str(request.run_id),
                    input_revision=row.revision,
                    requested_by=job.requested_by,
                    parameters=request.model_dump(mode="json"),
                    queued_at=now,
                    published_at=None,
                    started_at=None,
                    finished_at=now if optimization_error else None,
                    attempts=0,
                    lease_token=None,
                    lease_expires_at=None,
                    error=optimization_error,
                )
            )
        return True


def fail(session, job, *, retry=False):
    # Reconnecting would silently lose the session lock and allow stale writes.
    if session.get_bind().invalidated:
        return False
    with session.begin():
        row = locked_setup(session, job)
        if row is None or row.creation_status not in ("queued", "running"):
            return False
        session.execute(
            update(setups)
            .where(setups.c.id == row.id)
            .values(creation_status="queued" if retry else "failed")
        )
        return True


def retry(farm_id, simulation_id, email, *, optimize_on_create=False):
    try:
        with execution_session(simulation_id) as session, session.begin():
            simulation = repository._get_simulation(session, farm_id, simulation_id, email)
            if simulation is None:
                return None
            row = session.execute(
                select(setups.c.revision, setups.c.creation_status)
                .where(setups.c.id == simulation_id)
                .with_for_update()
            ).one()
            if row.creation_status != "failed":
                raise CreationConflictError("Kun mislykkede oprettelser kan prøves igen.")
            revision = row.revision + 1
            session.execute(
                update(setups)
                .where(setups.c.id == simulation_id)
                .values(revision=revision, creation_status="queued", updated_at=func.now())
            )
            request = CreateSimulationRequest.model_validate(
                {
                    **simulation.model_dump(mode="json"),
                    "saedskiftevarianter": simulation.rotation_saedskiftevarianter,
                    "n_norm_procenter": simulation.rotation_n_norm_procenter,
                    "optimize_on_create": optimize_on_create,
                }
            )
            return job_for(farm_id, simulation_id, revision, request, email)
    except CreationActiveError as error:
        raise CreationConflictError("Oprettelsen er stadig i gang. Prøv igen senere.") from error


def recover_local_jobs():
    with repository.SessionLocal() as session:
        ids = (
            session.execute(
                select(setups.c.id).where(setups.c.creation_status.in_(["queued", "running"]))
            )
            .scalars()
            .all()
        )
    for simulation_id in ids:
        try:
            with execution_session(simulation_id) as session, session.begin():
                session.execute(
                    update(setups)
                    .where(
                        setups.c.id == simulation_id,
                        setups.c.creation_status.in_(["queued", "running"]),
                    )
                    .values(creation_status="failed")
                )
        except CreationActiveError:
            continue


def recover_local_job(job):
    try:
        with execution_session(job.simulation_id) as session:
            if not fail(session, job):
                with session.begin():
                    row = locked_setup(session, job)
                    if row is not None and row.creation_status == "done":
                        session.execute(
                            update(results)
                            .where(
                                results.c.simulation_id == row.id,
                                results.c.run_id == optimization_run_id(row.id, row.revision),
                                results.c.status == "queued",
                            )
                            .values(
                                status="failed",
                                finished_at=datetime.now(UTC),
                                error={
                                    "code": "WORKER_ERROR",
                                    "message": "Oprettelsen blev afbrudt.",
                                },
                            )
                        )
    except CreationActiveError:
        return
