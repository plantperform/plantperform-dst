"""Save or recover simulation settings synchronously."""


def submit(farm_id, request, email):
    from app.data.simulation_settings_store import create

    return create(farm_id, request, email)


def retry(farm_id, simulation_id, email, *, optimize_on_create=False):
    """Recover an old failed creation as editable settings, without another creation job."""
    from app.data.simulation_settings_store import recover_creation

    return recover_creation(farm_id, simulation_id, email)
