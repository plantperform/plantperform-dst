"""Execute revision-bound optimization jobs locally or in Fargate."""

import logging
import os
import time
from contextlib import contextmanager
from datetime import UTC, datetime

from app.data import optimization_store
from app.domain.optimization import (
    EXECUTION_TIMEOUT_SECONDS,
    MAX_JOB_ATTEMPTS,
    NUM_YEARS,
    RETRY_DELAY_SECONDS,
    DeliveryOutcome,
    ExecutionResult,
    OptimizeSimulationRequest,
    OptimizeSimulationResponse,
    YearlyOptimizeSimulationRequest,
    attempt_limit,
    worker_tier,
)
from app.domain.soil import MissingSoilDataError
from app.services.optimization.failures import is_transient
from app.services.rotations.custom import simulation_scope
from app.services.scenario.candidate_evaluator import START_CALENDAR_YEAR
from optimizer.deadline import (
    SOLVER_TIME_LIMIT_SECONDS,
    OptimizationDeadlineError,
    check_deadline,
    remaining_time,
)
from optimizer.memory import allocation_failed, memory_observation, memory_pressure
from optimizer.orchestrator import (
    OptimizationInfeasibleError,
    run_optimization,
    run_yearly_optimization,
)
from optimizer.preparation import hydrate, prepare
from optimizer.search import OptimizationUnknownError

logger = logging.getLogger(__name__)


@contextmanager
def _timed_phase(phase, simulation_id, run_id, *, field_count=None, candidate_count=None):
    started = time.monotonic()
    try:
        yield
    finally:
        logger.info(
            "optimizer_phase simulation_id=%s run_id=%s phase=%s duration_seconds=%.3f "
            "field_count=%s candidate_count=%s memory=%s",
            simulation_id,
            run_id,
            phase,
            time.monotonic() - started,
            field_count,
            candidate_count,
            memory_observation(),
        )


def yearly_caps(
    request: YearlyOptimizeSimulationRequest,
) -> dict[int | None, tuple[float | None, ...]]:
    """The request's per-calendar-year caps as one tuple of NUM_YEARS per opland."""
    return {
        cap.kystvand_id: tuple(
            cap.max_n_load_by_year.get(START_CALENDAR_YEAR + i) for i in range(NUM_YEARS)
        )
        for cap in request.max_n_load_by_kystvandopland
    }


class _LocalExecutionContext:
    def __init__(self, timeout_seconds=EXECUTION_TIMEOUT_SECONDS):
        self.deadline = time.monotonic() + timeout_seconds

    def get_remaining_time_in_millis(self):
        return max(0, int((self.deadline - time.monotonic()) * 1000))


