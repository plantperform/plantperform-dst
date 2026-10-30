"""Persist small views; read paths never build them or load candidate documents."""

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from app.data.db import farm_read_model_table as farm_views
from app.data.db import farm_table, field_historical_detail_table, field_table
from app.data.db import simulation_read_model_table as simulation_views
from app.data.db import simulation_table as setups
from app.domain.read_model import ReadModelNotReadyError, preparation_job
from app.domain.rotation_candidate import RotationCandidateEvaluation
from app.services import read_models


def _repository():
    from app.data import repository

    return repository


def initialize_farm(session, farm_id):
    session.execute(
        insert(farm_views).values(
            farm_id=farm_id,
            status="done",
            view_version=1,
            data={"fields": [], "field_years": {}, "yearly_summary": []},
        )
    )


def initialize_simulation(session, simulation_id, revision=0):
    session.execute(
        insert(simulation_views)
        .values(
            simulation_id=simulation_id,
            input_revision=revision,
        )
        .on_conflict_do_update(
            index_elements=[simulation_views.c.simulation_id],
            set_={
                "status": "queued",
                "input_revision": revision,
                "error": None,
                "generation": 0,
                "view_version": simulation_views.c.view_version + 1,
            },
        )
    )


def invalidate_farm(session, farm_id):
    revision = session.execute(
        update(farm_table)
        .where(farm_table.c.id == farm_id)
        .values(revision=farm_table.c.revision + 1)
        .returning(farm_table.c.revision)
    ).scalar_one()
    session.execute(
        insert(farm_views)
        .values(farm_id=farm_id, input_revision=revision)
        .on_conflict_do_update(
            index_elements=[farm_views.c.farm_id],
            set_={
                "input_revision": revision,
                "status": "queued",
                "error": None,
                "generation": 0,
                "view_version": farm_views.c.view_version + 1,
            },
        )
    )
    return preparation_job("prepare_farm_history", farm_id, revision)


def require_farm_ready(session, farm_id):
    row = session.execute(
        select(farm_views.c.status, farm_views.c.input_revision, farm_table.c.revision)
        .select_from(farm_table.outerjoin(farm_views))
        .where(farm_table.c.id == farm_id)
    ).first()
    if row and (row.status != "done" or row.input_revision != row.revision):
        raise ReadModelNotReadyError("Markernes historik er ikke færdig med at blive beregnet.")


def require_simulation_view_ready(simulation_id, revision):
    with _repository().SessionLocal() as session:
        row = session.execute(
            select(
                simulation_views.c.status,
                simulation_views.c.input_revision,
                simulation_views.c.data.is_not(None).label("has_data"),
            ).where(simulation_views.c.simulation_id == simulation_id)
        ).first()
    if row is None or row.status != "done" or row.input_revision != revision or not row.has_data:
        raise ReadModelNotReadyError("Simuleringens visning er ikke klar endnu.")


def get_farm_view(farm_id, email, *, include_data=True):
    repository = _repository()
    with repository.SessionLocal() as session:
        if not repository._member_exists(session, farm_id, email):
            return None
        columns = [
            farm_table.c.data,
            farm_table.c.revision,
            farm_views.c.status,
            farm_views.c.input_revision,
            farm_views.c.view_version,
            farm_views.c.error,
        ]
        if include_data:
            columns.append(farm_views.c.data.label("view_data"))
        row = session.execute(
            select(*columns)
            .select_from(farm_table.outerjoin(farm_views))
            .where(farm_table.c.id == farm_id)
        ).first()
        if row is None:
            return None
        status = row.status if row.input_revision == row.revision else "queued"
        return {
            "farm": row.data,
            "input_revision": row.revision,
            "view_version": row.view_version or 0,
            "status": status or "queued",
            "error": row.error,
            "data": row.view_data if include_data and status == "done" else None,
        }


