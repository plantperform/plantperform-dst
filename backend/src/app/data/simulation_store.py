"""Simulation aggregates. Always lock setup before result when changing either."""

from copy import deepcopy

from sqlalchemy import delete, func, select, update

from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.domain.field import FieldRecord, validate_measures_for_rotation
from app.domain.optimization import (
    OptimizeSimulationRequest,
    SimulationResult,
    SimulationResultSummary,
    YearlyOptimizeSimulationRequest,
)
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    SimulationFieldCandidates,
)
from app.domain.simulation import OptimizationConstraints, Simulation

OUTPUT_KEYS = ("crop_rotation", "rotation_id", "db2", "n_load", "leaching", "fen")
DEFAULT_VALUES = dict(crop_rotation=[], rotation_id=None, db2=0, n_load=0, leaching=0, fen=0)


class SetupRevisionConflictError(Exception):
    pass


def _common():
    # Import lazily: repository exposes this store's public methods as its facade.
    from app.data import repository

    return repository


def split_field(data: dict) -> dict:
    setup = {key: deepcopy(value) for key, value in data.items() if key not in OUTPUT_KEYS}
    values = {key: deepcopy(data.get(key, DEFAULT_VALUES[key])) for key in OUTPUT_KEYS}
    if data.get("allowed_rotation_ids"):
        setup["fixed"] = values
    elif not data.get("rotation_id"):
        setup["baseline"] = values
    return setup


def project_fields(
    fields: dict, order: list, output: dict | None, result_revision: int | None = None
) -> list[FieldRecord]:
    previous = {
        field["id"]: field for field in (output or {}).get("response", {}).get("fields", [])
    }
    projected = []
    for field_id in order:
        setup = fields[field_id]
        values = {**DEFAULT_VALUES, **setup.get("baseline", {})}
        if field_id in previous:
            values.update(
                {key: previous[field_id].get(key, DEFAULT_VALUES[key]) for key in OUTPUT_KEYS}
            )
        if setup.get("baseline_revision", -1) > (
            result_revision if result_revision is not None else -1
        ):
            values.update(setup.get("baseline", {}))
        if setup.get("allowed_rotation_ids"):
            values.update(setup.get("fixed", {}))
        projected.append(FieldRecord.model_validate({**setup, **values}))
    return projected


def read_result(row) -> SimulationResult:
    output = getattr(row, "output", None) or {}
    request_type = (
        YearlyOptimizeSimulationRequest if row.kind == "yearly" else OptimizeSimulationRequest
    )
    parameters = (
        request_type.model_validate(row.parameters).model_dump(mode="json", by_alias=True)
        if row.parameters
        else {}
    )
    return SimulationResult.model_validate(
        {
            **dict(row._mapping),
            "parameters": parameters,
            "response": output.get("response"),
            "fields_before": output.get("fields_before", []),
            "economics_snapshot": output.get("economics_snapshot", {}),
            "selected_candidates": output.get("selected_candidates", {}),
        }
    )


def _row(
    session,
    farm_id,
    simulation_id,
    email,
    *,
    lock=False,
    include_data=True,
    ready=False,
    editable=False,
):
    columns = [setups.c.revision, setups.c.creation_status]
    if include_data:
        columns.append(setups.c.data)
    query = select(*columns).where(
        setups.c.id == simulation_id,
        setups.c.farm_id == farm_id,
    )
    if not _common()._member_exists(session, farm_id, email):
        return None
    if lock:
        query = query.with_for_update()
    row = session.execute(query).first()
    if row is not None and (lock or ready):
        from app.data.creation_store import require_ready

        require_ready(session, simulation_id)
        if editable:
            from app.data.simulation_settings_store import require_idle

            require_idle(session, simulation_id)
    return row


def _model(session, simulation_id, row):
    from app.data.db import simulation_read_model_table as views

    result = session.execute(
        select(
            *[results.c[name] for name in SimulationResultSummary.model_fields],
            views.c.data["comparison_availability"].label("comparison_availability"),
        )
        .select_from(results.outerjoin(views, views.c.simulation_id == results.c.simulation_id))
        .where(results.c.simulation_id == simulation_id)
    ).first()
    summary = SimulationResultSummary.model_validate(dict(result._mapping)) if result else None
    return Simulation.model_validate(
        {
            **row.data,
            "revision": row.revision,
            "result": summary or {},
            "creation_status": row.creation_status,
            "comparison_availability": result.comparison_availability if result else None,
        }
    )


def _get_simulation(session, farm_id, simulation_id, email):
    row = _row(session, farm_id, simulation_id, email)
    return _model(session, simulation_id, row) if row else None


