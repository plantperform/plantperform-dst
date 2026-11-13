"""Create one point of a kvote value curve as its own simulering ("Opret som simulering").

The new simulering copies the settings of the one the curve was computed for,
and its saved Års-optimering settings add a kvotehandel for the traded opland:
the same amount bought or sold every year, at the price the trade was chosen
at. It starts from the same marker and their captured context, and every mark
is locked to the rotation the point's plan gives it, through the same path as
"Rediger manuelt". A normal Års-optimering on it then reproduces the plan and
its trade and shows them like any other simulering.
"""

from app.data import repository, simulation_settings_store
from app.data.quota_value_store import get_quota_value
from app.data.simulation_store import SetupRevisionConflictError, get_result
from app.domain.optimization import QuotaTradeSetting, YearlyOptimizeSimulationRequest
from app.domain.quota_value import (
    QuotaTradeSimulationRequest,
    QuotaTradeSimulationResponse,
    QuotaValuePoint,
)
from app.domain.simulation import CreateSimulationRequest, OptimizationSettings, Simulation
from app.services.scenario.rotations import ManualRotationNotFoundError, apply_manual_rotation

# Trades are stored as floats; a point is the one within this many kg.
TRADE_TOLERANCE_KG = 1e-6
# The rotation of a mark whose latest real afgrøde is permanent (ikke-omdrift).
PERMANENT = "permanent"


class TradeSimulationNotFoundError(Exception):
    pass


class TradeSimulationConflictError(Exception):
    """The curve cannot be used as it stands; the message says why, in Danish."""


def _point(farm_id, simulation_id, request, email) -> QuotaValuePoint:
    result = get_quota_value(farm_id, simulation_id, request.kystvand_id, email)
    if result is None:
        raise TradeSimulationNotFoundError
    if result.status != "completed" or result.output is None:
        raise TradeSimulationConflictError("Kvotehandel er ikke beregnet for oplandet.")
    if result.outdated:
        raise TradeSimulationConflictError(
            "Simuleringen eller optimeringen er ændret siden kvotehandlen blev beregnet. "
            "Beregn kurven igen."
        )
    point = next(
        (
            p
            for p in result.output.curve.points
            if abs(p.trade_kg - request.trade_kg) <= TRADE_TOLERANCE_KG
        ),
        None,
    )
    if point is None:
        raise TradeSimulationNotFoundError
    if point.db2 is None or not point.rotations:
        raise TradeSimulationConflictError("Handlen har ingen løsning, der kan oprettes.")
    return point


def _settings_with_trade(
    parameters: dict, kystvand_id: int, price_kr_per_kg: float
) -> OptimizationSettings:
    """The curve's own Års-optimering settings, trading the opland's kvote at the price."""
    run = YearlyOptimizeSimulationRequest.model_validate(parameters)
    trades = [trade for trade in run.quota_trades if trade.kystvand_id != kystvand_id]
    return OptimizationSettings(
        kind="yearly",
        excluded_afgrodekoder=run.excluded_afgrodekoder,
        max_n_load_by_kystvandopland=run.max_n_load_by_kystvandopland,
        db2_swing_pct=run.db2_swing_pct,
        quota_trades=[
            *trades,
            QuotaTradeSetting(
                kystvand_id=kystvand_id,
                buy_price_kr_per_kg=price_kr_per_kg,
                sell_price_kr_per_kg=price_kr_per_kg,
                same_each_year=True,
            ),
        ],
    )


def create_trade_simulation(
    farm_id: str, simulation_id: str, request: QuotaTradeSimulationRequest, email: str
) -> QuotaTradeSimulationResponse:
    point = _point(farm_id, simulation_id, request, email)
    base: Simulation | None = repository.get_simulation(farm_id, simulation_id, email)
    run = get_result(farm_id, simulation_id, email, include_output=False)
    base_fields = repository.list_simulation_fields(farm_id, simulation_id, email)
    if base is None or run is None or base_fields is None:
        raise TradeSimulationNotFoundError

    created = simulation_settings_store.create(
        farm_id,
        CreateSimulationRequest.model_validate(
            {
                **base.model_dump(mode="json"),
                "saedskiftevarianter": base.rotation_saedskiftevarianter,
                "n_norm_procenter": base.rotation_n_norm_procenter,
                "name": request.name,
                "optimization_settings": _settings_with_trade(
                    run.parameters, request.kystvand_id, request.price_kr_per_kg
                ).model_dump(mode="json"),
                "economics_module_id": base.economics_module_id,
                "request_id": None,
                "optimize_on_create": False,
            }
        ),
        email,
    )
    if created is None:
        raise TradeSimulationNotFoundError
    ids = simulation_settings_store.copy_fields(farm_id, created.id, simulation_id, email)
    if ids is None:
        raise TradeSimulationNotFoundError

    names = {f.id: f.name for f in base_fields}
    unmatched = []
    for rotation in point.rotations:
        if rotation.base_ref.saedskiftevariant == PERMANENT:
            # A mark with a permanent afgrøde keeps it in every plan. It has no
            # library rotation to apply, and the run locks it to its afgrøde.
            continue
        target = ids.get(rotation.field_id)
        applied = None
        if target is not None:
            try:
                applied = apply_manual_rotation(
                    farm_id,
                    created.id,
                    target,
                    rotation.base_ref,
                    rotation.overrides,
                    email,
                    rotation.start_year,
                )
            except (ManualRotationNotFoundError, SetupRevisionConflictError):
                applied = None
        if applied is None:
            unmatched.append(names.get(rotation.field_id, rotation.field_id))

    simulation = repository.get_simulation(farm_id, created.id, email) or created
    return QuotaTradeSimulationResponse(simulation=simulation, unmatched_fields=unmatched)
