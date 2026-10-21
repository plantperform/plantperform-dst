import unittest
from types import SimpleNamespace
from unittest import mock

from app.domain.field import FieldRecord
from app.domain.optimization import KystvandoplandYearlyNLoadCaps
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
        status=status,
        outdated=outdated,
        output=QuotaValueOutput(
            base_db2=900,
            base_feed_units_by_year={},
            curves=[
                QuotaValueCurve(
                    kystvand_id=KYSTVAND,
                    base_cap_by_year={2027: 300},
                    unconstrained_trade_kg=80,
                    points=[point],
                )
            ],
        ),
    )


class TradedSettingsTests(unittest.TestCase):
    def test_only_the_traded_oplands_rule_cap_changes(self):
        constraints = OptimizationConstraints(
            max_n_load_by_kystvandopland=[
                KystvandoplandNLoadCap(kystvand_id=KYSTVAND, max_n_load_kg=300),
                KystvandoplandNLoadCap(kystvand_id=OTHER, max_n_load_kg=200),
                KystvandoplandNLoadCap(kystvand_id=None, max_n_load_kg=None),
            ],
            min_fen=10,
        )
        traded = quota_trade._traded_constraints(constraints, KYSTVAND, -50)
        caps = {c.kystvand_id: c.max_n_load_kg for c in traded.max_n_load_by_kystvandopland}
        self.assertEqual(caps, {KYSTVAND: 250, OTHER: 200, None: None})
        self.assertEqual(traded.min_fen, 10)
        # Selling more than the cap leaves an empty cap, not a negative one.
        emptied = quota_trade._traded_constraints(constraints, KYSTVAND, -400)
        self.assertEqual(emptied.max_n_load_by_kystvandopland[0].max_n_load_kg, 0)

    def test_the_saved_yearly_settings_are_the_curves_with_every_year_traded(self):
        parameters = {
            "expected_revision": 3,
            "run_id": "8f6f0a5e-3c58-4a49-a2a0-8c7f3b3b6d1e",
            "excluded_afgrodekoder": [1, 2],
            "db2_swing_pct": 15,
            "max_n_load_by_kystvandopland": [
                {"kystvand_id": KYSTVAND, "max_n_load_by_year": {"2027": 300, "2028": 280}},
                {"kystvand_id": OTHER, "max_n_load_by_year": {"2027": 100}},
            ],
        }
        curve = (
            _result()
            .output.curves[0]
            .model_copy(update={"base_cap_by_year": {2027: 300, 2028: 280, 2029: None}})
        )
        settings = quota_trade._traded_settings(parameters, curve, 53)
        self.assertEqual(settings.kind, "yearly")
        self.assertEqual(settings.excluded_afgrodekoder, [1, 2])
        self.assertEqual(settings.db2_swing_pct, 15)
        self.assertEqual(
            settings.max_n_load_by_kystvandopland,
            [
                KystvandoplandYearlyNLoadCaps(kystvand_id=OTHER, max_n_load_by_year={2027: 100}),
                KystvandoplandYearlyNLoadCaps(
                    kystvand_id=KYSTVAND, max_n_load_by_year={2027: 353, 2028: 333}
                ),
            ],
        )

    def test_an_opland_the_run_left_to_its_kvote_gets_the_traded_cap_explicitly(self):
        # Without a cap of its own the opland was capped by its marker's kvote,
        # which the curve recorded; the trade changes exactly that.
        parameters = {"expected_revision": 3, "run_id": "8f6f0a5e-3c58-4a49-a2a0-8c7f3b3b6d1e"}
        curve = _result().output.curves[0].model_copy(update={"base_cap_by_year": {2027: 20}})
        settings = quota_trade._traded_settings(parameters, curve, -5)
        self.assertEqual(
            settings.max_n_load_by_kystvandopland,
            [KystvandoplandYearlyNLoadCaps(kystvand_id=KYSTVAND, max_n_load_by_year={2027: 15})],
        )


class PointLookupTests(unittest.TestCase):
    def point(self, result, trade_kg=50.0, kystvand_id=KYSTVAND):
        request = QuotaTradeSimulationRequest(
            kystvand_id=kystvand_id, trade_kg=trade_kg, name="Køb 50 kg N/år", price_kr_per_kg=35
        )
        with mock.patch.object(quota_trade, "get_quota_value", return_value=result):
            return quota_trade._point("farm", "sim", request, "user@example.com")

    def test_finds_the_point_of_the_requested_trade(self):
        curve, point = self.point(_result())
        self.assertEqual((curve.kystvand_id, point.trade_kg), (KYSTVAND, 50))

    def test_refuses_a_curve_that_cannot_be_used(self):
        cases = {
            "not computed": _result(status="in_progress"),
            "outdated": _result(outdated=True),
            "infeasible": _result(db2=None),
            "computed before rotations were stored": _result(rotations=False),
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
        base = Simulation(
            id="sim",
            farm_id="farm",
            name="Scenarie A",
            created_at="2026-10-21",
            constraints=OptimizationConstraints(
                max_n_load_by_kystvandopland=[
                    KystvandoplandNLoadCap(kystvand_id=KYSTVAND, max_n_load_kg=300)
                ]
            ),
            rotation_saedskiftevarianter=["315"],
            rotation_n_norm_procenter=["100"],
        )
        result = _result()
        result.output.curves[0].points[0].rotations.append(_rotation("gone"))
        # A permanent afgrøde is locked by the run itself, never applied here.
        result.output.curves[0].points[0].rotations.append(
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
                "run_id": "8f6f0a5e-3c58-4a49-a2a0-8c7f3b3b6d1e",
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
            mock.patch.object(quota_trade, "get_quota_value", return_value=result),
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
                    kystvand_id=KYSTVAND,
                    trade_kg=50,
                    name="Køb 50",
                    price_kr_per_kg=35,
                    kystvand_navn="Lillebælt",
                ),
                "user@example.com",
            )
        trade = settings_store.record_quota_trade.call_args.args[2]
        self.assertEqual(settings_store.record_quota_trade.call_args.args[:2], ("farm", "new"))
        self.assertEqual(
            (trade.kystvand_id, trade.kystvand_navn, trade.trade_kg, trade.price_kr_per_kg),
            (KYSTVAND, "Lillebælt", 50, 35),
        )
        request = settings_store.create.call_args.args[1]
        self.assertEqual(request.name, "Køb 50")
        self.assertEqual(request.saedskiftevarianter, ["315"])
        self.assertFalse(request.optimize_on_create)
        self.assertEqual(request.constraints.max_n_load_by_kystvandopland[0].max_n_load_kg, 350)
        self.assertEqual(request.optimization_settings.kind, "yearly")
        self.assertEqual(
            request.optimization_settings.max_n_load_by_kystvandopland[0].max_n_load_by_year,
            {2027: 350},
        )
        settings_store.copy_fields.assert_called_once_with("farm", "new", "sim", "user@example.com")
        apply.assert_called_once()
        self.assertEqual(apply.call_args.args[:3], ("farm", "new", "x"))
        self.assertEqual(apply.call_args.args[6], 3)
        kwargs = response.call_args.kwargs
        self.assertIs(kwargs["simulation"], mock.sentinel.created_simulation)
        self.assertEqual(kwargs["unmatched_fields"], ["Solgt mark"])


if __name__ == "__main__":
    unittest.main()
