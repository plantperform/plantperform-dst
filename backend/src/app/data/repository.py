from copy import deepcopy
from datetime import UTC, datetime
from uuid import uuid4

from pydantic import BaseModel
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.orm import Session

from app.data.db import (
    SessionLocal,
    farm_table,
    field_table,
    registry_field_table,
    simulation_field_candidates_table,
    simulation_field_table,
    simulation_table,
)
from app.domain.farm import CreateFarmRequest, Farm, UpdateFarmRequest
from app.domain.field import (
    CreateFieldRequest,
    FieldRecord,
    UpdateFieldRequest,
    validate_measures_for_rotation,
)
from app.domain.rotation_candidate import RotationCandidateEvaluation, SimulationFieldCandidates
from app.domain.rotation_library import ROTATION_LIBRARY
from app.domain.simulation import (
    CreateSimulationRequest,
    OptimizationConstraints,
    Simulation,
)
from app.services.scenario.candidate_evaluator import generate_candidates_for_field
from app.services.soil.jbnr import FALLBACK_JBNR


def _dump(model: BaseModel) -> dict:
    return model.model_dump(mode="json")


def _partial_update(model: BaseModel) -> dict:
    return {field: getattr(model, field) for field in model.model_fields_set}


def _load[ModelT: BaseModel](model_type: type[ModelT], data: dict) -> ModelT:
    return model_type.model_validate(data)


def _jbnr_for_imk_id(session: Session, imk_id: int | None) -> int:
    if imk_id is None:
        return FALLBACK_JBNR
    jbnr = session.execute(
        select(registry_field_table.c.jbnr).where(registry_field_table.c.imk_id == imk_id),
    ).scalar_one_or_none()
    return jbnr if jbnr is not None else FALLBACK_JBNR


def _farm_exists(session: Session, farm_id: str) -> bool:
    return (
        session.execute(
            select(farm_table.c.id).where(farm_table.c.id == farm_id)
        ).scalar_one_or_none()
        is not None
    )


def _get_farm(session: Session, farm_id: str) -> Farm | None:
    data = session.execute(
        select(farm_table.c.data).where(farm_table.c.id == farm_id),
    ).scalar_one_or_none()
    return None if data is None else _load(Farm, data)


def _get_simulation(
    session: Session,
    farm_id: str,
    simulation_id: str,
) -> Simulation | None:
    data = session.execute(
        select(simulation_table.c.data).where(
            simulation_table.c.id == simulation_id,
            simulation_table.c.farm_id == farm_id,
        ),
    ).scalar_one_or_none()
    return None if data is None else _load(Simulation, data)


def _default_allowed_rotation_ids_for_farm(farm: Farm) -> list[str]:
    return ["current", *(rotation.id for rotation in farm.rotation_library)]


def list_farms() -> list[Farm]:
    with SessionLocal() as session:
        rows = session.execute(
            select(farm_table.c.data).order_by(farm_table.c.created_at),
        ).scalars()
        return [_load(Farm, data) for data in rows]


def create_farm(request: CreateFarmRequest) -> Farm:
    farm = Farm(
        id=str(uuid4()),
        rotation_library=deepcopy(ROTATION_LIBRARY),
        **request.model_dump(),
    )

    with SessionLocal.begin() as session:
        session.execute(
            insert(farm_table).values(
                id=farm.id,
                data=_dump(farm),
            ),
        )

    return farm


def get_farm(farm_id: str) -> Farm | None:
    with SessionLocal() as session:
        return _get_farm(session, farm_id)


def update_farm(farm_id: str, request: UpdateFarmRequest) -> Farm | None:
    with SessionLocal.begin() as session:
        farm = _get_farm(session, farm_id)
        if farm is None:
            return None

        updated_farm = farm.model_copy(update=request.model_dump(), deep=True)
        session.execute(
            update(farm_table)
            .where(farm_table.c.id == farm_id)
            .values(data=_dump(updated_farm), updated_at=func.now()),
        )
        return updated_farm


def delete_farm(farm_id: str) -> bool:
    with SessionLocal.begin() as session:
        result = session.execute(delete(farm_table).where(farm_table.c.id == farm_id))
        return result.rowcount > 0


def list_fields(farm_id: str) -> list[FieldRecord] | None:
    with SessionLocal() as session:
        if not _farm_exists(session, farm_id):
            return None

        rows = session.execute(
            select(field_table.c.data)
            .where(field_table.c.farm_id == farm_id)
            .order_by(field_table.c.created_at),
        ).scalars()
        return [_load(FieldRecord, data) for data in rows]


