"""Cooperative request budget shared by small synchronous calculations."""

import time


class CalculationFailedError(RuntimeError):
    def __init__(self, message, *, timeout=False):
        super().__init__(message)
        self.timeout = timeout


class CalculationContext:
    def __init__(self):
        self.deadline = time.monotonic() + 45

    def get_remaining_time_in_millis(self):
        return max(0, int((self.deadline - time.monotonic()) * 1000))
