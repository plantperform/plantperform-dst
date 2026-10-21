"""Create one point of a kvote value curve as its own simulering ("Opret som simulering").

The new simulering copies the settings of the one the curve was computed for,
with the traded opland's cap changed by the trade, both in its rules and in
its saved Års-optimering settings. It starts from the same marker and their
captured context, and every mark is locked to the rotation the point's plan
gives it, through the same path as "Rediger manuelt". A normal Års-optimering
on it then reproduces the plan and shows it like any other simulering.
"""

from app.data import repository, simulation_settings_store
from app.data.quota_value_store import get_quota_value
from app.data.simulation_store import SetupRevisionConflictError, get_result
from app.domain.optimization import KystvandoplandYearlyNLoadCaps, YearlyOptimizeSimulationRequest
from app.domain.quota_value import (
    QuotaTradeSimulationRequest,
    QuotaTradeSimulationResponse,
    QuotaValueCurve,
    QuotaValuePoint,
)
from app.domain.simulation import (
    CreateSimulationRequest,
    OptimizationConstraints,
    OptimizationSettings,
    Simulation,
    SimulationQuotaTrade,
)
from app.services.scenario.rotations import ManualRotationNotFoundError, apply_manual_rotation

# Trades are stored as floats; a point is the one within this many kg.
TRADE_TOLERANCE_KG = 1e-6
# The rotation of a mark whose latest real afgrøde is permanent (ikke-omdrift).
PERMANENT = "permanent"


class TradeSimulationNotFoundError(Exception):
    pass


class TradeSimulationConflictError(Exception):
    """The curve cannot be used as it stands; the message says why, in Danish."""


def _point(farm_id, simulation_id, request, email) -> tuple[QuotaValueCurve, QuotaValuePoint]:
    result = get_quota_value(farm_id, simulation_id, email)
    if result is None:
        raise TradeSimulationNotFoundError
    if result.status != "completed" or result.output is None:
        raise TradeSimulationConflictError("Kvotehandel er ikke beregnet for scenariet.")
    if result.outdated:
        raise TradeSimulationConflictError(
            "Scenariet eller optimeringen er ændret siden kvotehandlen blev beregnet. "
            "Beregn kurven igen."
        )
    curve = next((c for c in result.output.curves if c.kystvand_id == request.kystvand_id), None)
    point = (
        next(
            (p for p in curve.points if abs(p.trade_kg - request.trade_kg) <= TRADE_TOLERANCE_KG),
            None,
        )
        if curve
        else None
    )
    if point is None:
        raise TradeSimulationNotFoundError
    if point.db2 is None:
        raise TradeSimulationConflictError("Handlen har ingen løsning, der kan oprettes.")
    if not point.rotations:
        raise TradeSimulationConflictError(
            "Kurven er beregnet med en tidligere udgave. Beregn den igen for at oprette "
            "handlen som simulering."
        )
    return curve, point


def _traded_constraints(
    constraints: OptimizationConstraints, kystvand_id: int, trade_kg: float
) -> OptimizationConstraints:
    caps = [
        cap.model_copy(update={"max_n_load_kg": max(0.0, cap.max_n_load_kg + trade_kg)})
        if cap.kystvand_id == kystvand_id and cap.max_n_load_kg is not None
        else cap
        for cap in constraints.max_n_load_by_kystvandopland
    ]
    return constraints.model_copy(update={"max_n_load_by_kystvandopland": caps})


def _traded_settings(
    parameters: dict, curve: QuotaValueCurve, trade_kg: float
) -> OptimizationSettings:
    """The curve's own Års-optimering settings, with the opland's caps traded.

    The traded opland gets the caps the curve was computed against, changed by
    the trade, explicitly for every capped year: an opland the run left out
    would otherwise fall back to its marker's kvote, untraded.
    """
    run = YearlyOptimizeSimulationRequest.model_validate(parameters)
    traded = KystvandoplandYearlyNLoadCaps(
        kystvand_id=curve.kystvand_id,
        max_n_load_by_year={
            year: max(0.0, cap + trade_kg)
            for year, cap in curve.base_cap_by_year.items()
            if cap is not None
        },
    )
    caps = [cap for cap in run.max_n_load_by_kystvandopland if cap.kystvand_id != curve.kystvand_id]
    return OptimizationSettings(
        kind="yearly",
        excluded_afgrodekoder=run.excluded_afgrodekoder,
        max_n_load_by_kystvandopland=[*caps, traded],
        db2_swing_pct=run.db2_swing_pct,
    )


def create_trade_simulation(
    farm_id: str, simulation_id: str, request: QuotaTradeSimulationRequest, email: str
) -> QuotaTradeSimulationResponse:
    curve, point = _point(farm_id, simulation_id, request, email)
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
                "constraints": _traded_constraints(
                    base.constraints, request.kystvand_id, request.trade_kg
                ).model_dump(mode="json"),
                "optimization_settings": _traded_settings(
                    run.parameters, curve, request.trade_kg
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
    simulation_settings_store.record_quota_trade(
        farm_id,
        created.id,
        SimulationQuotaTrade(
            kystvand_id=request.kystvand_id,
            kystvand_navn=request.kystvand_navn,
            trade_kg=request.trade_kg,
            price_kr_per_kg=request.price_kr_per_kg,
        ),
        email,
    )

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