def get_simulation_view(farm_id, simulation_id, email, *, include_data=True):
    from app.data.db import farm_member_table
    from app.data.db import simulation_result_table as results
    from app.domain.optimization import SimulationResultSummary
    from app.domain.simulation import Simulation

    columns = [
        setups.c.data.label("setup_data"),
        setups.c.revision,
        setups.c.creation_status,
        simulation_views.c.status.label("view_status"),
        simulation_views.c.input_revision,
        simulation_views.c.view_version,
        simulation_views.c.error,
        simulation_views.c.data["comparison_availability"].label("availability"),
        (
            simulation_views.c.data.is_not(None) & (simulation_views.c.data != insert_json(None))
        ).label("has_view_data"),
    ]
    columns.extend(
        results.c[name].label(f"result_{name}") for name in SimulationResultSummary.model_fields
    )
    if include_data:
        columns.append(simulation_views.c.data.label("view_data"))
    source = setups.join(farm_member_table, farm_member_table.c.farm_id == setups.c.farm_id)
    source = source.outerjoin(results, results.c.simulation_id == setups.c.id)
    source = source.outerjoin(simulation_views, simulation_views.c.simulation_id == setups.c.id)
    with _repository().SessionLocal() as session:
        row = session.execute(
            select(*columns)
            .select_from(source)
            .where(
                setups.c.id == simulation_id,
                setups.c.farm_id == farm_id,
                farm_member_table.c.email == email,
            )
        ).first()
    if row is None:
        return None
    summary = {
        name: row._mapping[f"result_{name}"] for name in SimulationResultSummary.model_fields
    }
    if summary["status"] is None:
        summary = {}
    simulation = Simulation.model_validate(
        {
            **row.setup_data,
            "revision": row.revision,
            "creation_status": row.creation_status,
            "result": summary,
            "comparison_availability": row.availability,
        }
    )
    if row.creation_status != "done":
        status = row.creation_status
    elif row.view_status == "done" and row.input_revision == row.revision and row.has_view_data:
        status = "done"
    elif summary.get("input_revision") == row.revision and summary.get("status") in (
        "queued",
        "in_progress",
    ):
        status = "queued" if summary["status"] == "queued" else "running"
    else:
        status = "missing"
    view_data = row.view_data if include_data and status == "done" else None
    if view_data is not None:
        from app.services.scenario.options import catalog

        view_data = {**view_data, "yearly_optimization_candidates": catalog(simulation)}
    return {
        "simulation": simulation,
        "input_revision": row.revision,
        "view_version": row.view_version or 0,
        "status": status,
        "error": None if status == "missing" else row.error,
        "data": view_data,
    }


def simulation_part(farm_id, simulation_id, email, key):
    view = get_simulation_view(farm_id, simulation_id, email)
    if view is None:
        return None
    if view["data"] is None:
        raise ReadModelNotReadyError("Simuleringens visning er ikke klar endnu.")
    return view["data"][key]


def farm_part(farm_id, email, key):
    view = get_farm_view(farm_id, email)
    if view is None:
        return None
    if view["data"] is None:
        raise ReadModelNotReadyError("Markernes historik er ikke klar endnu.")
    return view["data"][key]


def historical_detail(farm_id, field_id, email):
    with _repository().SessionLocal() as session:
        if not _repository()._member_exists(session, farm_id, email):
            return None
        require_farm_ready(session, farm_id)
        return session.execute(
            select(field_historical_detail_table.c.years)
            .join(field_table, field_table.c.id == field_historical_detail_table.c.field_id)
            .join(farm_table, farm_table.c.id == field_table.c.farm_id)
            .where(
                field_table.c.farm_id == farm_id,
                field_table.c.id == field_id,
                field_historical_detail_table.c.input_revision == farm_table.c.revision,
            )
        ).scalar_one_or_none()


def publish_simulation(session, simulation_id, revision, data, prepared):
    prepared = {"version": 3, "contributions": prepared.get("contributions", {})}
    data = {key: value for key, value in data.items() if key != "yearly_optimization_candidates"}
    statement = insert(simulation_views).values(
        simulation_id=simulation_id,
        input_revision=revision,
        status="done",
        view_version=1,
        data=data,
        prepared=prepared,
    )
    session.execute(
        statement.on_conflict_do_update(
            index_elements=[simulation_views.c.simulation_id],
            set_={
                "input_revision": statement.excluded.input_revision,
                "status": statement.excluded.status,
                "data": statement.excluded.data,
                "prepared": statement.excluded.prepared,
                "view_version": simulation_views.c.view_version + 1,
                "error": None,
            },
        )
    )


def publish_optimization(session, simulation_id, revision, run_id, output):
    data, prepared = build_simulation(session, simulation_id)
    publish_simulation(session, simulation_id, revision, data, prepared)


def invalidate_simulation(session, simulation_id):
    revision = session.execute(
        select(setups.c.revision).where(setups.c.id == simulation_id)
    ).scalar_one()
    session.execute(
        update(simulation_views)
        .where(simulation_views.c.simulation_id == simulation_id)
        .values(input_revision=revision, view_version=simulation_views.c.view_version + 1)
    )


def refresh_simulation_view(session, simulation_id):
    revision = session.execute(
        select(setups.c.revision).where(setups.c.id == simulation_id)
    ).scalar_one()
    data, prepared = build_simulation(session, simulation_id)
    publish_simulation(session, simulation_id, revision, data, prepared)


def insert_json(value):
    from sqlalchemy import bindparam
    from sqlalchemy.dialects.postgresql import JSONB

    return bindparam(None, value, type_=JSONB, unique=True)


