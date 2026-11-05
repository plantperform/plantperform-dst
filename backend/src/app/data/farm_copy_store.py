"""Copy committed farm data without sharing identities or starting calculation jobs."""

from collections import defaultdict
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import insert, or_, select
from sqlalchemy.exc import IntegrityError

from app.data import read_model_store, repository
from app.data.db import (
    economics_module_member_table,
    economics_module_table,
    farm_member_table,
    farm_read_model_table,
    farm_table,
    field_historical_detail_table,
    field_table,
    simulation_read_model_table,
    simulation_result_table,
    simulation_table,
)
from app.domain.economics import STANDARD_ID, EconomicsSnapshot
from app.domain.farm import Farm
from app.domain.farm_copy import (
    COPY_SOURCE_EMAIL,
    CopyFarmRequest,
    FarmCopyConflictError,
    FarmCopyLookup,
    FarmCopyNotFoundError,
    FarmCopyPreview,
)

_REFERENCE_KEYS = {
    "farm_id",
    "field_id",
    "simulation_id",
    "run_id",
    "economics_module_id",
    "source_id",
    "field_order",
}
_FIELD_MAPS = {"fields", "field_years", "selected_candidates", "contributions"}
_HISTORY_ERROR = {
    "code": "COPIED_HISTORY_INCOMPLETE",
    "message": "Historikken var ikke færdig ved kopiering. Prøv at beregne historikken igen.",
}


def _matches(data, request):
    return (
        data.get("name", "").strip().casefold() == request.name.casefold()
        and data.get("owner_name", "").strip().casefold() == request.owner_name.casefold()
    )


def _source(session, request):
    rows = session.execute(
        select(farm_table)
        .join(farm_member_table)
        .where(farm_member_table.c.email == COPY_SOURCE_EMAIL)
    ).mappings()
    matches = [dict(row) for row in rows if _matches(row.data, request)]
    if not matches:
        raise FarmCopyNotFoundError
    if len(matches) > 1:
        raise FarmCopyConflictError(
            "Flere bedrifter matcher navnet og ejeren. Bedriftens navn skal være entydigt."
        )
    return matches[0]


def _rows(session, table, condition):
    return [dict(row) for row in session.execute(select(table).where(condition)).mappings()]


def preview(request: FarmCopyLookup) -> FarmCopyPreview:
    with repository.SessionLocal() as session:
        session.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        source = _source(session, request)
        farm_id = source["id"]
        field_data = session.scalars(
            select(field_table.c.data).where(field_table.c.farm_id == farm_id)
        ).all()
        states = session.execute(
            select(
                simulation_table.c.creation_status,
                simulation_result_table.c.status,
                or_(
                    simulation_result_table.c.output["response"].astext.is_not(None),
                    simulation_read_model_table.c.data["saved_result"].astext.is_not(None),
                ).label("has_saved_result"),
            )
            .select_from(
                simulation_table.outerjoin(simulation_result_table).outerjoin(
                    simulation_read_model_table
                )
            )
            .where(simulation_table.c.farm_id == farm_id)
        ).all()
        history = session.execute(
            select(farm_read_model_table).where(farm_read_model_table.c.farm_id == farm_id)
        ).first()
        unfinished = (
            history is None
            or history.status != "done"
            or history.input_revision != source["revision"]
            or any(
                state.creation_status != "done" or state.status in ("queued", "in_progress")
                for state in states
            )
        )
        return FarmCopyPreview(
            source_farm=Farm.model_validate(source["data"]),
            field_count=len(field_data),
            area_ha=sum(field["area_ha"] for field in field_data),
            simulation_count=len(states),
            saved_result_count=sum(state.has_saved_result for state in states),
            has_unfinished_calculations=unfinished,
        )