def upsert_field(farm_id: str, request: CreateFieldRequest) -> FieldRecord | None:
    with SessionLocal.begin() as session:
        farm = _get_farm(session, farm_id)
        if farm is None:
            return None

        existing = None
        if request.imk_id is not None:
            rows = session.execute(
                select(field_table.c.data)
                .where(field_table.c.farm_id == farm_id)
                .order_by(field_table.c.created_at),
            ).scalars()
            existing = next(
                (_load(FieldRecord, data) for data in rows if data.get("imk_id") == request.imk_id),
                None,
            )

        field_id = existing.id if existing is not None else str(uuid4())
        field_data = request.model_dump()
        if "allowed_rotation_ids" not in request.model_fields_set:
            field_data["allowed_rotation_ids"] = _default_allowed_rotation_ids_for_farm(farm)

        field = FieldRecord(
            id=field_id,
            farm_id=farm_id,
            db2=0,
            n_load=0,
            leaching=0,
            fen=0,
            jbnr=_jbnr_for_imk_id(session, request.imk_id),
            **field_data,
        )

        if existing is None:
            session.execute(
                insert(field_table).values(
                    id=field.id,
                    farm_id=farm_id,
                    data=_dump(field),
                ),
            )
        else:
            session.execute(
                update(field_table)
                .where(field_table.c.id == field.id, field_table.c.farm_id == farm_id)
                .values(data=_dump(field), updated_at=func.now()),
            )

        return field


def detach_field(farm_id: str, field_id: str) -> bool | None:
    with SessionLocal.begin() as session:
        if not _farm_exists(session, farm_id):
            return None

        result = session.execute(
            delete(field_table).where(
                field_table.c.id == field_id,
                field_table.c.farm_id == farm_id,
            ),
        )
        return result.rowcount > 0


def list_simulations(farm_id: str) -> list[Simulation] | None:
    with SessionLocal() as session:
        if not _farm_exists(session, farm_id):
            return None

        rows = session.execute(
            select(simulation_table.c.data)
            .where(simulation_table.c.farm_id == farm_id)
            .order_by(simulation_table.c.created_at),
        ).scalars()
        return [_load(Simulation, data) for data in rows]


def create_simulation(farm_id: str, request: CreateSimulationRequest) -> Simulation | None:
    with SessionLocal.begin() as session:
        if not _farm_exists(session, farm_id):
            return None

        simulation = Simulation(
            id=str(uuid4()),
            farm_id=farm_id,
            name=request.name,
            created_at=datetime.now(UTC).isoformat(),
            rotation_kategorier=list(request.kategori_saedskifter.keys()),
            rotation_n_norm_procenter=request.n_norm_procenter,
            eea_fdato=request.eea_fdato,
            eea_precision_dagsbasis=request.eea_precision_dagsbasis,
        )
        session.execute(
            insert(simulation_table).values(
                id=simulation.id,
                farm_id=farm_id,
                data=_dump(simulation),
            ),
        )

        rows = session.execute(
            select(field_table.c.data)
            .where(field_table.c.farm_id == farm_id)
            .order_by(field_table.c.created_at),
        ).scalars()
        for data in rows:
            current_field = _load(FieldRecord, data)
            field_id = str(uuid4())
            copied_field = current_field.model_copy(
                update={"id": field_id, "geometry": deepcopy(current_field.geometry)},
                deep=True,
            )
            session.execute(
                insert(simulation_field_table).values(
                    id=copied_field.id,
                    simulation_id=simulation.id,
                    data=_dump(copied_field),
                ),
            )

            if request.kategori_saedskifter and request.n_norm_procenter:
                jbnr = _jbnr_for_imk_id(session, copied_field.imk_id)
                candidates = generate_candidates_for_field(
                    request.kategori_saedskifter, request.n_norm_procenter, jbnr,
                    fdato=request.eea_fdato, precision_dagsbasis=request.eea_precision_dagsbasis,
                )
                field_candidates = SimulationFieldCandidates(
                    field_id=copied_field.id, jbnr=jbnr, candidates=candidates,
                )
                session.execute(
                    insert(simulation_field_candidates_table).values(
                        id=str(uuid4()),
                        simulation_id=simulation.id,
                        field_id=copied_field.id,
                        data=_dump(field_candidates),
                    ),
                )

        return simulation


def get_simulation(farm_id: str, simulation_id: str) -> Simulation | None:
    with SessionLocal() as session:
        return _get_simulation(session, farm_id, simulation_id)


def list_simulation_field_candidates(
    farm_id: str, simulation_id: str,
) -> list[SimulationFieldCandidates] | None:
    with SessionLocal() as session:
        if _get_simulation(session, farm_id, simulation_id) is None:
            return None

        rows = session.execute(
            select(simulation_field_candidates_table.c.data)
            .where(simulation_field_candidates_table.c.simulation_id == simulation_id),
        ).scalars()
        return [_load(SimulationFieldCandidates, data) for data in rows]


