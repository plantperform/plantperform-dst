"""Lightweight local dispatch; solver imports happen on an initialization thread."""

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

from app.data.optimization_store import fail_queued_run

logger = logging.getLogger(__name__)
_lock = Lock()
_runtime = None


def _initialize():
    started = time.monotonic()
    outcome = "failed"
    try:
        from plantperform_optimizer.worker import execute_local

        outcome = "ready"
        return execute_local
    except Exception:
        logger.exception("optimizer_initialization_failed")
        raise
    finally:
        logger.info(
            "optimizer_initialized outcome=%s duration_seconds=%.3f",
            outcome,
            time.monotonic() - started,
        )


class LocalOptimizer:
    def __init__(self):
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="optimizer-init")
        self.initialized = self.executor.submit(_initialize)

    def close(self):
        # The lifespan owns the initialization thread and joins it on shutdown.
        self.executor.shutdown(wait=True)
        global _runtime
        with _lock:
            if _runtime is self:
                _runtime = None


def start_local_optimizer():
    global _runtime
    with _lock:
        if _runtime is None:
            _runtime = LocalOptimizer()
        return _runtime


def execute_local_when_ready(simulation_id, run_id):
    runtime = start_local_optimizer()
    started = time.monotonic()
    try:
        execute_local = runtime.initialized.result()
    except Exception:
        logger.exception(
            "local_optimizer_initialization_failed simulation_id=%s run_id=%s",
            simulation_id,
            run_id,
        )
        fail_queued_run(simulation_id, run_id)
        return
    logger.info(
        "optimizer_initialization_wait simulation_id=%s run_id=%s duration_seconds=%.3f",
        simulation_id,
        run_id,
        time.monotonic() - started,
    )
    execute_local(simulation_id, run_id)
