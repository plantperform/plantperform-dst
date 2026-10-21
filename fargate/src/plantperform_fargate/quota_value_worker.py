"""Execute a queued kvote value curve ("Kvotehandel") locally."""

import logging
import os
import time

from app.data import quota_value_store
from app.domain.optimization import NUM_YEARS, YearlyOptimizeSimulationRequest
from app.domain.quota_value import (
    QuotaFieldChange,
    QuotaFieldRotation,
    QuotaValueCurve,
    QuotaValueInteraction,
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
)
from plantperform_fargate.preparation import prepare
from plantperform_fargate.quota_value import (
    BaseNotSolvedError,
    QuotaCurve,
    QuotaPoint,
    QuotaValueAnalysis,
    analyse_quota_value,
    hint_from_candidates,
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
    """How many solves a job runs at once (OPTIMIZER_PARALLEL_SOLVES): the
    oplande's curves, and then the contenders solved again more precisely.

    Every solve runs OPTIMIZER_SOLVER_THREADS CP-SAT threads, so without the
    setting about half of the machine's cores are used, leaving the rest to the
    web server and other jobs. os.cpu_count() reports the host's cores even in
    a container limited to fewer, so a server sets the variable explicitly.
    """
    configured = os.getenv("OPTIMIZER_PARALLEL_SOLVES")
    if configured:
        return max(1, int(configured))
    threads = max(1, int(os.getenv("OPTIMIZER_SOLVER_THREADS", "2")))
    return max(1, (os.cpu_count() or 1) // threads // 2)


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
) -> list[QuotaFieldRotation]:
    """Every mark's rotation in the point's plan; locked marker keep their own."""
    if not point.feasible:
        return []
    rotations = []
    for field in built.fields:
        key = point.choices.get(field.id)
        if key is not None:
            options = built.options_by_field_id[field.id]
            candidate = next(o for o in options if o.key == key).candidate
        else:
            candidate = base_selected.get(field.id)
            if candidate is None:
                continue
        rotations.append(
            QuotaFieldRotation(
                field_id=field.id,
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
) -> QuotaValueCurve:
    points = [
        QuotaValuePoint(
            trade_kg=point.trade_kg,
            status=point.status,
            db2=point.db2,
            db2_upper_bound=point.db2_upper_bound,
            solution_from_trade_kg=point.solution_from_trade_kg,
            n_load_by_year=_by_year(point.n_load_by_year),
            cap_by_year=_by_year(point.cap_by_year),
            feed_units_by_year=_by_year(point.fen_by_year),
            changed_fields=_changed_fields(built, base, point) if point.feasible else [],
            rotations=_rotations(built, point, base_selected),
        )
        for point in curve.points
    ]
    return QuotaValueCurve(
        kystvand_id=curve.kystvand_id,
        base_cap_by_year=_by_year(curve.base_cap_by_year),
        unconstrained_trade_kg=curve.unconstrained_trade_kg,
        points=points,
    )


def quota_value_output(
    built: YearlyInputBuild,
    analysis: QuotaValueAnalysis,
    min_fen,
    max_fen,
    base_selected: dict[str, RotationCandidateEvaluation] | None = None,
) -> QuotaValueOutput:
    interaction = analysis.interaction
    return QuotaValueOutput(
        base_db2=analysis.base.db2,
        base_feed_units_by_year=_by_year(analysis.base.fen_by_year or (0.0,) * NUM_YEARS),
        min_fen=min_fen,
        max_fen=max_fen,
        curves=[
            _curve(built, analysis.base, curve, base_selected or {}) for curve in analysis.curves
        ],
        interaction=(
            QuotaValueInteraction(
                price_kr_per_kg=interaction.price_kr_per_kg,
                trades_kg=interaction.trades_kg,
                separate_gain=interaction.separate_gain,
                combined_status=interaction.combined_status,
                combined_gain=interaction.combined_gain,
            )
            if interaction
            else None
        ),
    )


def _report_progress(simulation_id: str, run_id: str, steps: list[dict]) -> None:
    """Progress is only shown to the user; failing to save it must not stop the run."""
    try:
        quota_value_store.report_quota_progress(simulation_id, run_id, steps)
    except Exception:
        logger.exception(
            "quota_value_progress_failed simulation_id=%s run_id=%s", simulation_id, run_id
        )


def execute_quota_value(simulation_id: str, run_id: str) -> None:
    started = time.monotonic()
    claimed = quota_value_store.claim_quota_value(simulation_id, run_id)
    if claimed is None:
        logger.info("quota_value_skipped simulation_id=%s run_id=%s", simulation_id, run_id)
        return
    price, farm_id, revision, parameters, base_selected, trade_range = claimed
    deadline_token = remaining_time.set(_LocalExecutionContext().get_remaining_time_in_millis)
    outcome = "failed"
    try:
        captured = quota_value_store.load_quota_snapshot(simulation_id, revision)
        if captured is None:
            quota_value_store.finish_quota_value(
                simulation_id,
                run_id,
                error={"code": "OUTDATED", "message": "Scenariet er ændret. Beregn igen."},
            )
            outcome = "outdated"
            return
        # The same transient candidates an Års-optimering prepares; nothing is stored.
        snapshot = prepare(*captured)
        request = YearlyOptimizeSimulationRequest.model_validate(parameters)
        built = build_yearly_input(
            farm_id,
            simulation_id,
            POINT_TIME_LIMIT_SECONDS,
            yearly_caps(request),
            request.db2_swing_pct,
            frozenset(request.excluded_afgrodekoder),
            "",
            snapshot=snapshot,
        )
        parallel = parallel_solves()
        logger.info(
            "quota_value_started simulation_id=%s run_id=%s parallel_solves=%d",
            simulation_id,
            run_id,
            parallel,
        )
        try:
            analysis = analyse_quota_value(
                built.input,
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
                    "Optimeringen uden handel kan ikke længere løses. Kør Års-optimering igen."
                ) from error
            raise OptimizationDeadlineError(
                "Optimeringen uden handel fandt ingen løsning inden for tidsgrænsen."
            ) from error
        simulation = snapshot[0]
        output = quota_value_output(
            built,
            analysis,
            simulation.constraints.min_fen,
            simulation.constraints.max_fen,
            base_selected,
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
