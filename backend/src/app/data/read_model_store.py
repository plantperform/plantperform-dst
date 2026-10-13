"""Persist small views; read paths never build them or load candidate documents."""

from copy import deepcopy

from sqlalchemy import func, select, update
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
    status = row.view_status if row.input_revision == row.revision else "queued"
    if row.creation_status != "done":
        status = row.creation_status
    return {
        "simulation": simulation,
        "input_revision": row.revision,
        "view_version": row.view_version or 0,
        "status": status or "queued",
        "error": row.error,
        "data": row.view_data if include_data and status == "done" else None,
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
    prepared = read_models.normalize_prepared(prepared)
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
    from app.data import simulation_store

    row = session.execute(
        select(simulation_views.c.data, simulation_views.c.prepared).where(
            simulation_views.c.simulation_id == simulation_id
        )
    ).first()
    if row is None or row.data is None:
        # Backfill is performed on the worker, never on an API read.
        data, prepared = build_simulation(session, simulation_id)
    else:
        data, prepared = row.data, row.prepared
    prepared = read_models.normalize_prepared(prepared)
    field_years = {
        key: read_models.compact_years(RotationCandidateEvaluation.model_validate(value))
        for key, value in output["selected_candidates"].items()
    }
    saved = {
        "run_id": run_id,
        "result_revision": revision,
        "response": output["response"],
        "fields_before": output["fields_before"],
        "field_years": field_years,
    }
    fields = simulation_store._fields(session, simulation_id)
    contributions = {}
    for field in fields:
        entry = read_models.ensure_prepared_field(prepared, field.id)
        chosen = output["selected_candidates"].get(field.id)
        entry["overlays"]["selected"] = (
            read_models.compact_candidate_metadata(
                RotationCandidateEvaluation.model_validate(chosen)
            )
            if chosen
            else None
        )
        effective = read_models.overlay_metadata(
            read_models.prepared_base(prepared, entry),
            [entry["overlays"].get(key) for key in ("manual", "selected", "fixed")],
        )
        contributions[field.id] = read_models.field_contribution(field, effective)
    # Current fields retain explicit manual/fixed overlays; comparisons keep immutable output.
    current_years = dict(field_years)
    setup_fields = session.execute(select(setups.c.fields).where(setups.c.id == simulation_id))
    for field_id, setup in setup_fields.scalar_one().items():
        if setup.get("fixed_candidate"):
            current_years[field_id] = read_models.compact_years(
                RotationCandidateEvaluation.model_validate(setup["fixed_candidate"])
            )
    new_data, contributions = read_models.simulation_data(
        fields,
        {},
        current_years,
        saved,
        catalog=data["yearly_optimization_candidates"],
        contributions=contributions,
    )
    prepared["contributions"] = contributions
    publish_simulation(session, simulation_id, revision, new_data, prepared)


def invalidate_simulation(session, simulation_id):
    revision = session.execute(
        select(setups.c.revision).where(setups.c.id == simulation_id)
    ).scalar_one()
    session.execute(
        update(simulation_views)
        .where(simulation_views.c.simulation_id == simulation_id)
        .values(input_revision=revision, view_version=simulation_views.c.view_version + 1)
    )


def update_field_view(session, simulation_id, field, setup):
    row = session.execute(
        select(
            simulation_views.c.data,
            simulation_views.c.prepared["fields"][field.id].label("field_prepared"),
            simulation_views.c.prepared["contributions"].label("contributions"),
        ).where(simulation_views.c.simulation_id == simulation_id)
    ).first()
    if row is None or row.data is None:
        return
    data = deepcopy(row.data)
    entry = deepcopy(row.field_prepared or {"base": [], "overlays": {}})
    if "base_set" in entry:
        base = session.execute(
            select(simulation_views.c.prepared["candidate_sets"][entry["base_set"]]).where(
                simulation_views.c.simulation_id == simulation_id
            )
        ).scalar_one()
        metadata = read_models.compact_candidate_metadata
    else:
        base = entry["base"]
        metadata = read_models.candidate_metadata
    for key in ("manual", "fixed"):
        value = setup.get(f"{key}_candidate")
        entry["overlays"][key] = (
            metadata(RotationCandidateEvaluation.model_validate(value)) if value else None
        )
    effective = read_models.overlay_metadata(
        base, [entry["overlays"].get(key) for key in ("manual", "selected", "fixed")]
    )
    contributions = dict(row.contributions or {})
    contributions[field.id] = read_models.field_contribution(field, effective)
    data["fields"] = [
        field.model_dump(mode="json") if value["id"] == field.id else value
        for value in data["fields"]
    ]
    chosen = setup.get("fixed_candidate") or setup.get("manual_candidate")
    if (
        chosen
        and RotationCandidateEvaluation.model_validate(chosen).ref.to_id() == field.rotation_id
    ):
        data["field_years"][field.id] = read_models.compact_years(
            RotationCandidateEvaluation.model_validate(chosen)
        )
    if field.rotation_id is None:
        data["field_years"].pop(field.id, None)
    data["yearly_summary"] = read_models.yearly_totals(
        read_models.parsed_fields(data), data["field_years"]
    )
    data["crop_area_ranges"] = read_models.combine_contributions(contributions)
    session.execute(
        update(simulation_views)
        .where(simulation_views.c.simulation_id == simulation_id)
        .values(
            data=data,
            prepared=func.jsonb_set(
                func.jsonb_set(
                    simulation_views.c.prepared, ["fields", field.id], insert_json(entry)
                ),
                ["contributions"],
                insert_json(contributions),
            ),
        )
    )


def insert_json(value):
    from sqlalchemy import bindparam
    from sqlalchemy.dialects.postgresql import JSONB

    return bindparam(None, value, type_=JSONB, unique=True)


def build_simulation(session, simulation_id):
    """Worker-only backfill: compact caches, with only selected rich evaluations."""
    from app.data import simulation_store
    from app.data.db import simulation_field_candidates_table as caches
    from app.data.db import simulation_result_table as results

    fields = simulation_store._fields(session, simulation_id)
    setup = session.execute(
        select(setups.c.fields, results.c.output).join(results).where(setups.c.id == simulation_id)
    ).one()
    output = setup.output or {}
    prepared = read_models.PreparedMetadata()
    catalog = read_models.RotationCatalog()
    fields_by_id = {field.id: field for field in fields}
    contributions, years = {}, {}
    for row in session.execute(
        select(caches.c.field_id, caches.c.optimizer_input)
        .where(caches.c.simulation_id == simulation_id)
        .execution_options(yield_per=1)
    ):
        from app.data.optimizer_inputs import parse_optimizer_input

        candidates = parse_optimizer_input(row.optimizer_input)
        base = [read_models.candidate_metadata(candidate) for candidate in candidates.candidates]
        overlays = {}
        for name, value in [
            ("manual", setup.fields.get(row.field_id, {}).get("manual_candidate")),
            ("selected", output.get("selected_candidates", {}).get(row.field_id)),
            ("fixed", setup.fields.get(row.field_id, {}).get("fixed_candidate")),
        ]:
            overlays[name] = (
                read_models.candidate_metadata(RotationCandidateEvaluation.model_validate(value))
                if value
                else None
            )
        prepared.add_field(row.field_id, base, overlays)
        effective = read_models.overlay_metadata(
            base, [overlays.get(key) for key in ("manual", "selected", "fixed")]
        )
        catalog.add(effective)
        if row.field_id in fields_by_id:
            contributions[row.field_id] = read_models.field_contribution(
                fields_by_id[row.field_id], effective
            )
        del candidates, base, overlays, effective, row
    for field in fields:
        read_models.ensure_prepared_field(prepared.data, field.id)
        contributions.setdefault(field.id, [])
        if field.rotation_id:
            value = simulation_store._selected_candidate(
                session, simulation_id, field.id, field.rotation_id
            )
            if value:
                years[field.id] = read_models.compact_years(value)
    result = session.execute(
        select(
            results.c.run_id,
            results.c.result_revision,
            results.c.input_revision,
            results.c.status,
            simulation_views.c.data["saved_result"].label("saved_result"),
        )
        .select_from(
            results.outerjoin(
                simulation_views, simulation_views.c.simulation_id == results.c.simulation_id
            )
        )
        .where(results.c.simulation_id == simulation_id)
    ).one()
    saved = result.saved_result
    if output.get("response") is not None and (saved is None or output.get("run_id")):
        # Older records cannot recover a successful token once a newer run replaced it.
        run_id = output.get("run_id") or (
            result.run_id
            if result.status == "completed"
            else f"legacy:{simulation_id}:{result.result_revision}"
        )
        saved = {
            "run_id": run_id,
            "result_revision": result.result_revision,
            "response": output["response"],
            "fields_before": output.get("fields_before", []),
            "field_years": {
                key: read_models.compact_years(RotationCandidateEvaluation.model_validate(value))
                for key, value in output.get("selected_candidates", {}).items()
            },
        }
    data, contributions = read_models.simulation_data(
        fields, {}, years, saved, catalog=catalog.build(), contributions=contributions
    )
    prepared.data["contributions"] = contributions
    return data, prepared.data


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
