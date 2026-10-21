import unittest

from pydantic import ValidationError

from app.domain.quota_value import MAX_RANGE_TRADES, QuotaTradeRange, QuotaValueRequest


class QuotaTradeRangeTests(unittest.TestCase):
    def test_trades_line_up_with_no_trade_and_keep_both_ends(self):
        self.assertEqual(
            QuotaTradeRange(min_kg=-100, max_kg=150, step_kg=50).trades(),
            [-100, -50, 50, 100, 150],
        )
        self.assertEqual(
            QuotaTradeRange(min_kg=-45, max_kg=50, step_kg=20).trades(),
            [-45, -40, -20, 20, 40, 50],
        )

    def test_a_range_on_one_side_of_no_trade(self):
        self.assertEqual(
            QuotaTradeRange(min_kg=30, max_kg=90, step_kg=25).trades(), [30, 50, 75, 90]
        )

    def test_rejects_an_empty_or_reversed_range(self):
        with self.assertRaises(ValidationError):
            QuotaTradeRange(min_kg=50, max_kg=50, step_kg=10)
        with self.assertRaises(ValidationError):
            QuotaTradeRange(min_kg=50, max_kg=-50, step_kg=10)

    def test_rejects_more_trades_than_one_job_can_solve(self):
        QuotaTradeRange(min_kg=-200, max_kg=200, step_kg=10)
        with self.assertRaises(ValidationError):
            QuotaTradeRange(min_kg=-200, max_kg=210, step_kg=10)
        with self.assertRaises(ValidationError):
            QuotaTradeRange(min_kg=0, max_kg=100_000, step_kg=0.001)
        self.assertEqual(MAX_RANGE_TRADES, 40)

    def test_the_request_reads_the_frontend_names(self):
        request = QuotaValueRequest.model_validate(
            {
                "expectedRevision": 1,
                "runId": "8f6f0a5e-3c58-4a49-a2a0-8c7f3b3b6d1e",
                "priceKrPerKg": 35,
                "tradeRange": {"minKg": -100, "maxKg": 150, "stepKg": 50},
            }
        )
        self.assertEqual(request.trade_range.step_kg, 50)


if __name__ == "__main__":
    unittest.main()
