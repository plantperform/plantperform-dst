"""Kvote value curves ("Kvotehandel"). Always lock setup before result rows.

A curve is computed from the simulation's latest completed "Års-optimering", so
its value without trade matches the solution shown. It runs as a local
background job only: one attempt, no lease; a restarted backend fails any run
it interrupted (see recover_local_quota_values).
"""

from copy import deepcopy
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from app.data.db import SessionLocal
from app.data.db import simulation_quota_value_table as quota_values
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.data.simulation_store import _fields, _row
from app.domain.quota_value import QuotaTradeRange, QuotaValueRequest, QuotaValueResult
from app.domain.rotation_candidate import RotationCandidateEvaluation
from app.domain.simulation import Simulation


class QuotaValueNotFoundError(Exception):
    pass


class QuotaValueConflictError(Exception):
    pass


def _read(row, setup_revision, current_run_id) -> QuotaValueResult:
    if row is None:
        return QuotaValueResult()
    return QuotaValueResult.model_validate(
        {
            **dict(row._mapping),
            "price_kr_per_kg": row.parameters.get("price_kr_per_kg"),
            "trade_range": row.parameters.get("trade_range"),
            "outdated": row.status != "not_started"
            and (row.input_revision != setup_revision or row.base_run_id != current_run_id),
        }
    )


def get_quota_value(farm_id, simulation_id, email) -> QuotaValueResult | None:
    with SessionLocal() as session:
        setup = _row(session, farm_id, simulation_id, email, include_data=False)
        if setup is None:
            return None
        current_run_id = session.execute(
            select(results.c.run_id).where(results.c.simulation_id == simulation_id)
        ).scalar_one_or_none()
        row = session.execute(
            select(quota_values).where(quota_values.c.simulation_id == simulation_id)
        ).first()
        return _read(row, setup.revision, current_run_id)


def submit_quota_value(
    farm_id, simulation_id, email, request: QuotaValueRequest
) -> tuple[QuotaValueResult, bool]:
    """Queue a new curve; the flag is False when this run id was already submitted."""
    run_id = str(request.run_id)
    with SessionLocal.begin() as session:
        setup = _row(session, farm_id, simulation_id, email, lock=True, include_data=False)
        if setup is None:
            raise QuotaValueNotFoundError
        if setup.revision != request.expected_revision:
            raise QuotaValueConflictError("Scenariet er ændret. Genindlæs før en ny beregning.")
        base = session.execute(
            select(
                results.c.run_id,
                results.c.status,
                results.c.kind,
                results.c.result_revision,
            ).where(results.c.simulation_id == simulation_id)
        ).one()
        if (
            base.status != "completed"
            or base.kind != "yearly"
            or base.result_revision != setup.revision
        ):
            raise QuotaValueConflictError(
                "Kvoteværdien beregnes ud fra en gennemført Års-optimering. "
                "Kør Års-optimering først."
            )
        current = session.execute(
            select(quota_values)
            .where(quota_values.c.simulation_id == simulation_id)
            .with_for_update()
        ).first()
        if current is not None and current.run_id == run_id:
            # A repeated identical request returns the run it already started.
            return _read(current, setup.revision, base.run_id), False
        if current is not None and current.status in ("queued", "in_progress"):
            raise QuotaValueConflictError("Kvoteværdien er allerede ved at blive beregnet.")
        values = dict(
            status="queued",
            run_id=run_id,
            base_run_id=base.run_id,
            requested_by=email,
            parameters={
                "price_kr_per_kg": request.price_kr_per_kg,
                "trade_range": request.trade_range.model_dump() if request.trade_range else None,
            },
            input_revision=setup.revision,
            queued_at=datetime.now(UTC),
            started_at=None,
            finished_at=None,
            error=None,
            output=None,
            progress=None,
        )
        session.execute(
            insert(quota_values)
            .values(simulation_id=simulation_id, **values)
            .on_conflict_do_update(index_elements=[quota_values.c.simulation_id], set_=values)
        )
        row = session.execute(
            select(quota_values).where(quota_values.c.simulation_id == simulation_id)
        ).one()
        return _read(row, setup.revision, base.run_id), True