def invalidate(session, simulation_id):
    session.execute(
        update(setups)
        .where(setups.c.id == simulation_id)
        .values(
            revision=setups.c.revision + 1,
            updated_at=func.now(),
        )
    )
    session.execute(
        update(results)
        .where(
            results.c.simulation_id == simulation_id,
        )
        .values(status="outdated", lease_token=None, lease_expires_at=None)
    )
    from app.data.read_model_store import invalidate_simulation

    invalidate_simulation(session, simulation_id)


def get_simulation(farm_id, simulation_id, email):
    with _common().SessionLocal() as session:
        return _get_simulation(session, farm_id, simulation_id, email)


def list_simulations(farm_id, email):
    from app.data.db import simulation_read_model_table as views

    with _common().SessionLocal() as session:
        if not _common()._farm_exists(session, farm_id, email):
            return None
        rows = session.execute(
            select(setups.c.id, setups.c.data, setups.c.revision, setups.c.creation_status)
            .where(setups.c.farm_id == farm_id)
            .order_by(setups.c.created_at)
        ).all()
        summaries = {
            r.simulation_id: SimulationResultSummary.model_validate(dict(r._mapping))
            for r in session.execute(
                select(
                    results.c.simulation_id,
                    *[results.c[name] for name in SimulationResultSummary.model_fields],
                    views.c.data["comparison_availability"].label("comparison_availability"),
                )
                .select_from(
                    results.join(setups).outerjoin(
                        views, views.c.simulation_id == results.c.simulation_id
                    )
                )
                .where(setups.c.farm_id == farm_id)
            )
        }
        availability = dict(
            session.execute(
                select(views.c.simulation_id, views.c.data["comparison_availability"])
                .join(setups)
                .where(setups.c.farm_id == farm_id)
            ).all()
        )
        return [
            Simulation.model_validate(
                {
                    **row.data,
                    "revision": row.revision,
                    "result": summaries.get(row.id, {}),
                    "creation_status": row.creation_status,
                    "comparison_availability": availability.get(row.id),
                }
            )
            for row in rows
        ]


def get_result(farm_id, simulation_id, email, *, include_output=True):
    with _common().SessionLocal() as session:
        if _row(session, farm_id, simulation_id, email) is None:
            return None
        columns = (
            list(results.c) if include_output else [c for c in results.c if c.name != "output"]
        )
        row = session.execute(
            select(*columns).where(results.c.simulation_id == simulation_id)
        ).one()
        return read_result(row)


def _fields(session, simulation_id):
    row = session.execute(
        select(
            setups.c.fields,
            setups.c.field_order,
            results.c.output["response"]["fields"],
            results.c.result_revision,
        )
        .join(results)
        .where(setups.c.id == simulation_id)
    ).one()
    return project_fields(
        row.fields, row.field_order, {"response": {"fields": row[2] or []}}, row.result_revision
    )


def list_simulation_fields(farm_id, simulation_id, email):
    with _common().SessionLocal() as session:
        if _row(session, farm_id, simulation_id, email, ready=True) is None:
            return None
        return _fields(session, simulation_id)


def _field(session, simulation_id, field_id):
    from sqlalchemy import cast, literal
    from sqlalchemy.dialects.postgresql import JSONPATH

    setup = setups.c.fields[field_id] - "fixed_candidate" - "manual_candidate"
    previous = func.jsonb_path_query_first(
        results.c.output,
        cast(literal("$.response.fields[*] ? (@.id == $id)"), JSONPATH),
        func.jsonb_build_object("id", field_id),
    )
    row = session.execute(
        select(setup, previous, results.c.result_revision)
        .select_from(setups.join(results))
        .where(setups.c.id == simulation_id)
    ).first()
    if row is None or row[0] is None:
        return None
    fields = project_fields(
        {field_id: row[0]},
        [field_id],
        {"response": {"fields": [row[1]] if row[1] else []}},
        row.result_revision,
    )
    return fields[0]


def get_simulation_field(farm_id, simulation_id, field_id, email):
    with _common().SessionLocal() as session:
        if _row(session, farm_id, simulation_id, email, include_data=False, ready=True) is None:
            return None
        return _field(session, simulation_id, field_id)


