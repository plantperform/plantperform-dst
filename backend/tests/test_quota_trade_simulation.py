import unittest
from types import SimpleNamespace
from unittest import mock

from app.domain.field import FieldRecord
from app.domain.optimization import KystvandoplandYearlyNLoadCaps, QuotaTradeSetting
from app.domain.quota_value import (
    QuotaFieldRotation,
    QuotaTradeSimulationRequest,
    QuotaValueCurve,
    QuotaValueOutput,
    QuotaValuePoint,
    QuotaValueResult,
)
from app.domain.rotation_candidate import RotationCandidateRef
from app.domain.simulation import KystvandoplandNLoadCap, OptimizationConstraints, Simulation
from app.services.scenario import quota_trade
from app.services.scenario.quota_trade import (
    TradeSimulationConflictError,
    TradeSimulationNotFoundError,
)

KYSTVAND, OTHER = 233, 244


def _field(field_id: str, name: str, imk_id: int | None) -> FieldRecord:
    return FieldRecord(
        id=field_id,
        farm_id="farm",
        imk_id=imk_id,
        name=name,
        area_ha=10,
        db2=0,
        n_load=0,
        leaching=0,
    )


def _rotation(field_id: str) -> QuotaFieldRotation:
    return QuotaFieldRotation(
        field_id=field_id,
        base_ref=RotationCandidateRef(saedskiftevariant="315", variant="4", n_norm_pct="100"),
        start_year=3,
    )


def _result(*, rotations=True, db2=1000.0, outdated=False, status="completed") -> QuotaValueResult:
    point = QuotaValuePoint(
        trade_kg=50,
        status="OPTIMAL",
        db2=db2,
        rotations=[_rotation("a")] if rotations else [],
    )
    return QuotaValueResult(
        kystvand_id=KYSTVAND,
        status=status,
        outdated=outdated,
        output=QuotaValueOutput(
            base_db2=900,
            base_feed_units_by_year={},
            curve=QuotaValueCurve(
                kystvand_id=KYSTVAND, kvote_kg=300, unconstrained_trade_kg=80, points=[point]
            ),
        ),
    )


def _by_opland(result):
    return lambda farm_id, simulation_id, kystvand_id, email: (
        result if kystvand_id == KYSTVAND else None
    )


RUN_ID = "8f6f0a5e-3c58-4a49-a2a0-8c7f3b3b6d1e"


class SettingsTests(unittest.TestCase):
    def test_the_saved_yearly_settings_trade_the_oplands_kvote_at_the_price(self):
        parameters = {
            "expected_revision": 3,
            "run_id": RUN_ID,
            "excluded_afgrodekoder": [1, 2],
            "db2_swing_pct": 15,
            "max_n_load_by_kystvandopland": [
                {"kystvand_id": KYSTVAND, "max_n_load_by_year": {"2027": 300}},
                {"kystvand_id": OTHER, "max_n_load_by_year": {"2027": 100}},
            ],
            "quota_trades": [
                {"kystvand_id": KYSTVAND, "buy_price_kr_per_kg": 90, "sell_price_kr_per_kg": 10},
                {"kystvand_id": OTHER, "buy_price_kr_per_kg": 40, "sell_price_kr_per_kg": 20},
            ],
        }
        settings = quota_trade._settings_with_trade(parameters, KYSTVAND, 35)
        self.assertEqual(settings.kind, "yearly")
        self.assertEqual(settings.excluded_afgrodekoder, [1, 2])
        self.assertEqual(settings.db2_swing_pct, 15)
        # The caps stay as they were; a traded opland is bounded by its kvote.
        self.assertEqual(
            settings.max_n_load_by_kystvandopland,
            [
                KystvandoplandYearlyNLoadCaps(kystvand_id=KYSTVAND, max_n_load_by_year={2027: 300}),
                KystvandoplandYearlyNLoadCaps(kystvand_id=OTHER, max_n_load_by_year={2027: 100}),
            ],
        )
        self.assertEqual(
            settings.quota_trades,
            [
                QuotaTradeSetting(
                    kystvand_id=OTHER, buy_price_kr_per_kg=40, sell_price_kr_per_kg=20
                ),
                QuotaTradeSetting(
                    kystvand_id=KYSTVAND,
                    buy_price_kr_per_kg=35,
                    sell_price_kr_per_kg=35,
                    same_each_year=True,
                ),
            ],
        )


