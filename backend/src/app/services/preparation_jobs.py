"""Revision-bound history and display preparation during the HTTP request."""

from sqlalchemy import select

from app.data import creation_store, read_model_store, repository
from app.data.db import farm_read_model_table as farm_views
from app.data.db import farm_table, field_table, simulation_table
from app.data.db import simulation_read_model_table as simulation_views
from app.domain.field import FieldRecord
from app.domain.read_model import preparation_job
from app.services import preparation_runner
from app.services.calculation import CalculationContext


def _scope(kind, entity_id):
    return f"farm-history:{entity_id}" if kind == "prepare_farm_history" else entity_id


def _pending(session, kind, entity_id):
    farm = kind == "prepare_farm_history"
    owner, table = (farm_table, farm_views) if farm else (simulation_table, simulation_views)
    key = table.c.farm_id if farm else table.c.simulation_id
    with session.begin():
        row = session.execute(
            select(owner.c.revision, table.c.generation, owner.c.id if farm else owner.c.farm_id)
            .join(table, key == owner.c.id)
            .where(
                owner.c.id == entity_id,
                table.c.status == "queued",
                table.c.input_revision == owner.c.revision,
            )
        ).first()
    if row is None:
        return None
    return preparation_job(kind, row[2], row.revision, None if farm else entity_id, row.generation)


def dispatch(job):
    """Execute a captured preparation once; retained for direct callers and tests."""
    return preparation_runner.execute(job)


def register_fields(farm_id, requests, email):
    context = CalculationContext()
    with creation_store.execution_session(_scope("prepare_farm_history", farm_id)) as session:
        registered = repository.register_fields(farm_id, requests, email, execution_session=session)
        if registered is None:
            return None
        fields, job = registered
        if job:
            preparation_runner.execute(job, context, execution_session=session)
        with session.begin():
            current = {
                data["id"]: FieldRecord.model_validate(data)
                for data in session.scalars(
                    select(field_table.c.data).where(field_table.c.farm_id == farm_id)
                )
            }
        return [current[field.id] for field in fields]


def _prepare_on_load(kind, entity_id):
    context = CalculationContext()
    with creation_store.execution_session(_scope(kind, entity_id)) as session:
        with session.begin():
            job = read_model_store.schedule_preparation(session, kind, entity_id)
        job = job or _pending(session, kind, entity_id)
        if job:
            preparation_runner.execute(job, context, execution_session=session)


def get_or_prepare_farm_view(farm_id, email, *, include_data=True):
    view = read_model_store.get_farm_view(farm_id, email, include_data=include_data)
    if view is None or not include_data or view["data"] is not None or view["status"] == "failed":
        return view
    _prepare_on_load("prepare_farm_history", farm_id)
    return read_model_store.get_farm_view(farm_id, email)


def get_or_prepare_simulation_view(farm_id, simulation_id, email, *, include_data=True):
    view = read_model_store.get_simulation_view(
        farm_id, simulation_id, email, include_data=include_data
    )
    if (
        view is None
        or not include_data
        or view["data"] is not None
        or view["status"] == "failed"
        or view["simulation"].creation_status != "done"
    ):
        return view
    _prepare_on_load("prepare_simulation_view", simulation_id)
    return read_model_store.get_simulation_view(farm_id, simulation_id, email)


def retry_history(farm_id, email):
    context = CalculationContext()
    with creation_store.execution_session(_scope("prepare_farm_history", farm_id)) as session:
        with session.begin():
            if not repository._member_exists(session, farm_id, email):
                return None
            job = read_model_store.schedule_preparation(
                session, "prepare_farm_history", farm_id, refresh=True
            )
        if job:
            preparation_runner.execute(job, context, execution_session=session)
    return read_model_store.get_farm_view(farm_id, email)


def detach_field(farm_id, field_id, email):
    context = CalculationContext()
    with creation_store.execution_session(_scope("prepare_farm_history", farm_id)) as session:
        detached = repository.detach_field(farm_id, field_id, email, execution_session=session)
        if detached:
            job = _pending(session, "prepare_farm_history", farm_id)
            if job:
                preparation_runner.execute(job, context, execution_session=session)
    return detached


def retry_simulation_view(farm_id, simulation_id, email):
    context = CalculationContext()
    with creation_store.execution_session(simulation_id) as session:
        with session.begin():
            if not repository._member_exists(session, farm_id, email):
                return None
            if not session.execute(
                select(simulation_table.c.id).where(
                    simulation_table.c.id == simulation_id, simulation_table.c.farm_id == farm_id
                )
            ).first():
                return None
            job = read_model_store.schedule_preparation(
                session, "prepare_simulation_view", simulation_id
            )
        job = job or _pending(session, "prepare_simulation_view", simulation_id)
        if job:
            preparation_runner.execute(job, context, execution_session=session)
    return read_model_store.get_simulation_view(farm_id, simulation_id, email)
