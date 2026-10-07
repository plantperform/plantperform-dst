from collections.abc import Callable
from contextvars import ContextVar

remaining_time: ContextVar[Callable[[], int] | None] = ContextVar("remaining_time", default=None)


class OptimizationDeadlineError(Exception):
    pass


def check_deadline():
    remaining = remaining_time.get()
    if remaining and remaining() < 20_000:
        raise OptimizationDeadlineError("Optimeringen overskred den samlede tidsgrænse.")


def solver_time_limit(requested: float) -> float:
    check_deadline()
    remaining = remaining_time.get()
    return min(requested, remaining() / 1000 - 15) if remaining else requested