def get_simulation_field_context(farm_id, simulation_id, field_id, email):
    from types import SimpleNamespace

    with _common().SessionLocal() as session:
        if _row(session, farm_id, simulation_id, email, include_data=False, ready=True) is None:
            return None
        setup = session.execute(
            select(setups.c.fields[field_id]).where(setups.c.id == simulation_id)
        ).scalar_one_or_none()
        if setup is None:
            return None
        if "calculation_context" in setup:
            value = setup["calculation_context"]
            registry = SimpleNamespace(**value) if value else None
        else:
            registry = _common()._registry_context_for_imk_id(session, setup.get("imk_id"))
        from app.services.rotations.historisk_goedning import real_history_lookback
        from app.services.soil.jbnr import FALLBACK_JBNR

        jbnr = registry.jbnr if registry and registry.jbnr is not None else FALLBACK_JBNR
        history = (
            real_history_lookback(
                registry.crop_history or {}, jbnr, registry.goedningsregion, bool(registry.oeko)
            )
            if registry
            else None
        )
        return SimpleNamespace(
            jbnr=jbnr, real_history=history, soil_data=_common()._soil_data_for_context(registry)
        )


def merge_candidates(
    data: dict | SimulationFieldCandidates, selected: dict | None
) -> SimulationFieldCandidates:
    row = (
        data
        if isinstance(data, SimulationFieldCandidates)
        else SimulationFieldCandidates.model_validate(data)
    )
    if selected:
        candidate = RotationCandidateEvaluation.model_validate(selected)
        kept = [c for c in row.candidates if c.ref.to_id() != candidate.ref.to_id()]
        row = row.model_copy(update={"candidates": [*kept, candidate]})
    return row


def selected_evaluations(farm_id, simulation_id, email):
    """Read only the chosen evaluations, from selected reports and current field overlays."""
    with _common().SessionLocal() as session:
        if _row(session, farm_id, simulation_id, email, include_data=False, ready=True) is None:
            return None
        fields = _fields(session, simulation_id)
        chosen_fields = [field for field in fields if field.rotation_id is not None]
        if not chosen_fields:
            return fields, {}
        row = session.execute(
            select(setups.c.fields, results.c.output["selected_candidates"])
            .join(results)
            .where(setups.c.id == simulation_id)
        ).one()
        selected = row[1] or {}
        chosen = {}
        for field in chosen_fields:
            setup = row.fields.get(field.id, {})
            for overlay in (
                setup.get("fixed_candidate"),
                setup.get("economics_candidate"),
                selected.get(field.id),
                setup.get("manual_candidate"),
            ):
                if overlay and RotationCandidateRef.model_validate(overlay["ref"]).to_id() == (
                    field.rotation_id
                ):
                    chosen[field.id] = RotationCandidateEvaluation.model_validate(overlay)
                    break
        return fields, chosen


def _selected_candidate(session, simulation_id, field_id, rotation_id):
    from sqlalchemy import case

    from app.data.read_model_store import insert_json

    ref = RotationCandidateRef.from_id(rotation_id)
    overlays = (
        setups.c.fields[field_id]["fixed_candidate"],
        setups.c.fields[field_id]["economics_candidate"],
        results.c.output["selected_candidates"][field_id],
        setups.c.fields[field_id]["manual_candidate"],
    )
    chosen = func.coalesce(
        *[
            case((value["ref"] == insert_json(ref.model_dump(mode="json")), value))
            for value in overlays
        ]
    )
    value = session.execute(
        select(chosen).select_from(setups.join(results)).where(setups.c.id == simulation_id)
    ).scalar_one_or_none()
    return RotationCandidateEvaluation.model_validate(value) if value else None


def get_simulation_field_candidate_detail(farm_id, simulation_id, field_id, email):
    with _common().SessionLocal() as session:
        if _row(session, farm_id, simulation_id, email, include_data=False, ready=True) is None:
            return None
        field = _field(session, simulation_id, field_id)
        if field is None:
            return None
        if field.rotation_id is None:
            raise _common().FieldNotOptimizedError
        return _selected_candidate(session, simulation_id, field_id, field.rotation_id)


def delete_simulation(farm_id, simulation_id, email):
    with _common().SessionLocal.begin() as session:
        if not _common()._farm_exists(session, farm_id, email):
            return None
        return (
            session.execute(
                delete(setups).where(
                    setups.c.id == simulation_id,
                    setups.c.farm_id == farm_id,
                )
            ).rowcount
            > 0
        )


def merge_constraints(saved, patch, field_count):
    merged = OptimizationConstraints.model_validate(
        {
            **_common()._dump(saved),
            **patch.model_dump(mode="json", exclude_unset=True),
        }
    )
    if (
        "max_fields_with_new_rotation" in patch.model_fields_set
        and merged.max_fields_with_new_rotation is not None
        and merged.max_fields_with_new_rotation > field_count
    ):
        raise ValueError(
            "Maximum fields with new rotations cannot exceed the simulation field count"
        )
    return merged