def _documents(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _documents(child)
    elif isinstance(value, list):
        for child in value:
            yield from _documents(child)


def _remap(value, mapping, key=None):
    """Stored documents use snake_case. Only ownership IDs and field-map keys change."""
    if isinstance(value, dict):
        copied = {
            mapping[name] if key in _FIELD_MAPS else name: _remap(child, mapping, name)
            for name, child in value.items()
        }
        if "id" in value and "farm_id" in value:
            # Also covers fields retained only in old scenario/results snapshots.
            copied["id"] = mapping[value["id"]]
        return copied
    if isinstance(value, list):
        return [
            _remap(child, mapping, "field_order" if key == "field_order" else None)
            for child in value
        ]
    if isinstance(value, str):
        if key in _REFERENCE_KEYS:
            return mapping[value]
        if key == "id":
            return mapping.get(value, value)
    return value


def _copy_modules(session, documents, mapping, email):
    referenced, snapshots = set(), {}
    for doc in _documents(documents):
        for key in ("economics_module_id", "source_id"):
            if doc.get(key) and doc[key] != STANDARD_ID:
                referenced.add(doc[key])
        if "source_id" in doc and "overrides" in doc:
            snapshot = EconomicsSnapshot.model_validate(doc)
            previous = snapshots.get(snapshot.source_id)
            if previous is None or snapshot.revision > previous.revision:
                snapshots[snapshot.source_id] = snapshot
    modules = {
        row["id"]: row
        for row in _rows(
            session, economics_module_table, economics_module_table.c.id.in_(referenced)
        )
    }
    for source_id in sorted(referenced):
        module = modules.get(source_id)
        if module is None:
            if source_id not in snapshots:
                raise FarmCopyConflictError(
                    "Et økonomimodul mangler. "
                    "Ret scenariets økonomi på kildebedriften og prøv igen."
                )
            module = snapshots[source_id].model_dump(mode="json", by_alias=True)
        new_id = mapping[source_id]
        values = {key: module[key] for key in ("name", "revision", "overrides")}
        session.execute(insert(economics_module_table).values(id=new_id, **values))
        session.execute(insert(economics_module_member_table).values(module_id=new_id, email=email))


def _reset_result(result, saved):
    output = result.get("output") or {}
    if output.get("response") is None and saved:
        output = result["output"] = {
            key: saved[key]
            for key in (
                "run_id",
                "result_revision",
                "response",
                "fields_before",
                "economics_snapshot",
            )
            if key in saved
        }
    if output.get("response") is not None:
        output.setdefault(
            "run_id", (saved or {}).get("run_id") or result.get("run_id") or str(uuid4())
        )
        output.setdefault("result_revision", result.get("result_revision") or 0)
    result.update(
        lease_token=None, lease_expires_at=None, attempts=0, requested_by=None, published_at=None
    )
    if result["status"] in ("queued", "in_progress"):
        has_saved = output.get("response") is not None
        result.update(
            status="outdated" if has_saved else "not_started",
            run_id=output.get("run_id") if has_saved else None,
            input_revision=output.get("result_revision") if has_saved else None,
            result_revision=output.get("result_revision") if has_saved else None,
            parameters={},
            queued_at=None,
            started_at=None,
            finished_at=None,
            error=None,
        )
    return result


def _farm_history(farm, fields, view):
    if not fields:
        return {
            "farm_id": farm["id"],
            "input_revision": farm["revision"],
            "status": "done",
            "view_version": 1,
            "data": {"fields": [], "field_years": {}, "yearly_summary": []},
        }
    view = view or {"farm_id": farm["id"], "input_revision": farm["revision"]}
    if (
        view.get("status") != "done"
        or view["input_revision"] != farm["revision"]
        or view.get("data") is None
    ):
        view.update(status="failed", input_revision=farm["revision"], error=_HISTORY_ERROR)
    view["generation"] = 0
    return view


def _load_state(session, source):
    """Rows are ordered so parents are inserted before their children."""
    farm_id = source["id"]
    fields = select(field_table.c.id).where(field_table.c.farm_id == farm_id)
    simulations = select(simulation_table.c.id).where(simulation_table.c.farm_id == farm_id)
    state = {farm_table: [{key: source[key] for key in ("id", "data", "revision")}]}
    for table, condition in (
        (field_table, field_table.c.farm_id == farm_id),
        (field_historical_detail_table, field_historical_detail_table.c.field_id.in_(fields)),
        (farm_read_model_table, farm_read_model_table.c.farm_id == farm_id),
        (simulation_table, simulation_table.c.farm_id == farm_id),
        (simulation_result_table, simulation_result_table.c.simulation_id.in_(simulations)),
        (simulation_read_model_table, simulation_read_model_table.c.simulation_id.in_(simulations)),
    ):
        state[table] = _rows(session, table, condition)
    return state


def _copy_snapshot(session, source, destination_id, email):
    state = _load_state(session, source)
    for simulation in state[simulation_table]:
        simulation["data"].pop("economics_recalculation", None)
        simulation["creation_status"] = "done"

    mapping = defaultdict(
        lambda: str(uuid4()), {source["id"]: destination_id, STANDARD_ID: STANDARD_ID}
    )
    _copy_modules(session, list(state.values()), mapping, email)
    state = {table: _remap(rows, mapping) for table, rows in state.items()}
    farm = state[farm_table][0]
    history = next(iter(state[farm_read_model_table]), None)
    state[farm_read_model_table] = [_farm_history(farm, state[field_table], history)]

    results = {row["simulation_id"]: row for row in state[simulation_result_table]}
    views = {row["simulation_id"]: row for row in state[simulation_read_model_table]}
    rebuild = []
    for simulation in state[simulation_table]:
        simulation_id = simulation["id"]
        view = views.get(simulation_id)
        saved = (view.get("data") or {}).get("saved_result") if view else None
        result = results.setdefault(
            simulation_id, {"simulation_id": simulation_id, "status": "not_started"}
        )
        _reset_result(result, saved)
        if view is None or view["data"] is None or view["input_revision"] != simulation["revision"]:
            rebuild.append(simulation_id)
        if view:
            view.update(
                status="done" if view["data"] is not None else "failed", generation=0, error=None
            )
    state[simulation_result_table] = list(results.values())

    for table, rows in state.items():
        for row in rows:
            session.execute(insert(table).values(**row))
    session.execute(insert(farm_member_table).values(farm_id=destination_id, email=email))
    for simulation_id in rebuild:
        # Rebuild displays from stored values, without starting any calculation jobs.
        read_model_store.refresh_simulation_view(session, simulation_id)
    return Farm.model_validate(farm["data"])


def copy_farm(request: CopyFarmRequest, email: str) -> Farm:
    destination_id = str(
        uuid5(
            NAMESPACE_URL,
            f"plantperform:farm-copy:{email}:{request.source_farm_id}:{request.request_id}",
        )
    )
    try:
        with repository.SessionLocal() as session:
            session.connection(execution_options={"isolation_level": "REPEATABLE READ"})
            existing = repository._get_farm(session, destination_id, email)
            if existing is not None:
                if not _matches(existing.model_dump(), request):
                    raise FarmCopyConflictError("Kopierings-id er allerede brugt. Start forfra.")
                return existing
            source = _source(session, request)
            if source["id"] != request.source_farm_id:
                raise FarmCopyNotFoundError
            farm = _copy_snapshot(session, source, destination_id, email)
            session.commit()
            return farm
    except IntegrityError:
        # Concurrent retries may both read before the first transaction commits.
        existing = repository.get_farm(destination_id, email)
        if existing is not None:
            return existing
        raise
