"""Execute queued optimization jobs locally or in Lambda."""

import logging
import time
from contextlib import contextmanager
from datetime import UTC, datetime

from app.data import optimization_store
from app.domain.optimization import (
    EXECUTION_TIMEOUT_SECONDS,
    MAX_JOB_ATTEMPTS,
    NUM_YEARS,
    RETRY_DELAY_SECONDS,
    OptimizeSimulationRequest,
    OptimizeSimulationResponse,
    YearlyOptimizeSimulationRequest,
)
from app.services.scenario.candidate_evaluator import START_CALENDAR_YEAR
from plantperform_optimizer.deadline import (
    OptimizationDeadlineError,
    check_deadline,
    remaining_time,
)
from plantperform_optimizer.orchestrator import (
    OptimizationInfeasibleError,
    OptimizationUnknownError,
    run_optimization,
    run_yearly_optimization,
)

logger = logging.getLogger(__name__)


@contextmanager
def _timed_phase(phase, simulation_id, run_id, *, field_count=None, candidate_count=None):
    started = time.monotonic()
    try:
        yield
    finally:
        logger.info(
            "optimizer_phase simulation_id=%s run_id=%s phase=%s duration_seconds=%.3f "
            "field_count=%s candidate_count=%s",
            simulation_id,
            run_id,
            phase,
            time.monotonic() - started,
            field_count,
            candidate_count,
        )


class _LocalExecutionContext:
    def __init__(self):
        self.deadline = time.monotonic() + EXECUTION_TIMEOUT_SECONDS

    def get_remaining_time_in_millis(self):
        return max(0, int((self.deadline - time.monotonic()) * 1000))


def execute(simulation_id, run_id, context, *, sqs_delivery=False):
    started = time.monotonic()
    received_at = datetime.now(UTC)
    with _timed_phase("claim", simulation_id, run_id):
        claimed = optimization_store.claim(simulation_id, run_id, sqs_delivery=sqs_delivery)
    if claimed is None:
        logger.info("optimizer_skipped simulation_id=%s run_id=%s", simulation_id, run_id)
        return
    row, farm_id, token = claimed
    deadline_token = remaining_time.set(context.get_remaining_time_in_millis)
    outcome = "failed"
    saved = False
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
            return
        check_deadline()
        request_type = (
            YearlyOptimizeSimulationRequest
            if row["kind"] == "yearly"
            else OptimizeSimulationRequest
        )
        request = request_type.model_validate(row["parameters"])
        args = (farm_id, simulation_id, request.time_limit_seconds)
        excluded = frozenset(request.excluded_afgrodekoder)
        with _timed_phase("solve", simulation_id, run_id):
            if row["kind"] == "yearly":
                caps = {
                    cap.kystvand_id: tuple(
                        cap.max_n_load_by_year.get(START_CALENDAR_YEAR + i)
                        for i in range(NUM_YEARS)
                    )
                    for cap in request.max_n_load_by_kystvandopland
                }
                solved = run_yearly_optimization(
                    *args,
                    caps,
                    request.db2_swing_pct,
                    excluded,
                    row["requested_by"],
                    snapshot=snapshot,
                )
            else:
                solved = run_optimization(*args, excluded, row["requested_by"], snapshot=snapshot)
        check_deadline()
        with _timed_phase(
            "hydrate_winners",
            simulation_id,
            run_id,
            field_count=len(snapshot[1]),
            candidate_count=len(solved.selected_candidates),
        ):
            selected = optimization_store.hydrate_winners(
                simulation_id, run_id, token, row["input_revision"], solved.selected_candidates
            )
        if selected is None:
            outcome = "stale"
            return
        check_deadline()
        response = OptimizeSimulationResponse(
            status=solved.output.status,
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
        )
        saved = optimization_store.finish(
            simulation_id,
            run_id,
            token,
            row["input_revision"],
            output={
                "response": response.model_dump(mode="json"),
                "fields_before": [field.model_dump(mode="json") for field in snapshot[1]],
                "selected_candidates": {
                    key: value.model_dump(mode="json") for key, value in selected.items()
                },
            },
        )
        outcome = "completed" if saved else "stale"
    except (
        OptimizationInfeasibleError,
        OptimizationUnknownError,
        OptimizationDeadlineError,
    ) as error:
        code = "INFEASIBLE" if isinstance(error, OptimizationInfeasibleError) else "TIMEOUT"
        saved = optimization_store.finish(
            simulation_id,
            run_id,
            token,
            row["input_revision"],
            error={"code": code, "message": str(error)},
        )
        outcome = "failed" if saved else "stale"
    except Exception:
        logger.exception("optimizer_attempt_failed run_id=%s", run_id)
        retry = row["attempts"] + 1 < MAX_JOB_ATTEMPTS
        saved = optimization_store.finish(
            simulation_id,
            run_id,
            token,
            row["input_revision"],
            retry=retry,
            error={"code": "WORKER_ERROR", "message": "Optimeringen fejlede. Prøv igen."},
        )
        outcome = ("retry" if retry else "failed") if saved else "stale"
        if saved and (retry or sqs_delivery):
            raise
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
        if sqs_delivery and not saved:
            optimization_store.check_delivery_state(simulation_id, run_id)


def execute_local(simulation_id, run_id):
    for attempt in range(MAX_JOB_ATTEMPTS):
        try:
            execute(simulation_id, run_id, _LocalExecutionContext())
            return
        except Exception:
            logger.exception("local_optimizer_attempt_failed run_id=%s", run_id)
            if attempt + 1 < MAX_JOB_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)
            else:
                # Errors before claim or during persistence may escape execute's
                # normal terminal-failure handling. Do not leave that run active.
                optimization_store.recover_run(simulation_id, run_id, interrupted=True)