def update_simulation_constraints(farm_id, simulation_id, constraints, email):
    with _common().SessionLocal.begin() as session:
        row = _row(session, farm_id, simulation_id, email, lock=True, editable=True)
        if row is None:
            return None
        simulation = _model(session, simulation_id, row)
        supplied = constraints.model_fields_set
        count = session.execute(
            select(func.jsonb_array_length(setups.c.field_order)).where(
                setups.c.id == simulation_id
            )
        ).scalar_one()
        merged = merge_constraints(simulation.constraints, constraints, count)
        if (
            "globally_allowed_rotation_ids" in supplied
            and merged.globally_allowed_rotation_ids is not None
        ):
            farm = _common()._get_farm(session, farm_id, email)
            library_ids = {rotation.id for rotation in farm.rotation_library}
            for rotation_id in merged.globally_allowed_rotation_ids:
                if rotation_id not in library_ids:
                    raise ValueError(f"Unknown globally allowed rotation id: {rotation_id}")
        session.execute(
            update(setups)
            .where(setups.c.id == simulation_id)
            .values(
                data={**row.data, "constraints": _common()._dump(merged)},
            )
        )
        invalidate(session, simulation_id)
        return _get_simulation(session, farm_id, simulation_id, email)


def _save_field(session, simulation_id, field, candidate=None):
    row = session.execute(
        select(setups.c.fields[field.id], setups.c.revision).where(setups.c.id == simulation_id)
    ).one()
    revision = row.revision
    previous = row[0] or {}
    setup_field = split_field(_common()._dump(field))
    for key in (
        "manual_candidate",
        "economics_candidate",
        "baseline_candidate",
        "calculation_context",
    ):
        if key in previous:
            setup_field[key] = previous[key]
    if field.allowed_rotation_ids:
        selected = candidate
        previous_candidate = previous.get("fixed_candidate")
        if (
            selected is None
            and previous_candidate
            and RotationCandidateRef.model_validate(previous_candidate["ref"]).to_id()
            == field.rotation_id
        ):
            selected = previous_candidate
        if selected is None and field.rotation_id:
            selected = _selected_candidate(session, simulation_id, field.id, field.rotation_id)
        if selected is not None:
            setup_field["fixed_candidate"] = (
                _common()._dump(selected) if not isinstance(selected, dict) else selected
            )
    else:
        # Keep edited values until a successful run at the new input revision replaces them.
        setup_field["baseline"] = {key: _common()._dump(field)[key] for key in OUTPUT_KEYS}
        setup_field["baseline_revision"] = revision + 1
        if previous.get("fixed_candidate"):
            setup_field["manual_candidate"] = previous["fixed_candidate"]
    from app.data import read_model_store

    session.execute(
        update(setups)
        .where(setups.c.id == simulation_id)
        .values(
            fields=func.jsonb_set(
                setups.c.fields, [field.id], read_model_store.insert_json(setup_field)
            )
        )
    )
    invalidate(session, simulation_id)
    read_model_store.update_field_view(session, simulation_id, field, setup_field)
    return True


def update_simulation_field(farm_id, simulation_id, field_id, request, email):
    with _common().SessionLocal.begin() as session:
        if _row(session, farm_id, simulation_id, email, lock=True, editable=True) is None:
            return None
        existing = _field(session, simulation_id, field_id)
        if existing is None:
            return None
        field = existing.model_copy(update=_common()._partial_update(request), deep=True)
        validate_measures_for_rotation(field.measures, field.crop_rotation)
        if field.rotation_id:
            if field.area_ha != existing.area_ha and existing.area_ha:
                scale = field.area_ha / existing.area_ha
                field = field.model_copy(
                    update={
                        key: getattr(existing, key) * scale for key in ("db2", "leaching", "fen")
                    }
                )
            field = field.model_copy(
                update={"n_load": field.leaching * (1 - (field.retention or 0) / 100)}
            )
        _save_field(session, simulation_id, field)
        return field


def save_manual_rotation(
    farm_id, simulation_id, field_id, candidate, request, email, expected_revision
):
    with _common().SessionLocal.begin() as session:
        row = _row(session, farm_id, simulation_id, email, lock=True, editable=True)
        if row is None:
            return None
        if row.revision != expected_revision:
            raise SetupRevisionConflictError(
                "Scenariet blev ændret. Prøv den manuelle ændring igen."
            )
        existing = _field(session, simulation_id, field_id)
        if existing is None:
            return None
        field = existing.model_copy(update=_common()._partial_update(request), deep=True)
        validate_measures_for_rotation(field.measures, field.crop_rotation)
        return field if _save_field(session, simulation_id, field, candidate) else None
