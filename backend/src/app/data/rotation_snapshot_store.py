"""Read rotation snapshots without importing group management or calculation services."""

from sqlalchemy import select

from app.data.db import SessionLocal
from app.data.db import saedskifte_rotation_group_member_table as members
from app.data.db import saedskifte_rotation_group_table as groups
from app.domain.saedskifte import (
    RotationDefinitionError,
    RotationGroupNotFoundError,
    RotationGroupSnapshot,
    is_custom,
)


def is_member(session, group_id, email):
    return (
        session.execute(
            select(members.c.email).where(members.c.group_id == group_id, members.c.email == email)
        ).first()
        is not None
    )


def resolve_selected(session, ids, *, email=None, existing=()):
    """Callers without an email must already have authorized the simulation/job."""
    custom_ids = {value for value in ids if is_custom(value)}
    if not custom_ids:
        return {}
    if email is not None:
        for group_id in sorted(custom_ids - set(existing)):
            if not is_member(session, group_id, email):
                raise RotationGroupNotFoundError
    rows = session.execute(select(groups).where(groups.c.id.in_(custom_ids))).all()
    if {row.id for row in rows} != custom_ids:
        raise RotationDefinitionError(
            "A selected rotation no longer exists", code="ROTATION_DELETED"
        )
    return {row.id: RotationGroupSnapshot.model_validate(dict(row._mapping)) for row in rows}


def load_selected(ids):
    if not any(is_custom(value) for value in ids):
        return {}
    with SessionLocal() as session:
        return resolve_selected(session, ids)
