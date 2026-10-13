"""Economics membership is independent of farms; snapshots never reference live JSON."""

from uuid import uuid4

from sqlalchemy import delete, func, insert, select, update

from app.data import repository
from app.data.db import app_user_table
from app.data.db import economics_module_member_table as members
from app.data.db import economics_module_table as modules
from app.domain.economics import (
    STANDARD_ID,
    STANDARD_NAME,
    EconomicsConflictError,
    EconomicsModule,
    EconomicsModuleNotFoundError,
    EconomicsSnapshot,
)
from app.services.economics.overrides import validate_identifiers


def _row(session, module_id, email, *, lock=False):
    row = session.execute(
        select(modules).where(modules.c.id == module_id).with_for_update()
        if lock
        else select(modules).where(modules.c.id == module_id)
    ).first()
    if (
        row is None
        or session.execute(
            select(members.c.email).where(
                members.c.module_id == module_id, members.c.email == email
            )
        ).first()
        is None
    ):
        raise EconomicsModuleNotFoundError
    return row


def _model(row):
    return EconomicsModule.model_validate(dict(row._mapping))


def resolve_snapshot(session, module_id, email):
    if module_id in (None, STANDARD_ID):
        return EconomicsSnapshot()
    row = _row(session, module_id, email)
    return EconomicsSnapshot(
        source_id=row.id, name=row.name, revision=row.revision, overrides=row.overrides
    )


def list_modules(email):
    with repository.SessionLocal() as session:
        rows = session.execute(
            select(modules)
            .join(members)
            .where(members.c.email == email)
            .order_by(modules.c.created_at, modules.c.id)
        )
        return [EconomicsModule(id=STANDARD_ID, name=STANDARD_NAME), *map(_model, rows)]


def get_module(module_id, email):
    if module_id == STANDARD_ID:
        return EconomicsModule(id=STANDARD_ID, name=STANDARD_NAME)
    with repository.SessionLocal() as session:
        return _model(_row(session, module_id, email))


def _insert(session, name, overrides, email):
    module_id = str(uuid4())
    row = session.execute(
        insert(modules)
        .values(id=module_id, name=name, overrides=overrides.model_dump(mode="json", by_alias=True))
        .returning(modules)
    ).one()
    session.execute(insert(members).values(module_id=module_id, email=email))
    return _model(row)


def create_module(request, email):
    validate_identifiers(request.overrides)
    with repository.SessionLocal.begin() as session:
        return _insert(session, request.name, request.overrides, email)


def update_module(module_id, request, email):
    with repository.SessionLocal.begin() as session:
        row = _row(session, module_id, email, lock=True)
        if row.revision != request.expected_revision:
            raise EconomicsConflictError("Economics module changed; reload before saving")
        values = {}
        if "name" in request.model_fields_set:
            values["name"] = request.name
        if "overrides" in request.model_fields_set:
            if request.overrides is None:
                raise ValueError("Overrides must be an object")
            validate_identifiers(request.overrides)
            values["overrides"] = request.overrides.model_dump(mode="json", by_alias=True)
        if not values:
            return _model(row)
        return _model(
            session.execute(
                update(modules)
                .where(modules.c.id == module_id)
                .values(**values, revision=row.revision + 1, updated_at=func.now())
                .returning(modules)
            ).one()
        )


def duplicate_module(module_id, email, name=None):
    with repository.SessionLocal.begin() as session:
        snapshot = resolve_snapshot(session, module_id, email)
        return _insert(session, name or f"Kopi af {snapshot.name}", snapshot.overrides, email)


def delete_module(module_id, email):
    with repository.SessionLocal.begin() as session:
        _row(session, module_id, email, lock=True)
        session.execute(delete(modules).where(modules.c.id == module_id))


def list_members(module_id, email):
    with repository.SessionLocal() as session:
        _row(session, module_id, email)
        return list(
            session.execute(
                select(members.c.email)
                .where(members.c.module_id == module_id)
                .order_by(members.c.email)
            ).scalars()
        )


def add_member(module_id, email, member_email):
    with repository.SessionLocal.begin() as session:
        _row(session, module_id, email, lock=True)
        user = session.execute(
            select(app_user_table.c.verified_at).where(app_user_table.c.email == member_email)
        ).first()
        if user is None or user.verified_at is None:
            return "user_not_found"
        if session.execute(
            select(members.c.email).where(
                members.c.module_id == module_id, members.c.email == member_email
            )
        ).first():
            return "already_member"
        session.execute(insert(members).values(module_id=module_id, email=member_email))
        return "added"


def remove_member(module_id, email, member_email):
    with repository.SessionLocal.begin() as session:
        _row(session, module_id, email, lock=True)
        emails = list(
            session.execute(
                select(members.c.email).where(members.c.module_id == module_id)
            ).scalars()
        )
        if member_email not in emails:
            return "member_not_found"
        if len(emails) == 1:
            return "last_member"
        session.execute(
            delete(members).where(members.c.module_id == module_id, members.c.email == member_email)
        )
        return "removed"
