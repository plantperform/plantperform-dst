"""Reserve and complete explicit economics recalculation during the request."""

from app.data import creation_store, simulation_store
from app.data import economics_recalculation_store as store
from app.domain.creation import CreationActiveError
from app.domain.economics import EconomicsConflictError
from app.services.calculation import CalculationContext
from app.services.economics import runner


def _calculate(action, farm_id, simulation_id, email, request=None):
    context = CalculationContext()
    try:
        with creation_store.execution_session(simulation_id) as session:
            args = (
                (farm_id, simulation_id, request, email)
                if request is not None
                else (farm_id, simulation_id, email)
            )
            identifier, job = action(*args, execution_session=session)
            if identifier is None:
                return None
            if job is not None:
                runner.execute(job, context, execution_session=session)
            with session.begin():
                # Capture the completed response before another calculation can reserve it.
                return simulation_store._get_simulation(session, farm_id, simulation_id, email)
    except CreationActiveError as error:
        raise EconomicsConflictError("Recalculation is still running") from error


def submit(farm_id, simulation_id, request, email):
    return _calculate(store.submit, farm_id, simulation_id, email, request)


def retry(farm_id, simulation_id, email):
    return _calculate(store.retry, farm_id, simulation_id, email)
