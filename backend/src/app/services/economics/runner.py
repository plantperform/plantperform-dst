"""Explicit economics recalculation, preserving simulation identities and choices."""

import logging
from contextlib import nullcontext
from copy import deepcopy

from sqlalchemy import select, update

from app.data import creation_store, read_model_store, simulation_store
from app.data import economics_recalculation_store as store
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.domain.economics import EconomicsRecalculationJob
from app.domain.rotation_candidate import RotationCandidateRef
from app.domain.simulation import Simulation
from app.services.calculation import CalculationContext, CalculationFailedError
from app.services.economics.db_calculator import clear_lookup_cache
from app.services.economics.recalculation import recalculate_candidate, recalculate_document

logger = logging.getLogger(__name__)


def _deadline(context):
    if context.get_remaining_time_in_millis() <= 0:
        raise TimeoutError("Economics recalculation deadline reached")


def _reprice_pick(setup, pick, candidate, simulation, snapshot, jbnr):
    """Price the optimizer's own pick too, when the field has been changed from it.

    A saved result stays on the rotations the optimizer picked, so its figures follow
    the profile only if those picks are priced as well. A field that is still on its
    pick has it priced as its chosen candidate, so no second copy is kept.
    """
    setup.pop("economics_pick", None)
    if not pick:
        return
    if candidate is None or candidate.ref.to_id() != (
        RotationCandidateRef.model_validate(pick["ref"]).to_id()
    ):
        setup["economics_pick"] = recalculate_document(pick, simulation, snapshot, jbnr)


def _execute(session, job, context):
    """Reprice the saved chosen/manual results and the optimizer's picks; no alternatives exist."""
    with session.begin():
        row = store.locked_setup(session, job)
        if row is None or row.creation_status != "running":
            return False
        simulation = Simulation.model_validate(row.data)
        original_fields = simulation_store._fields(session, job.simulation_id)
        setup_fields = deepcopy(row.fields)
        chosen = {
            field.id: simulation_store._selected_candidate(
                session, job.simulation_id, field.id, field.rotation_id
            )
            for field in original_fields
            if field.rotation_id
        }
        picks = (
            session.execute(
                select(results.c.output["selected_candidates"]).where(
                    results.c.simulation_id == job.simulation_id
                )
            ).scalar_one_or_none()
            or {}
        )
    for field in original_fields:
        _deadline(context)
        setup = setup_fields[field.id]
        # Existing detail inputs also support old results without another optimization.
        jbnr = (setup.get("calculation_context") or {}).get("jbnr") or 4
        for name in ("baseline_candidate", "fixed_candidate", "manual_candidate"):
            if setup.get(name):
                setup[name] = recalculate_document(setup[name], simulation, job.snapshot, jbnr)
        candidate = chosen.get(field.id)
        _reprice_pick(setup, picks.get(field.id), candidate, simulation, job.snapshot, jbnr)
        if candidate is not None:
            value = recalculate_candidate(candidate, simulation, job.snapshot, jbnr)
            setup["economics_candidate"] = value.model_dump(mode="json")
        elif setup.get("baseline_candidate"):
            from app.domain.rotation_candidate import RotationCandidateEvaluation

            value = RotationCandidateEvaluation.model_validate(setup["baseline_candidate"])
        else:
            continue
        valued_field = field.model_copy(
            update={
                "db2": value.avg_db_kr_ha * field.area_ha,
                "fen": value.avg_fen * field.area_ha,
            }
        )
        values = {
            key: valued_field.model_dump(mode="json")[key] for key in simulation_store.OUTPUT_KEYS
        }
        if field.allowed_rotation_ids:
            setup["fixed_candidate"] = value.model_dump(mode="json")
            setup["fixed"] = values
        else:
            setup["baseline"] = values
            setup["baseline_revision"] = job.expected_revision
    _deadline(context)
    with session.begin():
        row = store.locked_setup(session, job)
        if row is None or row.creation_status != "running":
            return False
        session.execute(
            update(setups)
            .where(setups.c.id == job.simulation_id)
            .values(
                fields=setup_fields,
                data={**row.data, "economics_snapshot": job.snapshot.model_dump(mode="json")},
                creation_status="done",
            )
        )
        view, prepared = read_model_store.build_simulation(session, job.simulation_id)
        _deadline(context)
        read_model_store.publish_simulation(
            session, job.simulation_id, job.expected_revision, view, prepared
        )
        return True


def execute(job, context=None, *, execution_session=None):
    job = EconomicsRecalculationJob.model_validate(job)
    context = context or CalculationContext()
    owner = (
        creation_store.execution_session(job.simulation_id)
        if execution_session is None
        else nullcontext(execution_session)
    )
    with owner as session:
        with session.begin():
            row = store.locked_setup(session, job)
            if row is None or row.creation_status in ("done", "failed"):
                return
        store.set_status(session, job, "running")
        try:
            _deadline(context)
            clear_lookup_cache()
            _execute(session, job, context)
        except Exception as error:
            logger.exception(
                "economics_recalculation_failed simulation_id=%s job_id=%s",
                job.simulation_id,
                job.job_id,
            )
            session.rollback()
            store.set_status(session, job, "failed")
            raise CalculationFailedError(
                "Økonomien kunne ikke genberegnes. Prøv igen.",
                timeout=isinstance(error, TimeoutError),
            ) from error
