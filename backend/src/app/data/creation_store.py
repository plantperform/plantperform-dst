"""Shared PostgreSQL advisory locks and recovery for projection/economics workers."""

from contextlib import contextmanager

from sqlalchemy import select, update

from app.data import advisory_lock, repository
from app.data.db import simulation_table as setups
from app.domain.creation import CreationActiveError, CreationNotReadyError


def require_ready(session, simulation_id):
    status = session.execute(
        select(setups.c.creation_status).where(setups.c.id == simulation_id)
    ).scalar_one_or_none()
    if status is not None and status != "done":
        raise CreationNotReadyError("Simuleringen er ikke færdig med at blive oprettet.")


def advisory_key(simulation_id):
    return advisory_lock.advisory_key(f"plantperform:creation:{simulation_id}")


@contextmanager
def execution_session(simulation_id):
    with advisory_lock.advisory_session(
        repository.SessionLocal, advisory_key(simulation_id), wait=False
    ) as session:
        if session is None:
            raise CreationActiveError("Simulation creation is already running")
        yield session


def recover_local_simulation_creations():
    """Mark unfinished local creations failed at startup, skipping live workers."""
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
