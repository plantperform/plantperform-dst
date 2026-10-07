"""Simulation aggregates. Always lock setup before result when changing either."""

from copy import deepcopy
from time import monotonic

from sqlalchemy import delete, func, select, update

from app.data.db import simulation_field_candidates_table as cached_candidates
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.data.optimizer_inputs import parse_optimizer_input
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
            "selected_candidates": output.get("selected_candidates", {}),
        }
    )


def _row(session, farm_id, simulation_id, email, *, lock=False, include_data=True):
    columns = [setups.c.data, setups.c.revision] if include_data else [setups.c.revision]
    query = select(*columns).where(
        setups.c.id == simulation_id,
        setups.c.farm_id == farm_id,
    )
    if not _common()._member_exists(session, farm_id, email):
        return None
    if lock:
        query = query.with_for_update()
    return session.execute(query).first()


def _model(session, simulation_id, row):
    result = session.execute(
        select(*[results.c[name] for name in SimulationResultSummary.model_fields]).where(
            results.c.simulation_id == simulation_id
        )
    ).first()
    summary = SimulationResultSummary.model_validate(dict(result._mapping)) if result else None
    return Simulation.model_validate(
        {**row.data, "revision": row.revision, "result": summary or {}}
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


def get_simulation(farm_id, simulation_id, email):
    with _common().SessionLocal() as session:
        return _get_simulation(session, farm_id, simulation_id, email)


def list_simulations(farm_id, email):
    with _common().SessionLocal() as session:
        if not _common()._farm_exists(session, farm_id, email):
            return None
        rows = session.execute(
            select(setups.c.id, setups.c.data, setups.c.revision)
            .where(setups.c.farm_id == farm_id)
            .order_by(setups.c.created_at)
        ).all()
        summaries = {
            r.simulation_id: SimulationResultSummary.model_validate(dict(r._mapping))
            for r in session.execute(
                select(
                    results.c.simulation_id,
                    *[results.c[name] for name in SimulationResultSummary.model_fields],
                )
                .join(setups)
                .where(setups.c.farm_id == farm_id)
            )
        }
        return [
            Simulation.model_validate(
                {**row.data, "revision": row.revision, "result": summaries.get(row.id, {})}
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
        if _row(session, farm_id, simulation_id, email) is None:
            return None
        return _fields(session, simulation_id)


def get_simulation_field(farm_id, simulation_id, field_id, email):
    fields = list_simulation_fields(farm_id, simulation_id, email)
    return next((f for f in fields or [] if f.id == field_id), None)


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


def merge_setup_candidates(data, selected, setup):
    row = merge_candidates(data, setup.get("manual_candidate"))
    row = merge_candidates(row, selected)
    return merge_candidates(row, setup.get("fixed_candidate"))


def _candidates(session, simulation_id, *, compact=False, timings=None):
    started = monotonic()
    row = session.execute(
        select(setups.c.fields, setups.c.field_order, results.c.output["selected_candidates"])
        .join(results)
        .where(setups.c.id == simulation_id)
    ).one()
    selected = row[2] or {}
    column = cached_candidates.c.optimizer_input if compact else cached_candidates.c.data
    query = select(cached_candidates.c.field_id, column).where(
        cached_candidates.c.simulation_id == simulation_id
    )
    reads = monotonic() - started
    validation = 0.0
    candidates = []
    started = monotonic()
    rows = iter(session.execute(query.execution_options(yield_per=1)))
    while True:
        cached = next(rows, None)
        reads += monotonic() - started
        if cached is None:
            break
        started = monotonic()
        data = parse_optimizer_input(cached[1]) if compact else cached[1]
        candidates.append(
            merge_setup_candidates(
                data, selected.get(cached.field_id), row.fields.get(cached.field_id, {})
            )
        )
        validation += monotonic() - started
        started = monotonic()
    if timings is not None:
        timings.update(compact_candidate_reads=reads, candidate_validation=validation)
    positions = {field_id: i for i, field_id in enumerate(row.field_order)}
    return sorted(candidates, key=lambda c: (positions.get(c.field_id, len(positions)), c.field_id))


def selected_evaluations(farm_id, simulation_id, email):
    """Read only the chosen evaluations, with the same overlay precedence as _candidates."""
    with _common().SessionLocal() as session:
        if _row(session, farm_id, simulation_id, email, include_data=False) is None:
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
        cached_fields = set(
            session.execute(
                select(cached_candidates.c.field_id).where(
                    cached_candidates.c.simulation_id == simulation_id,
                    cached_candidates.c.field_id.in_([field.id for field in chosen_fields]),
                )
            ).scalars()
        )
        for field in chosen_fields:
            if field.id not in cached_fields:
                continue
            setup = row.fields.get(field.id, {})
            for overlay in (
                setup.get("fixed_candidate"),
                selected.get(field.id),
                setup.get("manual_candidate"),
            ):
                if overlay and RotationCandidateRef.model_validate(overlay["ref"]).to_id() == (
                    field.rotation_id
                ):
                    chosen[field.id] = RotationCandidateEvaluation.model_validate(overlay)
                    break
            else:
                compact = session.execute(
                    select(cached_candidates.c.optimizer_input).where(
                        cached_candidates.c.simulation_id == simulation_id,
                        cached_candidates.c.field_id == field.id,
                    )
                ).scalar_one()
                position = next(
                    (
                        i
                        for i, c in enumerate(compact["candidates"])
                        if RotationCandidateRef.model_validate(c["ref"]).to_id()
                        == field.rotation_id
                    ),
                    None,
                )
                if position is not None:
                    data = session.execute(
                        select(cached_candidates.c.data["candidates"][position]).where(
                            cached_candidates.c.simulation_id == simulation_id,
                            cached_candidates.c.field_id == field.id,
                        )
                    ).scalar_one()
                    chosen[field.id] = RotationCandidateEvaluation.model_validate(data)
        return fields, chosen


def _candidate_row(session, simulation_id, field_id):
    return session.execute(
        select(
            cached_candidates.c.data,
            results.c.output["selected_candidates"][field_id],
            setups.c.fields[field_id],
        )
        .select_from(
            cached_candidates.join(setups).join(results, results.c.simulation_id == setups.c.id)
        )
        .where(
            cached_candidates.c.simulation_id == simulation_id,
            cached_candidates.c.field_id == field_id,
        )
    ).first()


def list_simulation_field_candidates(farm_id, simulation_id, email):
    with _common().SessionLocal() as session:
        if _row(session, farm_id, simulation_id, email) is None:
            return None
        return _candidates(session, simulation_id)


def get_simulation_field_candidates(farm_id, simulation_id, field_id, email):
    with _common().SessionLocal() as session:
        if _row(session, farm_id, simulation_id, email) is None:
            return None
        row = _candidate_row(session, simulation_id, field_id)
        return merge_setup_candidates(row[0], row[1], row[2] or {}) if row else None


def get_simulation_field_candidate_detail(farm_id, simulation_id, field_id, email):
    field = get_simulation_field(farm_id, simulation_id, field_id, email)
    if field is None:
        return None
    if field.rotation_id is None:
        raise _common().FieldNotOptimizedError
    row = get_simulation_field_candidates(farm_id, simulation_id, field_id, email)
    return (
        next((c for c in row.candidates if c.ref.to_id() == field.rotation_id), None)
        if row
        else None
    )


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
        row = _row(session, farm_id, simulation_id, email, lock=True)
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
    fields = session.execute(
        select(setups.c.fields, setups.c.revision).where(setups.c.id == simulation_id)
    ).one()
    revision = fields.revision
    fields = fields.fields
    previous = fields.get(field.id, {})
    setup_field = split_field(_common()._dump(field))
    if previous.get("manual_candidate"):
        setup_field["manual_candidate"] = previous["manual_candidate"]
    if field.allowed_rotation_ids:
        selected = candidate
        previous_candidate = previous.get("fixed_candidate") or previous.get("manual_candidate")
        if (
            selected is None
            and previous_candidate
            and RotationCandidateRef.model_validate(previous_candidate["ref"]).to_id()
            == field.rotation_id
        ):
            selected = previous_candidate
        if selected is None:
            data = _candidate_row(session, simulation_id, field.id)
            if data:
                selected = next(
                    (
                        c
                        for c in merge_candidates(data[0], data[1]).candidates
                        if c.ref.to_id() == field.rotation_id
                    ),
                    None,
                )
        if selected is not None:
            setup_field["fixed_candidate"] = (
                _common()._dump(selected) if not isinstance(selected, dict) else selected
            )
    elif previous.get("fixed"):
        # Unlocking is an explicit edit; retain the manual choice until a successful replacement.
        setup_field["baseline"] = previous["fixed"]
        setup_field["baseline_revision"] = revision + 1
        if previous.get("fixed_candidate"):
            setup_field["manual_candidate"] = previous["fixed_candidate"]
    elif previous.get("baseline"):
        setup_field["baseline"] = previous["baseline"]
        if "baseline_revision" in previous:
            setup_field["baseline_revision"] = previous["baseline_revision"]
    fields = {**fields, field.id: setup_field}
    session.execute(update(setups).where(setups.c.id == simulation_id).values(fields=fields))
    invalidate(session, simulation_id)
    return True


def update_simulation_field(farm_id, simulation_id, field_id, request, email):
    with _common().SessionLocal.begin() as session:
        if _row(session, farm_id, simulation_id, email, lock=True) is None:
            return None
        existing = next((f for f in _fields(session, simulation_id) if f.id == field_id), None)
        if existing is None:
            return None
        field = existing.model_copy(update=_common()._partial_update(request), deep=True)
        validate_measures_for_rotation(field.measures, field.crop_rotation)
        if field.allowed_rotation_ids:
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
        row = _row(session, farm_id, simulation_id, email, lock=True)
        if row is None:
            return None
        if row.revision != expected_revision:
            raise SetupRevisionConflictError(
                "Scenariet blev ændret. Prøv den manuelle ændring igen."
            )
        existing = next((f for f in _fields(session, simulation_id) if f.id == field_id), None)
        if existing is None:
            return None
        field = existing.model_copy(update=_common()._partial_update(request), deep=True)
        validate_measures_for_rotation(field.measures, field.crop_rotation)
        return field if _save_field(session, simulation_id, field, candidate) else None
