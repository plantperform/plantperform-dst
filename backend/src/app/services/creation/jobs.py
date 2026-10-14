"""Save simulation settings; shared transport checks remain for economic jobs."""

import os

from app.domain.creation import CreationQueueUnavailableError
from app.services.optimization.jobs import is_production


def _require_transport(background_tasks, simulation_id=None):
    if is_production() and not os.getenv("OPTIMIZER_QUEUE_URL"):
        raise CreationQueueUnavailableError("Oprettelseskøen er ikke konfigureret.", simulation_id)
    if not is_production() and background_tasks is None:
        raise CreationQueueUnavailableError(
            "Den lokale oprettelse er ikke konfigureret.", simulation_id
        )


def submit(farm_id, request, email, *, background_tasks=None):
    from app.data.simulation_settings_store import create

    return create(farm_id, request, email)


def retry(farm_id, simulation_id, email, *, optimize_on_create=False, background_tasks=None):
    """Recover an old failed creation as editable settings, without another creation job."""
    from app.data.simulation_settings_store import recover_creation

    return recover_creation(farm_id, simulation_id, email)
