import unittest

from pydantic import ValidationError

from app.domain.optimization import (
    NUM_YEARS,
    KystvandoplandYearlyNLoadCaps,
    OptimizationSettings,
    YearlyOptimizeSimulationRequest,
    untradable_quota_reason,
)

ALL_YEARS = {str(2027 + i): 100 for i in range(NUM_YEARS)}


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
        saved = settings(trades=[{"kystvand_id": 1, "price_kr_per_kg": 35.5}])
        self.assertEqual(saved.quota_trades[0].price_kr_per_kg, 35.5)

    def test_an_opland_with_a_cap_in_every_year_can_trade(self):
        caps = [{"kystvand_id": 1, "max_n_load_by_year": ALL_YEARS}]
        settings(caps, [{"kystvand_id": 1, "price_kr_per_kg": 35}])

    def test_an_opland_with_a_year_without_a_cap_cannot_trade(self):
        years = dict(list(ALL_YEARS.items())[1:])
        with self.assertRaisesRegex(ValidationError, "alle år"):
            settings(
                [{"kystvand_id": 1, "max_n_load_by_year": years}],
                [{"kystvand_id": 1, "price_kr_per_kg": 35}],
            )

    def test_an_opland_trades_once(self):
        trade = {"kystvand_id": 1, "price_kr_per_kg": 35}
        with self.assertRaisesRegex(ValidationError, "én kvotehandel"):
            settings(trades=[trade, trade])

    def test_the_price_is_a_number_of_at_least_0(self):
        for price in (-1, float("inf")):
            with self.subTest(price=price), self.assertRaises(ValidationError):
                settings(trades=[{"kystvand_id": 1, "price_kr_per_kg": price}])

    def test_a_yearly_run_takes_the_trades_from_the_saved_settings(self):
        saved = settings(trades=[{"kystvand_id": 1, "price_kr_per_kg": 35}])
        request = YearlyOptimizeSimulationRequest.model_validate(
            {
                **saved.model_dump(mode="json"),
                "run_id": "00000000-0000-0000-0000-000000000001",
                "expected_revision": 0,
            }
        )
        self.assertEqual(request.quota_trades, saved.quota_trades)

    def test_an_opland_without_kvotegivende_marker_cannot_trade(self):
        caps = KystvandoplandYearlyNLoadCaps(kystvand_id=1, max_n_load_by_year=ALL_YEARS)
        self.assertEqual(untradable_quota_reason(caps, False), "Ingen kvotegivende marker")
        self.assertIsNone(untradable_quota_reason(caps, True))
        self.assertIsNone(untradable_quota_reason(None, True))


if __name__ == "__main__":
    unittest.main()
