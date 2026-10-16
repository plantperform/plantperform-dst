"""Economics modules belong to a farm; snapshots never reference live JSON."""

from uuid import uuid4

from sqlalchemy import delete, func, insert, select, update

from app.data import repository, simulation_store
from app.data.db import economics_module_table as modules
from app.data.db import simulation_table as setups
from app.domain.creation import CreationNotReadyError
from app.domain.economics import (
    STANDARD_ID,
    STANDARD_NAME,
    EconomicsConflictError,
    EconomicsModule,
    EconomicsModuleNotFoundError,
    EconomicsSnapshot,
)
from app.services.economics.overrides import validate_identifiers


def _require_member(session, farm_id, email):
    if not repository._member_exists(session, farm_id, email):
        raise EconomicsModuleNotFoundError


def _row(session, farm_id, module_id, email, *, lock=False):
    _require_member(session, farm_id, email)
    query = select(modules).where(modules.c.id == module_id, modules.c.farm_id == farm_id)
    row = session.execute(query.with_for_update() if lock else query).first()
    if row is None:
        raise EconomicsModuleNotFoundError
    return row


def _model(row):
    return EconomicsModule.model_validate(dict(row._mapping))


def resolve_snapshot(session, farm_id, module_id, email):
    if module_id in (None, STANDARD_ID):
        return EconomicsSnapshot()
    row = _row(session, farm_id, module_id, email)
    return EconomicsSnapshot(
        source_id=row.id, name=row.name, revision=row.revision, overrides=row.overrides
    )


def list_modules(farm_id, email):
    with repository.SessionLocal() as session:
        _require_member(session, farm_id, email)
        rows = session.execute(
            select(modules)
            .where(modules.c.farm_id == farm_id)
            .order_by(modules.c.created_at, modules.c.id)
        )
        return [EconomicsModule(id=STANDARD_ID, name=STANDARD_NAME), *map(_model, rows)]


def get_module(farm_id, module_id, email):
    with repository.SessionLocal() as session:
        if module_id == STANDARD_ID:
            _require_member(session, farm_id, email)
            return EconomicsModule(id=STANDARD_ID, name=STANDARD_NAME)
        return _model(_row(session, farm_id, module_id, email))


def _insert(session, farm_id, name, overrides):
    row = session.execute(
        insert(modules)
        .values(
            id=str(uuid4()),
            farm_id=farm_id,
            name=name,
            overrides=overrides.model_dump(mode="json", by_alias=True),
        )
        .returning(modules)
    ).one()
    return _model(row)


def create_module(farm_id, request, email):
    validate_identifiers(request.overrides)
    with repository.SessionLocal.begin() as session:
        _require_member(session, farm_id, email)
        return _insert(session, farm_id, request.name, request.overrides)


def update_module(farm_id, module_id, request, email):
    with repository.SessionLocal.begin() as session:
        row = _row(session, farm_id, module_id, email, lock=True)
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


def duplicate_module(farm_id, module_id, email, name=None):
    with repository.SessionLocal.begin() as session:
        _require_member(session, farm_id, email)
        snapshot = resolve_snapshot(session, farm_id, module_id, email)
        return _insert(session, farm_id, name or f"Kopi af {snapshot.name}", snapshot.overrides)


def delete_module(farm_id, module_id, email):
    from app.data.economics_recalculation_store import _require_editable

    with repository.SessionLocal.begin() as session:
        _row(session, farm_id, module_id, email, lock=True)
        selecting = session.execute(
            select(setups.c.id, setups.c.data, setups.c.creation_status)
            .where(
                setups.c.farm_id == farm_id,
                setups.c.data["economics_module_id"].astext == module_id,
            )
            .with_for_update()
        ).all()
        for row in selecting:
            try:
                _require_editable(session, row.id, row)
            except CreationNotReadyError as error:
                raise EconomicsConflictError(
                    "A simulation using this module is being calculated"
                ) from error
        session.execute(delete(modules).where(modules.c.id == module_id))
        for row in selecting:
            session.execute(
                update(setups)
                .where(setups.c.id == row.id)
                .values(data={**row.data, "economics_module_id": STANDARD_ID})
            )
            simulation_store.invalidate(session, row.id)
