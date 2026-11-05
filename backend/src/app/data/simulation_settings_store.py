"""Small simulation writes; calculation belongs exclusively to the optimizer."""

from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import insert, select, update

from app.data import (
    creation_store,
    economics_store,
    read_model_store,
    repository,
    saedskifte_store,
    simulation_store,
)
from app.data.db import farm_table
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.domain.creation import CreationConflictError
from app.domain.simulation import Simulation
from app.services.rotations import custom

REQUEST_TO_SETUP = {
    "saedskiftevarianter": "rotation_saedskiftevarianter",
    "n_norm_procenter": "rotation_n_norm_procenter",
}


def require_idle(session, simulation_id):
    status = session.execute(
        select(results.c.status).where(results.c.simulation_id == simulation_id).with_for_update()
    ).scalar_one_or_none()
    if status in ("queued", "in_progress"):
        raise simulation_store.SetupRevisionConflictError(
            "Optimeringen er i gang. Vent med at ændre indstillingerne, til den er færdig."
        )


def create(farm_id, request, email):
    request_id = str(request.request_id or uuid4())
    simulation_id = str(uuid5(NAMESPACE_URL, f"plantperform:simulation:{farm_id}:{request_id}"))
    with repository.SessionLocal.begin() as session:
        if not repository._farm_exists(session, farm_id, email):
            return None
        session.execute(select(farm_table.c.id).where(farm_table.c.id == farm_id).with_for_update())
        existing = simulation_store._get_simulation(session, farm_id, simulation_id, email)
        if existing is not None:
            return existing
        rotation_groups = saedskifte_store.resolve_selected(
            session, request.saedskiftevarianter, email=email
        )
        with (
            custom.rotation_scope(rotation_groups, request.godning.driftsform),
            custom.measure_scope(request.tidlig_saaning, request.mellemafgrode),
        ):
            custom.check_expansion(request.saedskiftevarianter, request.n_norm_procenter)
        snapshot = economics_store.resolve_snapshot(session, request.economics_module_id, email)
        settings = request.model_dump(
            mode="json",
            exclude={
                "request_id",
                "optimize_on_create",
                "economics_module_id",
            },
        )
        settings = {REQUEST_TO_SETUP.get(key, key): value for key, value in settings.items()}
        simulation = Simulation(
            **settings,
            id=simulation_id,
            farm_id=farm_id,
            created_at=datetime.now(UTC).isoformat(),
            fields_initialized=False,
            economics_module_id=snapshot.source_id,
            economics_snapshot=snapshot,
        )
        session.execute(
            insert(setups).values(
                id=simulation_id,
                farm_id=farm_id,
                data=simulation.model_dump(
                    mode="json",
                    exclude={
                        "creation_status",
                        "economics_recalculation_failed",
                        "result",
                        "revision",
                    },
                ),
                creation_status="done",
                fields={},
                field_order=[],
            )
        )
        session.execute(insert(results).values(simulation_id=simulation_id))
        # A settings-only simulation does not require display preparation.
        read_model_store.publish_simulation(
            session,
            simulation_id,
            0,
            {
                "fields": [],
                "field_years": {},
                "yearly_summary": [],
                "crop_area_ranges": [],
                "saved_result": None,
                "comparison_availability": {"kind": "uncalculated"},
            },
            {"version": 3, "contributions": {}},
        )
        return simulation


def update_settings(farm_id, simulation_id, request, email):
    with repository.SessionLocal.begin() as session:
        if not repository._member_exists(session, farm_id, email):
            return None
        row = session.execute(
            select(setups)
            .where(
                setups.c.id == simulation_id,
                setups.c.farm_id == farm_id,
            )
            .with_for_update()
        ).first()
        if row is None:
            return None
        if row.revision != request.expected_revision:
            raise simulation_store.SetupRevisionConflictError(
                "Simuleringen er ændret. Genindlæs den."
            )
        patch = request.model_dump(mode="json", exclude_unset=True, exclude={"expected_revision"})
        patch = {REQUEST_TO_SETUP.get(key, key): value for key, value in patch.items()}
        if "economics_module_id" in patch:
            patch["economics_module_id"] = economics_store.resolve_snapshot(
                session,
                patch["economics_module_id"],
                email,
            ).source_id
        current = Simulation.model_validate(row.data).model_dump(mode="json")
        if "rotation_saedskiftevarianter" in patch:
            saedskifte_store.resolve_selected(
                session,
                patch["rotation_saedskiftevarianter"],
                email=email,
                existing=current["rotation_saedskiftevarianter"],
            )
        # PATCH updates nested settings too; omitted values keep their saved meaning.
        for key in ("constraints", "godning", "optimization_settings"):
            if key in patch:
                patch[key] = {**current[key], **patch[key]}
        changed = {key: value for key, value in patch.items() if value != current.get(key)}
        if not changed:
            return simulation_store._get_simulation(session, farm_id, simulation_id, email)
        calculations_changed = bool(changed.keys() - {"name"})
        if calculations_changed:
            creation_store.require_ready(session, simulation_id)
            require_idle(session, simulation_id)
        data = {**row.data, **changed}
        resolved = Simulation.model_validate(data)
        rotation_groups = saedskifte_store.resolve_selected(
            session, resolved.rotation_saedskiftevarianter
        )
        with (
            custom.rotation_scope(rotation_groups, resolved.godning.driftsform),
            custom.measure_scope(resolved.tidlig_saaning, resolved.mellemafgrode),
        ):
            custom.check_expansion(
                resolved.rotation_saedskiftevarianter, resolved.rotation_n_norm_procenter
            )
        session.execute(update(setups).where(setups.c.id == simulation_id).values(data=data))
        if calculations_changed:
            simulation_store.invalidate(session, simulation_id)
        return simulation_store._get_simulation(session, farm_id, simulation_id, email)


def recover_creation(farm_id, simulation_id, email, *, expected_revision=None):
    with repository.SessionLocal.begin() as session:
        if not repository._member_exists(session, farm_id, email):
            return None
        row = session.execute(
            select(setups)
            .where(
                setups.c.id == simulation_id,
                setups.c.farm_id == farm_id,
            )
            .with_for_update()
        ).first()
        if row is None:
            return None
        if expected_revision is not None and row.revision != expected_revision:
            return None
        if row.creation_status == "done":
            return simulation_store._get_simulation(session, farm_id, simulation_id, email)
        if row.data.get("economics_recalculation"):
            raise CreationConflictError("Use the economics recalculation retry endpoint.")
        if expected_revision is None and row.creation_status != "failed":
            raise CreationConflictError("Kun mislykkede oprettelser kan prøves igen.")
        require_idle(session, simulation_id)
        revision = row.revision + 1
        session.execute(
            update(setups)
            .where(setups.c.id == simulation_id)
            .values(
                data={**row.data, "fields_initialized": False},
                fields={},
                field_order=[],
                revision=revision,
                creation_status="done",
            )
        )
        read_model_store.publish_simulation(
            session,
            simulation_id,
            revision,
            {
                "fields": [],
                "field_years": {},
                "yearly_summary": [],
                "crop_area_ranges": [],
                "saved_result": None,
                "comparison_availability": {"kind": "uncalculated"},
            },
            {"version": 3, "contributions": {}},
        )
        return simulation_store._get_simulation(session, farm_id, simulation_id, email)
