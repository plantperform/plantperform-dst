from collections.abc import Callable
from contextvars import ContextVar

remaining_time: ContextVar[Callable[[], int] | None] = ContextVar("remaining_time", default=None)
RESULT_RESERVE_SECONDS = 30


class OptimizationDeadlineError(Exception):
    pass


def check_deadline():
    remaining = remaining_time.get()
    if remaining and remaining() < 20_000:
        raise OptimizationDeadlineError("Optimeringen overskred den samlede tidsgrænse.")


def solver_time_limit(requested: float) -> float:
    remaining = remaining_time.get()
    if remaining is None:
        return requested
    available = remaining() / 1000 - RESULT_RESERVE_SECONDS
    if available <= 0:
        raise OptimizationDeadlineError("Optimeringen overskred den samlede tidsgrænse.")
    return min(requested, available)
