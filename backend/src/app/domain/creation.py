"""Creation state is independent of optimization state."""

from typing import Literal

from app.domain.base import CamelModel

CreationStatus = Literal["queued", "running", "done", "failed"]


class RetrySimulationCreationRequest(CamelModel):
    optimize_on_create: bool = False


class CreationActiveError(Exception):
    """Another database session is executing this simulation's creation."""


class CreationNotReadyError(Exception):
    pass


class CreationConflictError(Exception):
    pass


class CreationQueueUnavailableError(Exception):
    def __init__(self, message: str, simulation_id: str | None = None):
        super().__init__(message)
        self.simulation_id = simulation_id
