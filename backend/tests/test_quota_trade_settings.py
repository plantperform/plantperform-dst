import unittest

from pydantic import ValidationError

from app.domain.optimization import (
    NUM_YEARS,
    OptimizationSettings,
    SimulationQuotaTrade,
    YearlyOptimizeSimulationRequest,
    untradable_quota_reason,
)

ALL_YEARS = {str(2027 + i): 100 for i in range(NUM_YEARS)}


def trade(kystvand_id=1, buy=35, sell=30, **values):
    return {
        "kystvand_id": kystvand_id,
        "buy_price_kr_per_kg": buy,
        "sell_price_kr_per_kg": sell,
        **values,
    }


def settings(caps=None, trades=None):
    return OptimizationSettings.model_validate(
        {
            "kind": "yearly",
            "max_n_load_by_kystvandopland": caps or [],
            "quota_trades": trades or [],
        }
    )


class QuotaTradeSettingsTests(unittest.TestCase):
    def test_kvotehandel_is_off_by_default(self):
        self.assertEqual(OptimizationSettings().quota_trades, [])

    def test_an_opland_left_at_its_kvote_can_trade(self):
        [saved] = settings(trades=[trade(buy=35.5, sell=30)]).quota_trades
        self.assertEqual((saved.buy_price_kr_per_kg, saved.sell_price_kr_per_kg), (35.5, 30))

    def test_a_trade_is_the_same_each_year_unless_saved_otherwise(self):
        same = settings(trades=[trade()])
        by_year = settings(
            trades=[
                {
                    "kystvandId": 1,
                    "buyPriceKrPerKg": 35,
                    "sellPriceKrPerKg": 30,
                    "sameEachYear": False,
                }
            ]
        )
        self.assertTrue(same.quota_trades[0].same_each_year)
        self.assertFalse(by_year.quota_trades[0].same_each_year)

    def test_a_trade_saved_with_one_price_buys_and_sells_at_it(self):
        for saved in (
            {"kystvand_id": 1, "price_kr_per_kg": 35},
            {"kystvandId": 1, "priceKrPerKg": 35},
        ):
            with self.subTest(saved=saved):
                [read] = settings(trades=[saved]).quota_trades
                self.assertEqual((read.buy_price_kr_per_kg, read.sell_price_kr_per_kg), (35, 35))
        result = SimulationQuotaTrade.model_validate(
            {
                "kystvand_id": 1,
                "trade_kg_by_year": {2027: 50},
                "price_kr_per_kg": 35,
                "same_each_year": True,
                "payment_kr_per_year": 1_750,
            }
        )
        self.assertEqual((result.buy_price_kr_per_kg, result.sell_price_kr_per_kg), (35, 35))

    def test_kvote_cannot_sell_above_its_buy_price(self):
        settings(trades=[trade(buy=30, sell=30)])
        with self.assertRaisesRegex(ValidationError, "Salgsprisen"):
            settings(trades=[trade(buy=30, sell=35)])

    def test_an_opland_can_trade_whatever_its_caps_under_graenser(self):
        years = dict(list(ALL_YEARS.items())[1:])
        for caps in (ALL_YEARS, years):
            with self.subTest(caps=caps):
                settings([{"kystvand_id": 1, "max_n_load_by_year": caps}], [trade()])

    def test_an_opland_trades_once(self):
        with self.assertRaisesRegex(ValidationError, "én kvotehandel"):
            settings(trades=[trade(), trade()])

    def test_the_prices_are_numbers_of_at_least_0(self):
        for price in (-1, float("inf")):
            for prices in ({"buy": price}, {"sell": price}):
                with self.subTest(prices=prices), self.assertRaises(ValidationError):
                    settings(trades=[trade(**prices)])

    def test_a_yearly_run_takes_the_trades_from_the_saved_settings(self):
        saved = settings(trades=[trade()])
        request = YearlyOptimizeSimulationRequest.model_validate(
            {
                **saved.model_dump(mode="json"),
                "run_id": "00000000-0000-0000-0000-000000000001",
                "expected_revision": 0,
            }
        )
        self.assertEqual(request.quota_trades, saved.quota_trades)

    def test_an_opland_without_kvotegivende_marker_cannot_trade(self):
        self.assertEqual(untradable_quota_reason(False), "Ingen kvotegivende marker")
        self.assertIsNone(untradable_quota_reason(True))


if __name__ == "__main__":
    unittest.main()