def claim_quota_value(simulation_id, run_id):
    """Start a queued run whose base optimization is still current.

    Returns (price, farm_id, revision, base run parameters, the base run's chosen
    candidate per field, the chosen trade range or None) or None when the run
    was replaced; a run whose scenarie or optimization changed is failed as
    outdated.
    """
    with SessionLocal.begin() as session:
        setup = session.execute(
            select(setups.c.farm_id, setups.c.revision)
            .where(setups.c.id == simulation_id)
            .with_for_update()
        ).first()
        if setup is None:
            return None
        row = session.execute(
            select(quota_values)
            .where(quota_values.c.simulation_id == simulation_id)
            .with_for_update()
        ).first()
        if row is None or row.run_id != run_id or row.status != "queued":
            return None
        base = session.execute(
            select(
                results.c.run_id,
                results.c.status,
                results.c.parameters,
                results.c.result_revision,
                results.c.output["selected_candidates"],
            ).where(results.c.simulation_id == simulation_id)
        ).one()
        now = datetime.now(UTC)
        if (
            row.input_revision != setup.revision
            or base.run_id != row.base_run_id
            or base.status != "completed"
            or base.result_revision != setup.revision
        ):
            session.execute(
                update(quota_values)
                .where(quota_values.c.simulation_id == simulation_id)
                .values(
                    status="failed",
                    finished_at=now,
                    error={
                        "code": "OUTDATED",
                        "message": "Scenariet eller optimeringen er ændret. Beregn igen.",
                    },
                )
            )
            return None
        session.execute(
            update(quota_values)
            .where(quota_values.c.simulation_id == simulation_id)
            .values(status="in_progress", started_at=now)
        )
        selected = {
            field_id: RotationCandidateEvaluation.model_validate(candidate)
            for field_id, candidate in (base[4] or {}).items()
        }
        trade_range = row.parameters.get("trade_range")
        return (
            row.parameters["price_kr_per_kg"],
            setup.farm_id,
            row.input_revision,
            base.parameters,
            selected,
            QuotaTradeRange.model_validate(trade_range) if trade_range else None,
        )


def load_quota_snapshot(simulation_id, revision):
    """What an Års-optimering prepares its candidates from, at the claimed revision.

    The settings the scenarie's latest run captured, its marker and each mark's
    captured registry/soil context, as optimization_store.load_snapshot returns
    them. Read only: the curve is computed for an optimized scenarie, whose
    marker and contexts are already captured.
    """
    with SessionLocal() as session:
        state = session.execute(
            select(setups.c.data, setups.c.revision, setups.c.fields, results.c.parameters)
            .join(results)
            .where(setups.c.id == simulation_id)
        ).first()
        if state is None or state.revision != revision:
            return None
        data = dict(state.data)
        captured = state.parameters.get("simulation_settings", data)
        simulation = Simulation.model_validate(
            {**captured, "name": data["name"], "revision": revision}
        )
        setup_fields = deepcopy(state.fields)
        fields = _fields(session, simulation_id)
        contexts = {f.id: setup_fields[f.id].get("calculation_context") for f in fields}
        return simulation, fields, setup_fields, contexts


def report_quota_progress(simulation_id, run_id, progress: list[dict]) -> None:
    """Save a running curve's steps; ignored once the run is replaced or finished."""
    with SessionLocal.begin() as session:
        session.execute(
            update(quota_values)
            .where(
                quota_values.c.simulation_id == simulation_id,
                quota_values.c.run_id == run_id,
                quota_values.c.status == "in_progress",
            )
            .values(progress=progress)
        )


def finish_quota_value(simulation_id, run_id, *, output=None, error=None) -> bool:
    with SessionLocal.begin() as session:
        row = session.execute(
            select(quota_values.c.run_id, quota_values.c.status)
            .where(quota_values.c.simulation_id == simulation_id)
            .with_for_update()
        ).first()
        if row is None or row.run_id != run_id or row.status != "in_progress":
            return False
        session.execute(
            update(quota_values)
            .where(quota_values.c.simulation_id == simulation_id)
            .values(
                status="failed" if error else "completed",
                finished_at=datetime.now(UTC),
                error=error,
                output=output,
            )
        )
        return True


def fail_quota_value(simulation_id, run_id, error) -> None:
    """Fail a run that never got to start, e.g. when the solver failed to load."""
    with SessionLocal.begin() as session:
        session.execute(
            update(quota_values)
            .where(
                quota_values.c.simulation_id == simulation_id,
                quota_values.c.run_id == run_id,
                quota_values.c.status.in_(("queued", "in_progress")),
            )
            .values(status="failed", finished_at=datetime.now(UTC), error=error)
        )


def recover_local_quota_values() -> None:
    """A restarted local backend has lost every run it was computing."""
    with SessionLocal.begin() as session:
        session.execute(
            update(quota_values)
            .where(quota_values.c.status.in_(("queued", "in_progress")))
            .values(
                status="failed",
                finished_at=datetime.now(UTC),
                error={
                    "code": "WORKER_LOST",
                    "message": "Beregningen blev afbrudt, da serveren genstartede. Beregn igen.",
                },
            )
        )
