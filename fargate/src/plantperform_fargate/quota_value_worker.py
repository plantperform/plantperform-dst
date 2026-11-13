"""Execute a queued kvote value curve ("Kvotehandel") locally.

A job is one kystvandopland. Only that opland's kvotegivende marker are
prepared and optimized; the rest of the farm keeps the plan of the latest
Års-optimering and counts as locked marker do.
"""

import logging
import os
import time

from app.data import quota_value_store
from app.domain.optimization import NUM_YEARS, YearlyOptimizeSimulationRequest
from app.domain.quota_value import (
    QuotaFieldChange,
    QuotaFieldRotation,
    QuotaValueCurve,
    QuotaValueOutput,
    QuotaValuePoint,
)
from app.domain.rotation_candidate import RotationCandidateEvaluation
from app.services.scenario.candidate_evaluator import START_CALENDAR_YEAR
from plantperform_fargate.deadline import OptimizationDeadlineError, remaining_time
from plantperform_fargate.orchestrator import (
    OptimizationInfeasibleError,
    YearlyInputBuild,
    build_yearly_input,
    yearly_field_contribution,
)
from plantperform_fargate.preparation import prepare
from plantperform_fargate.quota_value import (
    BaseNotSolvedError,
    QuotaCurve,
    QuotaPoint,
    QuotaValueAnalysis,
    analyse_quota_value,
    hint_from_candidates,
    tradable_kystvandoplande,
)
from plantperform_fargate.worker import _LocalExecutionContext, yearly_caps

logger = logging.getLogger(__name__)

# Each point is solved at most this long; a curve needs many solves within one
# job. Points normally stop earlier, at their gap (seconds at 0.1 %, up to about
# a minute at 0.05 % on a 48-mark farm); the limit only cuts off the hard ones,
# which then keep a wider range. Selling points force many marker to change and
# are the hard ones. The job's deadline still applies to every solve.
POINT_TIME_LIMIT_SECONDS = 60
SELLING_POINT_TIME_LIMIT_SECONDS = 60


