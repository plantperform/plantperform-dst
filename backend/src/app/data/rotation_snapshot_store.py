"""Read rotation snapshots without importing group management or calculation services."""

from sqlalchemy import select

from app.data import membership
from app.data.db import SessionLocal
from app.data.db import saedskifte_rotation_group_table as groups
from app.domain.saedskifte import (
    RotationDefinitionError,
    RotationGroupNotFoundError,
    RotationGroupSnapshot,
    is_custom,
)


def resolve_selected(session, ids, *, email=None, existing=()):
    """Callers without an email must already have authorized the simulation/job."""
    custom_ids = {value for value in ids if is_custom(value)}
    if not custom_ids:
        return {}
    query = select(groups) if email is None else membership.rotations.visible(email)
    rows = session.execute(query.where(groups.c.id.in_(custom_ids))).all()
    if email is not None and custom_ids - {row.id for row in rows} - set(existing):
        raise RotationGroupNotFoundError
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