def execute(
    simulation_id,
    run_id,
    context,
    *,
    sqs_delivery=False,
    farm_id=None,
    claimed=None,
    memory_limit=None,
):
    started = time.monotonic()
    received_at = datetime.now(UTC)
    supervised = claimed is not None
    if not supervised:
        with _timed_phase("claim", simulation_id, run_id):
            claimed = optimization_store.claim(
                simulation_id, run_id, sqs_delivery=sqs_delivery, farm_id=farm_id
            )
    if claimed is None:
        logger.info("optimizer_skipped simulation_id=%s run_id=%s", simulation_id, run_id)
        return ExecutionResult(DeliveryOutcome.ACK)
    row, farm_id, token = claimed
    tier = worker_tier(row["status"])
    deadline_token = remaining_time.set(context.get_remaining_time_in_millis)
    outcome = "failed"
    saved = False
    result = ExecutionResult(DeliveryOutcome.ACK)
    queued_at = row.get("queued_at")
    logger.info(
        "optimizer_started simulation_id=%s run_id=%s attempt=%s dispatch_wait_seconds=%s",
        simulation_id,
        run_id,
        row["attempts"] + 1,
        round(max(0, (received_at - queued_at).total_seconds()), 3) if queued_at else None,
    )
    try:
        check_deadline()
        with _timed_phase("load_snapshot", simulation_id, run_id):
            snapshot = optimization_store.load_snapshot(
                simulation_id, run_id, token, row["input_revision"]
            )
        if snapshot is None:
            outcome = "stale"
            return ExecutionResult(DeliveryOutcome.ACK)
        with simulation_scope(snapshot[0]):
            check_deadline()
            with _timed_phase("prepare_candidates", simulation_id, run_id):
                snapshot = prepare(*snapshot)
            request_type = (
                YearlyOptimizeSimulationRequest
                if row["kind"] == "yearly"
                else OptimizeSimulationRequest
            )
            request = request_type.model_validate(row["parameters"])
            args = (farm_id, simulation_id, SOLVER_TIME_LIMIT_SECONDS)
            excluded = frozenset(request.excluded_afgrodekoder)
            with _timed_phase("solve", simulation_id, run_id):
                if row["kind"] == "yearly":
                    solved = run_yearly_optimization(
                        *args,
                        yearly_caps(request),
                        request.db2_swing_pct,
                        excluded,
                        row["requested_by"],
                        snapshot=snapshot,
                        quota_trades=tuple(request.quota_trades),
                    )
                else:
                    solved = run_optimization(
                        *args, excluded, row["requested_by"], snapshot=snapshot
                    )
            check_deadline()
            with _timed_phase(
                "hydrate_winners",
                simulation_id,
                run_id,
                field_count=len(snapshot[1]),
                candidate_count=len(solved.selected_candidates),
            ):
                selected = hydrate(snapshot, solved.selected_candidates)
            if selected is None:
                outcome = "stale"
                return ExecutionResult(DeliveryOutcome.ACK)
            check_deadline()
            response = OptimizeSimulationResponse(
                status=solved.output.status,
                optimality_gap_pct=solved.output.optimality_gap_pct,
                objective_db2=solved.output.total_db2,
                total_n_load_kg=solved.output.total_n_load_kg,
                total_leaching_kg=solved.output.total_leaching_kg,
                total_fen=solved.output.total_fen,
                fields=list(solved.fields),
                assignments=[
                    {"field_id": a.field_id, "rotation_id": a.rotation_id}
                    for a in solved.output.assignments
                ],
                total_db2_by_year={
                    START_CALENDAR_YEAR + i: v
                    for i, v in enumerate(getattr(solved.output, "total_db2_by_year", ()))
                },
                total_n_load_by_year={
                    START_CALENDAR_YEAR + i: v
                    for i, v in enumerate(getattr(solved.output, "total_n_load_by_year", ()))
                },
                quota_trades=list(getattr(solved, "quota_trades", ())),
            )
            with _timed_phase(
                "persist_result", simulation_id, run_id, field_count=len(snapshot[1])
            ):
                saved = optimization_store.finish(
                    simulation_id,
                    run_id,
                    token,
                    row["input_revision"],
                    setup_fields=snapshot.setup_fields,
                    output={
                        "response": response.model_dump(mode="json"),
                        "economics_snapshot": snapshot[0].economics_snapshot.model_dump(
                            mode="json"
                        ),
                        "rotation_groups": {
                            key: value.model_dump(mode="json")
                            for key, value in (snapshot[0].rotation_groups or {}).items()
                        },
                        "fields_before": [
                            field.model_dump(mode="json")
                            for field in (snapshot.fields_before or snapshot[1])
                        ],
                        "selected_candidates": {
                            key: value.model_dump(mode="json") for key, value in selected.items()
                        },
                    },
                )
        outcome = "completed" if saved else "stale"
    except (OptimizationInfeasibleError, OptimizationUnknownError) as error:
        saved = optimization_store.finish(
            simulation_id,
            run_id,
            token,
            row["input_revision"],
            error={"code": error.code, "message": str(error)},
        )
        outcome = "infeasible" if saved else "stale"
    except Exception as error:
        if supervised and allocation_failed(error):
            outcome = "memory_limit"
            raise
        # A native allocation or thread creation can surface as a generic error
        # between supervisor polls. Check for actual pressure before persisting it.
        if (
            memory_limit
            and isinstance(error, RuntimeError)
            and memory_pressure(os.getpid(), memory_limit)
        ):
            outcome = "memory_limit"
            raise MemoryError from error
        logger.exception("optimizer_attempt_failed run_id=%s", run_id)
        retry = is_transient(error) and row["attempts"] + 1 < attempt_limit(tier)
        if isinstance(error, MemoryError):
            failure = {"code": "OUT_OF_MEMORY", "message": "Optimeringen løb tør for hukommelse."}
        elif isinstance(error, OptimizationDeadlineError):
            failure = {"code": "TIMEOUT", "message": str(error)}
        elif isinstance(error, (MissingSoilDataError, ValueError)):
            failure = {"code": "INVALID_INPUT", "message": str(error)}
        else:
            failure = {"code": "WORKER_ERROR", "message": "Optimeringen fejlede. Prøv igen."}
        saved = optimization_store.finish(
            simulation_id,
            run_id,
            token,
            row["input_revision"],
            retry=retry,
            error=failure,
        )
        outcome = ("retry" if retry else "failed") if saved else "stale"
        if saved:
            result = ExecutionResult(
                DeliveryOutcome.RETRY if retry else DeliveryOutcome.DEAD_LETTER,
                retry_after=RETRY_DELAY_SECONDS if retry else None,
                error=failure,
            )
    finally:
        remaining_time.reset(deadline_token)
        logger.info(
            "optimizer_finished simulation_id=%s run_id=%s saved=%s outcome=%s "
            "duration_seconds=%.3f",
            simulation_id,
            run_id,
            saved,
            outcome,
            time.monotonic() - started,
        )
        if sqs_delivery and not saved and outcome != "memory_limit":
            optimization_store.check_delivery_state(simulation_id, run_id, tier)
    return result


def execute_local(simulation_id, run_id):
    for attempt in range(MAX_JOB_ATTEMPTS):
        try:
            result = execute(simulation_id, run_id, _LocalExecutionContext())
            if result.outcome != DeliveryOutcome.RETRY:
                return
        except Exception as error:
            logger.exception("local_optimizer_attempt_failed run_id=%s", run_id)
            if not is_transient(error) or attempt + 1 == MAX_JOB_ATTEMPTS:
                optimization_store.recover_run(simulation_id, run_id, interrupted=True)
                return
        if attempt + 1 < MAX_JOB_ATTEMPTS:
            time.sleep(RETRY_DELAY_SECONDS)
    optimization_store.recover_run(simulation_id, run_id, interrupted=True)