def build_simulation(session, simulation_id):
    """Build displays from selected results and cheap library sequences only."""
    from app.data import simulation_store
    from app.data.db import simulation_result_table as results
    from app.domain.simulation import Simulation
    from app.services.scenario.options import contributions as area_contributions

    fields = simulation_store._fields(session, simulation_id)
    setup = session.execute(
        select(setups.c.data, setups.c.fields, results.c.output)
        .join(results)
        .where(setups.c.id == simulation_id)
    ).one()
    simulation = Simulation.model_validate(setup.data)
    output = setup.output or {}
    contributions = area_contributions(simulation, fields, setup.fields)
    years = {}
    for field in fields:
        if field.rotation_id:
            candidates = (
                setup.fields.get(field.id, {}).get("fixed_candidate"),
                setup.fields.get(field.id, {}).get("economics_candidate"),
                output.get("selected_candidates", {}).get(field.id),
                setup.fields.get(field.id, {}).get("manual_candidate"),
            )
            value = next(
                (
                    RotationCandidateEvaluation.model_validate(value)
                    for value in candidates
                    if value
                    and RotationCandidateEvaluation.model_validate(value).ref.to_id()
                    == field.rotation_id
                ),
                None,
            )
            if value is None:
                value = simulation_store._selected_candidate(
                    session, simulation_id, field.id, field.rotation_id
                )
            if value:
                years[field.id] = read_models.compact_years(value)
    previous = session.execute(
        select(simulation_views.c.data["saved_result"]).where(
            simulation_views.c.simulation_id == simulation_id
        )
    ).scalar_one_or_none()
    saved = previous
    if output.get("response") is not None:
        selected = {
            key: RotationCandidateEvaluation.model_validate(value)
            for key, value in output.get("selected_candidates", {}).items()
        }
        saved = {
            "run_id": output.get("run_id") or f"legacy:{simulation_id}",
            "result_revision": output.get("result_revision", 0),
            "response": output["response"],
            "fields_before": output.get("fields_before", []),
            "economics_snapshot": output.get("economics_snapshot", {}),
            "field_years": {
                key: read_models.compact_years(value) for key, value in selected.items()
            },
            "economics_statement": read_models.economics_statement(
                output["response"]["fields"], selected
            ),
        }
    data, contributions = read_models.simulation_data(
        fields, {}, years, saved, catalog=[], contributions=contributions
    )
    return data, {"version": 3, "contributions": contributions}


def schedule_preparation(session, kind, entity_id, *, refresh=False):
    farm = kind == "prepare_farm_history"
    owner, table = (farm_table, farm_views) if farm else (setups, simulation_views)
    key = table.c.farm_id if farm else table.c.simulation_id
    columns = [owner.c.revision]
    if not farm:
        columns.extend([owner.c.farm_id, owner.c.creation_status])
    source = session.execute(
        select(*columns).where(owner.c.id == entity_id).with_for_update()
    ).first()
    if source is None or (not farm and source.creation_status != "done"):
        return None
    state = session.execute(
        select(
            table.c.status,
            table.c.input_revision,
            table.c.generation,
            table.c.view_version,
            (table.c.data.is_not(None) & (table.c.data != insert_json(None))).label("has_data"),
        )
        .where(key == entity_id)
        .with_for_update()
    ).first()
    if state and state.input_revision == source.revision:
        if state.status == "running" or (state.status == "queued" and state.view_version > 0):
            return None
        if not refresh and state.status == "done" and state.has_data:
            return None
    revision = source.revision
    if refresh and farm:
        revision += 1
        session.execute(update(owner).where(owner.c.id == entity_id).values(revision=revision))
    generation = state.generation if state and state.input_revision == revision else 0
    if state and (state.status == "failed" or refresh):
        generation += 1
    values = {
        "input_revision": revision,
        "generation": generation,
        "status": "queued",
        "error": None,
    }
    session.execute(
        insert(table)
        .values(**{key.name: entity_id}, **values, view_version=1)
        .on_conflict_do_update(
            index_elements=[key],
            set_={
                **values,
                "view_version": table.c.view_version + 1,
            },
        )
    )
    return preparation_job(
        kind,
        entity_id if farm else source.farm_id,
        revision,
        None if farm else entity_id,
        generation,
    )


def recover_local_preparations():
    from app.data.creation_store import execution_session
    from app.domain.creation import CreationActiveError

    for table, key, prefix in (
        (farm_views, farm_views.c.farm_id, "farm-history:"),
        (simulation_views, simulation_views.c.simulation_id, ""),
    ):
        with _repository().SessionLocal() as session:
            ids = session.execute(select(key).where(table.c.status.in_(("queued", "running"))))
            ids = list(ids.scalars())
        for entity_id in ids:
            try:
                with execution_session(prefix + entity_id) as session, session.begin():
                    session.execute(
                        update(table)
                        .where(key == entity_id, table.c.status.in_(("queued", "running")))
                        .values(
                            status="failed",
                            view_version=table.c.view_version + 1,
                            error={
                                "code": "PREPARATION_FAILED",
                                "message": "Beregningen blev afbrudt. Prøv igen.",
                            },
                        )
                    )
            except CreationActiveError:
                continue