def parallel_solves() -> int:
    """How many refinement solves a job runs at once (OPTIMIZER_PARALLEL_SOLVES).

    Every solve runs OPTIMIZER_SOLVER_THREADS CP-SAT threads, and a job has the
    machine to itself, so without the setting every core is used.
    os.cpu_count() reports the host's cores even in a container limited to
    fewer, so a server sets the variable explicitly.
    """
    configured = os.getenv("OPTIMIZER_PARALLEL_SOLVES")
    if configured:
        return max(1, int(configured))
    threads = max(1, int(os.getenv("OPTIMIZER_SOLVER_THREADS", "2")))
    return max(1, (os.cpu_count() or 1) // threads)


def _by_year(values) -> dict[int, float]:
    return {START_CALENDAR_YEAR + i: value for i, value in enumerate(values)}


def _crops(built: YearlyInputBuild, field_id: str, option_key: str) -> list[str]:
    option = next(o for o in built.options_by_field_id[field_id] if o.key == option_key)
    return [year.afgrode_navn for year in option.years]


def _changed_fields(
    built: YearlyInputBuild, base: QuotaPoint, point: QuotaPoint
) -> list[QuotaFieldChange]:
    names = {field.id: field.name for field in built.fields}
    return [
        QuotaFieldChange(
            field_id=field_id,
            field_name=names[field_id],
            from_rotation_id=base.choices[field_id],
            to_rotation_id=key,
            from_crops=_crops(built, field_id, base.choices[field_id]),
            to_crops=_crops(built, field_id, key),
        )
        for field_id, key in point.choices.items()
        if base.choices.get(field_id) != key
    ]


def _rotations(
    built: YearlyInputBuild,
    point: QuotaPoint,
    base_selected: dict[str, RotationCandidateEvaluation],
    field_ids: list[str],
) -> list[QuotaFieldRotation]:
    """Every mark's rotation in the point's plan; the others keep the base plan's."""
    if not point.feasible:
        return []
    rotations = []
    for field_id in field_ids:
        key = point.choices.get(field_id)
        if key is not None:
            options = built.options_by_field_id[field_id]
            candidate = next(o for o in options if o.key == key).candidate
        else:
            candidate = base_selected.get(field_id)
            if candidate is None:
                continue
        rotations.append(
            QuotaFieldRotation(
                field_id=field_id,
                base_ref=candidate.base_ref or candidate.ref,
                overrides=candidate.overrides,
                start_year=candidate.start_year,
            )
        )
    return rotations


def _curve(
    built: YearlyInputBuild,
    base: QuotaPoint,
    curve: QuotaCurve,
    base_selected: dict[str, RotationCandidateEvaluation],
    field_ids: list[str],
) -> QuotaValueCurve:
    points = [
        QuotaValuePoint(
            trade_kg=point.trade_kg,
            status=point.status,
            db2=point.db2,
            db2_upper_bound=point.db2_upper_bound,
            solution_from_trade_kg=point.solution_from_trade_kg,
            n_load_by_year=_by_year(point.n_load_by_year),
            feed_units_by_year=_by_year(point.fen_by_year),
            changed_fields=_changed_fields(built, base, point) if point.feasible else [],
            rotations=_rotations(built, point, base_selected, field_ids),
        )
        for point in curve.points
    ]
    return QuotaValueCurve(
        kystvand_id=curve.kystvand_id,
        kvote_kg=curve.kvote_kg,
        unconstrained_trade_kg=curve.unconstrained_trade_kg,
        points=points,
    )


def quota_value_output(
    built: YearlyInputBuild,
    analysis: QuotaValueAnalysis,
    min_fen,
    max_fen,
    base_selected: dict[str, RotationCandidateEvaluation],
    field_ids: list[str],
) -> QuotaValueOutput:
    return QuotaValueOutput(
        base_db2=analysis.base.db2,
        base_feed_units_by_year=_by_year(analysis.base.fen_by_year or (0.0,) * NUM_YEARS),
        min_fen=min_fen,
        max_fen=max_fen,
        curve=_curve(built, analysis.base, analysis.curve, base_selected, field_ids),
    )


def _report_progress(simulation_id: str, run_id: str, steps: list[dict]) -> None:
    """Progress is only shown to the user; failing to save it must not stop the run."""
    try:
        quota_value_store.report_quota_progress(simulation_id, run_id, steps)
    except Exception:
        logger.exception(
            "quota_value_progress_failed simulation_id=%s run_id=%s", simulation_id, run_id
        )


def build_opland_input(
    farm_id,
    simulation_id,
    kystvand_id: int,
    captured,
    request: YearlyOptimizeSimulationRequest,
    base_selected: dict[str, RotationCandidateEvaluation],
) -> YearlyInputBuild:
    """The yearly input with only the opland's kvotegivende marker to choose.

    Every other mark counts with the rotation the base run chose for it.
    """
    simulation, fields, setup_fields, contexts = captured
    traded = [f for f in fields if f.kystvand_id == kystvand_id and f.kvotegivende]
    if not traded:
        raise OptimizationInfeasibleError("Oplandet har ingen kvotegivende marker.")
    traded_ids = {f.id for f in traded}
    others = [f for f in fields if f.id not in traded_ids]
    if any(f.id not in base_selected for f in others):
        raise OptimizationInfeasibleError(
            "Optimeringen mangler et sædskifte for en mark. Optimer simuleringen igen."
        )
    with_udnyttet_n = simulation.godning.oeko_n_loft_kg_ha is not None
    fixed = tuple(
        yearly_field_contribution(f, base_selected[f.id], with_udnyttet_n) for f in others
    )
    simulation.constraints = simulation.constraints.model_copy(
        update={"max_fields_with_new_rotation": None}
    )
    snapshot = prepare(simulation, traded, setup_fields, contexts)
    return build_yearly_input(
        farm_id,
        simulation_id,
        POINT_TIME_LIMIT_SECONDS,
        yearly_caps(request),
        request.db2_swing_pct,
        frozenset(request.excluded_afgrodekoder),
        "",
        snapshot=snapshot,
        extra_fixed_fields=fixed,
    )


def execute_quota_value(simulation_id: str, run_id: str) -> None:
    started = time.monotonic()
    claimed = quota_value_store.claim_quota_value(simulation_id, run_id)
    if claimed is None:
        logger.info("quota_value_skipped simulation_id=%s run_id=%s", simulation_id, run_id)
        return
    kystvand_id, price, farm_id, revision, parameters, base_selected, trade_range = claimed
    deadline_token = remaining_time.set(_LocalExecutionContext().get_remaining_time_in_millis)
    outcome = "failed"
    try:
        captured = quota_value_store.load_quota_snapshot(simulation_id, revision)
        if captured is None:
            quota_value_store.finish_quota_value(
                simulation_id,
                run_id,
                error={"code": "OUTDATED", "message": "Simuleringen er ændret. Beregn igen."},
            )
            outcome = "outdated"
            return
        request = YearlyOptimizeSimulationRequest.model_validate(parameters)
        built = build_opland_input(
            farm_id, simulation_id, kystvand_id, captured, request, base_selected
        )
        if kystvand_id not in tradable_kystvandoplande(built.input):
            raise OptimizationInfeasibleError("Oplandet har ingen kvote at handle med.")
        parallel = parallel_solves()
        logger.info(
            "quota_value_started simulation_id=%s run_id=%s kystvand_id=%s fields=%d "
            "parallel_solves=%d",
            simulation_id,
            run_id,
            kystvand_id,
            len(built.fields),
            parallel,
        )
        try:
            analysis = analyse_quota_value(
                built.input,
                kystvand_id,
                price,
                base_hint=hint_from_candidates(built.input, base_selected),
                selling_time_limit_seconds=SELLING_POINT_TIME_LIMIT_SECONDS,
                trade_range=trade_range,
                parallel_solves=parallel,
                on_progress=lambda steps: _report_progress(simulation_id, run_id, steps),
            )
        except BaseNotSolvedError as error:
            if error.status == "INFEASIBLE":
                raise OptimizationInfeasibleError(
                    "Planen kan ikke holde oplandets kvote uden handel, ofte fordi låste "
                    "marker udleder for meget. Lås nogle marker op, og beregn igen."
                ) from error
            raise OptimizationDeadlineError(
                "Optimeringen uden handel fandt ingen løsning inden for tidsgrænsen."
            ) from error
        simulation = captured[0]
        output = quota_value_output(
            built,
            analysis,
            simulation.constraints.min_fen,
            simulation.constraints.max_fen,
            base_selected,
            [field.id for field in captured[1]],
        )
        saved = quota_value_store.finish_quota_value(
            simulation_id, run_id, output=output.model_dump(mode="json")
        )
        outcome = "completed" if saved else "stale"
    except OptimizationInfeasibleError as error:
        quota_value_store.finish_quota_value(
            simulation_id, run_id, error={"code": "INFEASIBLE", "message": str(error)}
        )
    except OptimizationDeadlineError as error:
        quota_value_store.finish_quota_value(
            simulation_id, run_id, error={"code": "TIMEOUT", "message": str(error)}
        )
    except Exception:
        logger.exception("quota_value_failed simulation_id=%s run_id=%s", simulation_id, run_id)
        quota_value_store.finish_quota_value(
            simulation_id,
            run_id,
            error={"code": "WORKER_ERROR", "message": "Beregningen fejlede. Prøv igen."},
        )
    finally:
        remaining_time.reset(deadline_token)
        logger.info(
            "quota_value_finished simulation_id=%s run_id=%s outcome=%s duration_seconds=%.3f",
            simulation_id,
            run_id,
            outcome,
            time.monotonic() - started,
        )
