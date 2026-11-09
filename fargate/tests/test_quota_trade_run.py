import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from app.data import optimization_store
from app.domain.field import FieldRecord
from app.domain.optimization import NUM_YEARS, QuotaTradeSetting, SimulationQuotaTrade
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    RotationCandidateYearResult,
    RotationYear,
    SimulationFieldCandidates,
)
from app.domain.simulation import Simulation
from plantperform_fargate import orchestrator, worker
from plantperform_fargate.orchestrator import _validate_quota_trades
from plantperform_fargate.preparation import PreparedSnapshot

NAMES = {1: "Limfjorden"}
TRADE = QuotaTradeSetting(kystvand_id=1, buy_price_kr_per_kg=35, sell_price_kr_per_kg=30)


def _field(kystvand_id, kvotegivende=True):
    return FieldRecord(
        id=str(kystvand_id),
        farm_id="farm",
        name=str(kystvand_id),
        area_ha=1,
        db2=2_000,
        n_load=150,
        leaching=150,
        kystvand_id=kystvand_id,
        kvotegivende=kvotegivende,
        udledningskvote_mark_kgn=100,
    )


def _snapshot(catchments=(1,)):
    candidate = RotationCandidateEvaluation(
        ref=RotationCandidateRef(saedskiftevariant="1", variant="1", n_norm_pct="100"),
        active_len=1,
        years=[
            RotationCandidateYearResult(
                year=RotationYear(afgrode_kode=1, afgrode_navn="Test"),
                leaching_kg_n_ha=150,
                leaching_detail={},
                db_kr_ha=2_000,
                db_detail={},
            )
            for _ in range(NUM_YEARS)
        ],
        avg_leaching_kg_n_ha=150,
        avg_db_kr_ha=2_000,
        avg_fen=0,
    )
    fields = [
        _field(catchment).model_copy(
            update={
                "rotation_id": candidate.ref.to_id(),
                "allowed_rotation_ids": [candidate.ref.to_id()],
            }
        )
        for catchment in catchments
    ]
    return PreparedSnapshot(
        simulation=Simulation(
            id="sim", farm_id="farm", name="Test", created_at="2026-11-04", rotation_groups={}
        ),
        fields=fields,
        candidates=[
            SimulationFieldCandidates(field_id=field.id, jbnr=1, candidates=[candidate])
            for field in fields
        ],
        contexts={},
        setup_fields={},
    )


class QuotaTradeInputTests(unittest.TestCase):
    def test_an_opland_without_kvotegivende_marker_is_named(self):
        fields = [_field(1, kvotegivende=False)]

        with self.assertRaisesRegex(
            ValueError, "Kvotehandel er ikke mulig i Limfjorden: ingen kvotegivende marker"
        ):
            _validate_quota_trades(fields, {}, (TRADE,), NAMES)

    def test_an_opland_with_a_year_without_a_cap_is_named(self):
        caps = (None,) + (100.0,) * (NUM_YEARS - 1)

        with self.assertRaisesRegex(ValueError, "kræver en grænse i alle år"):
            _validate_quota_trades([_field(1)], {1: caps}, (TRADE,), NAMES)


class QuotaTradeRunTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(
            patch.object(
                orchestrator.repository,
                "get_farm_udledning_per_kystvandopland",
                return_value=[SimpleNamespace(kystvand_id=1, kystvand_navn="Limfjorden")],
            )
        )

    def run_optimization(self, trades=(TRADE,), caps=None, snapshot=None):
        return orchestrator.run_yearly_optimization(
            "farm",
            "sim",
            5,
            {} if caps is None else caps,
            None,
            frozenset(),
            "test@example.com",
            snapshot=_snapshot() if snapshot is None else snapshot,
            quota_trades=trades,
        )

    def test_default_quota_produces_the_existing_trade_response(self):
        expected = {
            "kystvandId": 1,
            "kystvandNavn": "Limfjorden",
            "tradeKgByYear": {str(2027 + y): 50 for y in range(NUM_YEARS)},
            "buyPriceKrPerKg": 35,
            "sellPriceKrPerKg": 30,
            "sameEachYear": True,
            "paymentKrPerYear": 1_750,
        }

        result = self.run_optimization()

        self.assertEqual(result.quota_trades[0].model_dump(mode="json", by_alias=True), expected)

    def test_selling_earns_the_sell_price(self):
        caps = {1: (200.0,) * NUM_YEARS}

        result = self.run_optimization(caps=caps)

        self.assertEqual(result.quota_trades[0].payment_kr_per_year, -1_500)

    def test_yearly_trades_average_buy_and_sell_payments(self):
        trade = TRADE.model_copy(update={"same_each_year": False})
        caps = {1: (100.0, 200.0) + (100.0,) * (NUM_YEARS - 2)}

        result = self.run_optimization(trades=(trade,), caps=caps)

        self.assertEqual(result.quota_trades[0].payment_kr_per_year, (7 * 1_750 - 1_500) / 8)

    def test_yearly_trade_mode_is_preserved_in_the_response(self):
        trade = TRADE.model_copy(update={"same_each_year": False})

        result = self.run_optimization(trades=(trade,))

        self.assertFalse(result.quota_trades[0].same_each_year)

    def test_each_catchment_uses_its_own_prices(self):
        trades = (
            TRADE,
            QuotaTradeSetting(kystvand_id=2, buy_price_kr_per_kg=8, sell_price_kr_per_kg=5),
        )
        snapshot = _snapshot(catchments=(2, 1))
        caps = {1: (100.0,) * NUM_YEARS, 2: (200.0,) * NUM_YEARS}

        result = self.run_optimization(trades=trades, caps=caps, snapshot=snapshot)

        self.assertEqual(
            {trade.kystvand_id: trade.payment_kr_per_year for trade in result.quota_trades},
            {1: 1_750, 2: -250},
        )

    def test_free_quota_has_no_payment(self):
        trade = QuotaTradeSetting(kystvand_id=1, buy_price_kr_per_kg=0, sell_price_kr_per_kg=0)

        result = self.run_optimization(trades=(trade,))

        self.assertEqual(result.quota_trades[0].payment_kr_per_year, 0)

    def test_crop_db2_excludes_quota_payments(self):
        result = self.run_optimization()

        self.assertEqual(result.output.total_db2, 2_000)


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
                "quotaTrades": [{"kystvandId": 1, "buyPriceKrPerKg": 35, "sellPriceKrPerKg": 30}],
            },
        }
        snapshot = PreparedSnapshot(
            simulation=Simulation(id="sim", farm_id="farm", name="Test", created_at="2026-11-04"),
            fields=[],
            candidates=[],
            contexts={},
            setup_fields={},
            fields_before=[],
        )
        chosen = SimulationQuotaTrade(
            kystvand_id=1,
            kystvand_navn="Limfjorden",
            trade_kg_by_year={2027 + y: -50 for y in range(NUM_YEARS)},
            buy_price_kr_per_kg=35,
            sell_price_kr_per_kg=30,
            same_each_year=True,
            payment_kr_per_year=-1_500,
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
