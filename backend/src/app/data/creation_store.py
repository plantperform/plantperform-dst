"""Shared PostgreSQL advisory locks and recovery for projection/economics workers."""

import hashlib
from contextlib import contextmanager

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.data import repository
from app.data.db import simulation_table as setups
from app.domain.creation import CreationActiveError, CreationNotReadyError


def require_ready(session, simulation_id):
    status = session.execute(
        select(setups.c.creation_status).where(setups.c.id == simulation_id)
    ).scalar_one_or_none()
    if status is not None and status != "done":
        raise CreationNotReadyError("Simuleringen er ikke færdig med at blive oprettet.")


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
