import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from app.data import optimization_store
from app.domain.optimization import NUM_YEARS, QuotaTradeSetting, SimulationQuotaTrade
from plantperform_fargate import worker
from plantperform_fargate.models import QuotaTradeInput
from plantperform_fargate.orchestrator import _quota_trade_inputs

NAMES = {1: "Limfjorden"}
TRADE = QuotaTradeSetting(kystvand_id=1, price_kr_per_kg=35)


def _field(kystvand_id, kvotegivende=True):
    return SimpleNamespace(kystvand_id=kystvand_id, kvotegivende=kvotegivende)


class QuotaTradeInputTests(unittest.TestCase):
    def test_a_tradable_opland_reaches_the_solver(self):
        inputs = _quota_trade_inputs([_field(1)], {1: (100.0,) * NUM_YEARS}, (TRADE,), NAMES)
        self.assertEqual(inputs, (QuotaTradeInput(kystvand_id=1, price_kr_per_kg=35),))

    def test_a_trade_by_year_reaches_the_solver_as_one(self):
        by_year = TRADE.model_copy(update={"same_each_year": False})
        [trade] = _quota_trade_inputs([_field(1)], {}, (by_year,), NAMES)
        self.assertFalse(trade.same_each_year)

    def test_an_opland_left_at_its_kvote_can_trade(self):
        self.assertEqual(len(_quota_trade_inputs([_field(1)], {}, (TRADE,), NAMES)), 1)

    def test_an_opland_without_kvotegivende_marker_is_named(self):
        with self.assertRaisesRegex(
            ValueError, "Kvotehandel er ikke mulig i Limfjorden: ingen kvotegivende marker"
        ):
            _quota_trade_inputs([_field(1, kvotegivende=False)], {}, (TRADE,), NAMES)

    def test_an_opland_with_a_year_without_a_cap_is_named(self):
        caps = (None,) + (100.0,) * (NUM_YEARS - 1)
        with self.assertRaisesRegex(ValueError, "ikke grænse i alle år"):
            _quota_trade_inputs([_field(1)], {1: caps}, (TRADE,), NAMES)


class QuotaTradeWorkerTests(unittest.TestCase):
    def test_a_yearly_run_passes_the_trades_on_and_stores_the_chosen_ones(self):
        run_id = str(uuid4())
        row = {
            "kind": "yearly",
            "input_revision": 0,
            "requested_by": "test@example.com",
            "attempts": 0,
            "parameters": {
                "expected_revision": 0,
                "run_id": run_id,
                "quotaTrades": [{"kystvandId": 1, "priceKrPerKg": 35}],
            },
        }
        snapshot = MagicMock()
        snapshot.__getitem__.side_effect = lambda index: (
            SimpleNamespace(economics_snapshot=MagicMock()) if index == 0 else []
        )
        snapshot.fields_before = []
        snapshot.setup_fields = {}
        chosen = SimulationQuotaTrade(
            kystvand_id=1,
            kystvand_navn="Limfjorden",
            trade_kg_by_year={2027 + y: -50 for y in range(NUM_YEARS)},
            price_kr_per_kg=35,
            same_each_year=True,
            payment_kr_per_year=-1_750,
        )
        solved = SimpleNamespace(
            output=SimpleNamespace(
                status="OPTIMAL",
                total_db2=1,
                total_n_load_kg=0,
                total_leaching_kg=0,
                total_fen=0,
                assignments=[],
            ),
            fields=[],
            selected_candidates={},
            quota_trades=(chosen,),
        )
        context = SimpleNamespace(get_remaining_time_in_millis=lambda: 70_000)

        with (
            patch.object(optimization_store, "claim", return_value=(row, "farm", "token")),
            patch.object(optimization_store, "load_snapshot", return_value=snapshot),
            patch.object(optimization_store, "finish", return_value=True) as finish,
            patch.object(worker, "prepare", return_value=snapshot),
            patch.object(worker, "hydrate", return_value={}),
            patch.object(worker, "run_yearly_optimization", return_value=solved) as yearly,
        ):
            worker.execute("sim", run_id, context)

        self.assertEqual(yearly.call_args.kwargs["quota_trades"], (TRADE,))
        response = finish.call_args.kwargs["output"]["response"]
        self.assertEqual(response["quota_trades"], [chosen.model_dump(mode="json")])


if __name__ == "__main__":
    unittest.main()
