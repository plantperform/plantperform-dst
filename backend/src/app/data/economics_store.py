"""Shared economics definitions and simulation-owned snapshots."""

from uuid import uuid4

from sqlalchemy import delete, func, insert, literal, select, update

from app.data import membership, repository, simulation_store
from app.data.db import economics_module_member_table as members
from app.data.db import economics_module_table as modules
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.domain.economics import (
    STANDARD_ID,
    STANDARD_NAME,
    EconomicsConflictError,
    EconomicsModule,
    EconomicsModuleNotFoundError,
    EconomicsSnapshot,
)
from app.services.economics.overrides import validate_identifiers

_BUSY = "A simulation is being calculated; try again when it is done"


def _row(session, module_id, email, *, lock=False):
    row = membership.modules.definition(session, module_id, email, for_edit=lock)
    if row is None:
        raise EconomicsModuleNotFoundError
    return row


def _model(row):
    return EconomicsModule.model_validate(row._mapping)


def resolve_snapshot(session, module_id, email):
    if module_id in (None, STANDARD_ID):
        return EconomicsSnapshot()
    row = _row(session, module_id, email)
    return EconomicsSnapshot(
        source_id=row.id, name=row.name, revision=row.revision, overrides=row.overrides
    )


def require_idle(session, simulation_ids):
    statuses = session.execute(
        select(results.c.status)
        .where(results.c.simulation_id.in_(simulation_ids))
        .with_for_update()
    ).scalars()
    if any(status in ("queued", "in_progress") for status in statuses):
        raise EconomicsConflictError(_BUSY)


def assign_module(session, simulation_id, data, module_id):
    session.execute(
        update(setups)
        .where(setups.c.id == simulation_id)
        .values(data={**data, "economics_module_id": module_id})
    )
    simulation_store.invalidate(session, simulation_id)


def list_modules(email):
    with repository.SessionLocal() as session:
        rows = session.execute(
            membership.modules.visible(email).order_by(modules.c.created_at, modules.c.id)
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
        .returning(modules, literal("editor").label("effective_role"))
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
                .returning(modules, literal("editor").label("effective_role"))
            ).one()
        )


def duplicate_module(module_id, email, name=None):
    with repository.SessionLocal.begin() as session:
        snapshot = resolve_snapshot(session, module_id, email)
        return _insert(session, name or f"Kopi af {snapshot.name}", snapshot.overrides, email)


def delete_module(module_id, email):
    with repository.SessionLocal.begin() as session:
        _row(session, module_id, email, lock=True)
        selecting = session.execute(
            select(setups.c.id, setups.c.data, setups.c.creation_status)
            .where(setups.c.data["economics_module_id"].astext == module_id)
            .with_for_update()
        ).all()
        if any(row.creation_status in ("queued", "running") for row in selecting):
            raise EconomicsConflictError(_BUSY)
        require_idle(session, [row.id for row in selecting])
        session.execute(delete(modules).where(modules.c.id == module_id))
        for row in selecting:
            assign_module(session, row.id, row.data, STANDARD_ID)


def list_members(module_id, email):
    with repository.SessionLocal() as session:
        entries = membership.modules.list(session, module_id, email)
        if entries is None:
            raise EconomicsModuleNotFoundError
        return [entry.email for entry in entries]


def add_member(module_id, email, member_email):
    with repository.SessionLocal.begin() as session:
        result = membership.modules.add(session, module_id, email, member_email)
        if result == "not_found":
            raise EconomicsModuleNotFoundError
        return result


def remove_member(module_id, email, member_email):
    with repository.SessionLocal.begin() as session:
        result = membership.modules.change(session, module_id, email, member_email, None)
        if result == "not_found":
            raise EconomicsModuleNotFoundError
        return result
