"""PostgreSQL session locks for work spanning multiple transactions."""

import hashlib
from contextlib import contextmanager

from sqlalchemy import func, select
from sqlalchemy.orm import Session


def advisory_key(name):
    return int.from_bytes(hashlib.sha256(name.encode()).digest()[:8], "big", signed=True)


@contextmanager
def advisory_session(sessions, key, *, wait=True):
    with sessions() as owner, owner.get_bind().connect() as connection:
        try:
            if wait:
                connection.execute(select(func.pg_advisory_lock(key)))
                acquired = True
            else:
                acquired = connection.scalar(select(func.pg_try_advisory_lock(key)))
            connection.commit()
        except BaseException:
            connection.invalidate()
            raise
        if not acquired:
            yield None
            return
        try:
            with Session(bind=connection) as session:
                yield session
        finally:
            # A replacement connection cannot own this lock.
            if not connection.invalidated and not connection.closed:
                try:
                    connection.rollback()
                    if not connection.scalar(select(func.pg_advisory_unlock(key))):
                        raise RuntimeError("PostgreSQL advisory lock was lost")
                    connection.commit()
                except BaseException:
                    connection.invalidate()
                    raise
