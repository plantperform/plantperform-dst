"""Copy committed farm data without sharing identities or starting calculation jobs."""

from collections import defaultdict
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from sqlalchemy import insert, or_, select
from sqlalchemy.exc import IntegrityError

from app.data import farm_copy_definitions, read_model_store, repository
from app.data.db import (
    farm_member_table,
    farm_read_model_table,
    farm_table,
    field_historical_detail_table,
    field_table,
    simulation_quota_value_table,
    simulation_read_model_table,
    simulation_result_table,
    simulation_table,
)
from app.domain.economics import STANDARD_ID
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
    "base_run_id",
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


def _remap(value, mapping, key=None):
    """Stored documents use snake_case. Only ownership IDs and field-map keys change."""
    if key == "rotation_groups":
        # Definition identities belong to the rotation copy, even if a variant ID
        # happens to equal a farm or field ID.
        return value
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


def _restore_captured_economics(state):
    """Use the displayed economics for completed results copied from a shared farm."""
    setups = {row["id"]: row["data"] for row in state[simulation_table]}
    saved = {
        row["simulation_id"]: (row["data"] or {}).get("saved_result") or {}
        for row in state[simulation_read_model_table]
    }
    for row in state[simulation_result_table]:
        output = row["output"] or {}
        captured = (row["parameters"] or {}).get("simulation_settings")
        if captured is not None:
            # Job inputs can outlive the run that produced the displayed result.
            # Bind the copy's captured economics to the available result or setup.
            simulation_id = row["simulation_id"]
            applied = (
                output.get("economics_snapshot")
                or saved.get(simulation_id, {}).get("economics_snapshot")
                or setups[simulation_id].get("economics_snapshot")
                or {}
            )
            captured["economics_snapshot"] = applied
            captured["economics_module_id"] = applied.get("source_id") or STANDARD_ID


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
                "rotation_groups",
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


def _copy_snapshot(session, source, destination_id, email, *, member_copy=False):
    state = _load_state(session, source)
    if member_copy:
        farm_data = state[farm_table][0]["data"]
        farm_data["name"] = f"Kopi af {farm_data['name']}"
        simulations = [row["id"] for row in state[simulation_table]]
        curves = _rows(
            session,
            simulation_quota_value_table,
            simulation_quota_value_table.c.simulation_id.in_(simulations)
            & (simulation_quota_value_table.c.status == "completed"),
        )
        for curve in curves:
            curve["requested_by"] = None
        state[simulation_quota_value_table] = curves
    for simulation in state[simulation_table]:
        simulation["data"].pop("economics_recalculation", None)
        simulation["creation_status"] = "done"

    mapping = defaultdict(
        lambda: str(uuid4()), {source["id"]: destination_id, STANDARD_ID: STANDARD_ID}
    )
    if member_copy:
        _restore_captured_economics(state)
    else:
        farm_copy_definitions.copy_definitions(session, state, email)
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
    return _copy_farm(request.source_farm_id, request.request_id, email, course_request=request)


def duplicate_farm(farm_id: str, request_id: UUID, email: str) -> Farm:
    return _copy_farm(farm_id, request_id, email)


def _copy_farm(farm_id, request_id, email, *, course_request=None):
    operation = "farm-copy" if course_request else "farm-duplicate"
    destination_id = str(
        uuid5(NAMESPACE_URL, f"plantperform:{operation}:{email}:{farm_id}:{request_id}")
    )
    try:
        with repository.SessionLocal() as session:
            session.connection(execution_options={"isolation_level": "REPEATABLE READ"})
            if course_request is None:
                source = (
                    session.execute(
                        select(farm_table)
                        .join(farm_member_table)
                        .where(farm_table.c.id == farm_id, farm_member_table.c.email == email)
                    )
                    .mappings()
                    .one_or_none()
                )
                if source is None:
                    raise FarmCopyNotFoundError
            existing = repository._get_farm(session, destination_id, email)
            if existing is not None:
                if course_request and not _matches(existing.model_dump(), course_request):
                    raise FarmCopyConflictError("Kopierings-id er allerede brugt. Start forfra.")
                return existing
            if course_request:
                source = _source(session, course_request)
                if source["id"] != farm_id:
                    raise FarmCopyNotFoundError
            if session.scalar(select(farm_table.c.id).where(farm_table.c.id == destination_id)):
                raise FarmCopyConflictError("Kopierings-id er allerede brugt. Start forfra.")
            farm = _copy_snapshot(
                session, source, destination_id, email, member_copy=course_request is None
            )
            session.commit()
            return farm
    except IntegrityError:
        # Concurrent retries may both read before the first transaction commits.
        existing = repository.get_farm(destination_id, email)
        if existing is not None:
            return existing
        raise
