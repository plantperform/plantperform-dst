"""Small simulation writes; calculation belongs exclusively to the optimizer."""

from copy import deepcopy
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import insert, select, update

from app.data import repository, simulation_store
from app.data.db import farm_table
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.domain.simulation import Simulation

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
        from app.data.economics_store import resolve_snapshot

        snapshot = resolve_snapshot(session, request.economics_module_id, email)
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
        from app.data.read_model_store import publish_simulation

        publish_simulation(
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


# A copied mark keeps its data and captured context, never another scenarie's choice.
UNCOPIED_FIELD_KEYS = ("manual_candidate", "fixed_candidate", "fixed", "economics_candidate")


def copy_fields(farm_id, simulation_id, source_id, email) -> dict[str, str] | None:
    """Give a new simulation the marker of another, with their captured contexts.

    Normally a simulation captures the farm's marker on its first optimization.
    A simulation made from another one (a Kvotehandel trade) starts from that
    one's marker instead, so the same registry/soil context is used and each
    mark can be given a rotation before the first run. Locks and manual choices
    are left out. Returns the source mark id -> the new mark id, or None when
    either simulation is missing or the new one already has marker.
    """
    with repository.SessionLocal.begin() as session:
        if not repository._member_exists(session, farm_id, email):
            return None
        rows = {
            row.id: row
            for row in session.execute(
                select(setups.c.id, setups.c.data, setups.c.fields, setups.c.field_order)
                .where(setups.c.farm_id == farm_id, setups.c.id.in_((simulation_id, source_id)))
                .with_for_update()
            )
        }
        target, source = rows.get(simulation_id), rows.get(source_id)
        if target is None or source is None or target.data.get("fields_initialized", True):
            return None
        ids = {old: str(uuid4()) for old in source.field_order}
        fields = {}
        for old, new in ids.items():
            field = {
                key: deepcopy(value)
                for key, value in source.fields[old].items()
                if key not in UNCOPIED_FIELD_KEYS
            }
            fields[new] = {**field, "id": new, "allowed_rotation_ids": []}
        session.execute(
            update(setups)
            .where(setups.c.id == simulation_id)
            .values(
                fields=fields,
                field_order=list(ids.values()),
                data={**target.data, "fields_initialized": True},
            )
        )
        return ids


def record_quota_trade(farm_id, simulation_id, trade, email) -> bool:
    """Keep the kvote trade a simulering was created for (SimulationQuotaTrade)."""
    with repository.SessionLocal.begin() as session:
        if not repository._member_exists(session, farm_id, email):
            return False
        row = session.execute(
            select(setups.c.data)
            .where(setups.c.id == simulation_id, setups.c.farm_id == farm_id)
            .with_for_update()
        ).first()
        if row is None:
            return False
        session.execute(
            update(setups)
            .where(setups.c.id == simulation_id)
            .values(data={**row.data, "quota_trade": trade.model_dump(mode="json")})
        )
        return True


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
            from app.data.economics_store import resolve_snapshot

            patch["economics_module_id"] = resolve_snapshot(
                session,
                patch["economics_module_id"],
                email,
            ).source_id
        current = Simulation.model_validate(row.data).model_dump(mode="json")
        # PATCH updates nested settings too; omitted values keep their saved meaning.
        for key in ("constraints", "godning", "optimization_settings"):
            if key in patch:
                patch[key] = {**current[key], **patch[key]}
        changed = {key: value for key, value in patch.items() if value != current.get(key)}
        if not changed:
            return simulation_store._get_simulation(session, farm_id, simulation_id, email)
        calculations_changed = bool(changed.keys() - {"name"})
        if calculations_changed:
            from app.data.creation_store import require_ready

            require_ready(session, simulation_id)
            require_idle(session, simulation_id)
        data = {**row.data, **changed}
        Simulation.model_validate(data)
        session.execute(update(setups).where(setups.c.id == simulation_id).values(data=data))
        if calculations_changed:
            simulation_store.invalidate(session, simulation_id)
        return simulation_store._get_simulation(session, farm_id, simulation_id, email)


def recover_creation(farm_id, simulation_id, email, *, expected_revision=None):
    from app.data.read_model_store import publish_simulation
    from app.domain.creation import CreationConflictError

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
        publish_simulation(
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