class PointLookupTests(unittest.TestCase):
    def point(self, result, trade_kg=50.0, kystvand_id=KYSTVAND):
        request = QuotaTradeSimulationRequest(
            kystvand_id=kystvand_id, trade_kg=trade_kg, name="Køb 50 kg N/år", price_kr_per_kg=35
        )
        with mock.patch.object(quota_trade, "get_quota_value", side_effect=_by_opland(result)):
            return quota_trade._point("farm", "sim", request, "user@example.com")

    def test_finds_the_point_of_the_requested_trade(self):
        self.assertEqual(self.point(_result()).trade_kg, 50)

    def test_refuses_a_curve_that_cannot_be_used(self):
        cases = {
            "not computed": _result(status="in_progress"),
            "outdated": _result(outdated=True),
            "infeasible": _result(db2=None),
            "without a plan": _result(rotations=False),
        }
        for name, result in cases.items():
            with self.subTest(name), self.assertRaises(TradeSimulationConflictError):
                self.point(result)

    def test_an_unknown_trade_or_opland_is_not_found(self):
        for trade_kg, kystvand_id in ((60.0, KYSTVAND), (50.0, OTHER)):
            with self.subTest(trade_kg=trade_kg), self.assertRaises(TradeSimulationNotFoundError):
                self.point(_result(), trade_kg, kystvand_id)
        with self.assertRaises(TradeSimulationNotFoundError):
            self.point(None)


class CreateTests(unittest.TestCase):
    def test_copies_the_scenario_and_locks_each_copied_mark_to_the_plan(self):
        constraints = OptimizationConstraints(
            max_n_load_by_kystvandopland=[
                KystvandoplandNLoadCap(kystvand_id=KYSTVAND, max_n_load_kg=300)
            ]
        )
        base = Simulation(
            id="sim",
            farm_id="farm",
            name="Scenarie A",
            created_at="2026-10-21",
            constraints=constraints,
            rotation_saedskiftevarianter=["315"],
            rotation_n_norm_procenter=["100"],
        )
        result = _result()
        result.output.curve.points[0].rotations.append(_rotation("gone"))
        # A permanent afgrøde is locked by the run itself, never applied here.
        result.output.curve.points[0].rotations.append(
            QuotaFieldRotation(
                field_id="grass",
                base_ref=RotationCandidateRef(
                    saedskiftevariant="permanent", variant="276", n_norm_pct="100"
                ),
            )
        )
        run = SimpleNamespace(
            parameters={
                "expected_revision": 3,
                "run_id": RUN_ID,
                "max_n_load_by_kystvandopland": [
                    {"kystvand_id": KYSTVAND, "max_n_load_by_year": {"2027": 300}}
                ],
            }
        )
        repository = mock.Mock()
        repository.get_simulation.side_effect = [base, mock.sentinel.created_simulation]
        repository.list_simulation_fields.return_value = [
            _field("a", "Mark 1", 11),
            _field("gone", "Solgt mark", 99),
            _field("grass", "Permanent græs", 77),
        ]
        settings_store = mock.Mock()
        settings_store.create.return_value = SimpleNamespace(id="new")
        # "gone" had no counterpart to copy.
        settings_store.copy_fields.return_value = {"a": "x", "grass": "y"}
        with (
            mock.patch.object(quota_trade, "get_quota_value", side_effect=_by_opland(result)),
            mock.patch.object(quota_trade, "get_result", return_value=run),
            mock.patch.object(quota_trade, "repository", repository),
            mock.patch.object(quota_trade, "simulation_settings_store", settings_store),
            mock.patch.object(quota_trade, "QuotaTradeSimulationResponse") as response,
            mock.patch.object(quota_trade, "apply_manual_rotation", return_value=object()) as apply,
        ):
            quota_trade.create_trade_simulation(
                "farm",
                "sim",
                QuotaTradeSimulationRequest(
                    kystvand_id=KYSTVAND, trade_kg=50, name="Køb 50", price_kr_per_kg=35
                ),
                "user@example.com",
            )
        request = settings_store.create.call_args.args[1]
        self.assertEqual(request.name, "Køb 50")
        self.assertEqual(request.saedskiftevarianter, ["315"])
        self.assertFalse(request.optimize_on_create)
        self.assertEqual(request.constraints, constraints)
        self.assertEqual(request.optimization_settings.kind, "yearly")
        [trade] = request.optimization_settings.quota_trades
        self.assertEqual(
            (trade.kystvand_id, trade.buy_price_kr_per_kg, trade.sell_price_kr_per_kg),
            (KYSTVAND, 35, 35),
        )
        self.assertTrue(trade.same_each_year)
        settings_store.copy_fields.assert_called_once_with("farm", "new", "sim", "user@example.com")
        apply.assert_called_once()
        self.assertEqual(apply.call_args.args[:3], ("farm", "new", "x"))
        self.assertEqual(apply.call_args.args[6], 3)
        kwargs = response.call_args.kwargs
        self.assertIs(kwargs["simulation"], mock.sentinel.created_simulation)
        self.assertEqual(kwargs["unmatched_fields"], ["Solgt mark"])


if __name__ == "__main__":
    unittest.main()