class FieldNotOptimizedError(Exception):
    """Marken har endnu ikke et vindende sædskifte (rotation_id) — kør Optimér først."""


def get_simulation_field_candidate_detail(
    farm_id: str, simulation_id: str, field_id: str,
) -> RotationCandidateEvaluation | None:
    """Den fulde beregningsdetalje (leaching_detail/db_detail pr. år) for den
    kandidat Optimér har valgt til denne mark. Returnerer None hvis
    marken/simuleringen ikke findes; rejser FieldNotOptimizedError hvis marken
    endnu ikke er blevet optimeret (intet rotation_id sat)."""
    with SessionLocal() as session:
        if _get_simulation(session, farm_id, simulation_id) is None:
            return None

        field_data = session.execute(
            select(simulation_field_table.c.data).where(
                simulation_field_table.c.id == field_id,
                simulation_field_table.c.simulation_id == simulation_id,
            ),
        ).scalar_one_or_none()
        if field_data is None:
            return None

        field = _load(FieldRecord, field_data)
        if field.rotation_id is None:
            raise FieldNotOptimizedError

        candidates_data = session.execute(
            select(simulation_field_candidates_table.c.data).where(
                simulation_field_candidates_table.c.simulation_id == simulation_id,
                simulation_field_candidates_table.c.field_id == field_id,
            ),
        ).scalar_one_or_none()
        if candidates_data is None:
            return None

        field_candidates = _load(SimulationFieldCandidates, candidates_data)
        return next(
            (
                candidate
                for candidate in field_candidates.candidates
                if candidate.ref.to_id() == field.rotation_id
            ),
            None,
        )


def delete_simulation(farm_id: str, simulation_id: str) -> bool | None:
    with SessionLocal.begin() as session:
        if not _farm_exists(session, farm_id):
            return None

        result = session.execute(
            delete(simulation_table).where(
                simulation_table.c.id == simulation_id,
                simulation_table.c.farm_id == farm_id,
            ),
        )
        return result.rowcount > 0


def update_simulation_constraints(
    farm_id: str,
    simulation_id: str,
    constraints: OptimizationConstraints,
) -> Simulation | None:
    with SessionLocal.begin() as session:
        simulation = _get_simulation(session, farm_id, simulation_id)
        if simulation is None:
            return None

        max_fields = constraints.max_fields_with_new_rotation
        field_count = session.execute(
            select(func.count()).where(
                simulation_field_table.c.simulation_id == simulation_id,
            ),
        ).scalar_one()
        if max_fields is not None and max_fields > field_count:
            raise ValueError(
                "Maximum fields with new rotations cannot exceed the simulation field count"
            )

        if constraints.globally_allowed_rotation_ids is not None:
            farm = _get_farm(session, farm_id)
            if farm is None:
                return None
            library_ids = {rotation.id for rotation in farm.rotation_library}
            unknown = [
                rotation_id
                for rotation_id in constraints.globally_allowed_rotation_ids
                if rotation_id not in library_ids
            ]
            if unknown:
                raise ValueError(f"Unknown globally allowed rotation id: {unknown[0]}")

        updated_simulation = simulation.model_copy(
            update={"constraints": constraints},
            deep=True,
        )
        session.execute(
            update(simulation_table)
            .where(
                simulation_table.c.id == simulation_id,
                simulation_table.c.farm_id == farm_id,
            )
            .values(data=_dump(updated_simulation), updated_at=func.now()),
        )
        return updated_simulation


def list_simulation_fields(farm_id: str, simulation_id: str) -> list[FieldRecord] | None:
    with SessionLocal() as session:
        if _get_simulation(session, farm_id, simulation_id) is None:
            return None

        rows = session.execute(
            select(simulation_field_table.c.data)
            .where(simulation_field_table.c.simulation_id == simulation_id)
            .order_by(simulation_field_table.c.created_at),
        ).scalars()
        return [_load(FieldRecord, data) for data in rows]


def update_simulation_field(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    request: UpdateFieldRequest,
) -> FieldRecord | None:
    with SessionLocal.begin() as session:
        if _get_simulation(session, farm_id, simulation_id) is None:
            return None

        data = session.execute(
            select(simulation_field_table.c.data).where(
                simulation_field_table.c.id == field_id,
                simulation_field_table.c.simulation_id == simulation_id,
            ),
        ).scalar_one_or_none()
        if data is None:
            return None

        existing = _load(FieldRecord, data)
        field = existing.model_copy(update=_partial_update(request), deep=True)
        validate_measures_for_rotation(field.measures, field.crop_rotation)
        session.execute(
            update(simulation_field_table)
            .where(
                simulation_field_table.c.id == field_id,
                simulation_field_table.c.simulation_id == simulation_id,
            )
            .values(data=_dump(field), updated_at=func.now()),
        )
        return field
