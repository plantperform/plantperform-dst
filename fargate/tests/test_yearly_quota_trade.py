import unittest

from app.domain.optimization import NUM_YEARS
from plantperform_fargate.models import (
    FixedYearlyFieldContribution,
    QuotaTradeInput,
    YearlyConstraintsInput,
    YearlyFieldInput,
    YearlyOptimizationInput,
    YearlyRotationOption,
)
from plantperform_fargate.yearly_engine import solve_yearly

# "high" earns 1,000 kr more per year than "low" and lets out 100 kg N more.
HIGH = ("high", 2_000.0, 150.0)
LOW = ("low", 1_000.0, 50.0)


def _option(key: str, db2: float, n_load: float) -> YearlyRotationOption:
    return YearlyRotationOption(
        key=key,
        id=key,
        candidate=None,
        years=(),
        db2_by_year=(db2,) * NUM_YEARS,
        n_load_by_year=(n_load,) * NUM_YEARS,
        leaching_by_year=(n_load,) * NUM_YEARS,
        fen=0.0,
        fen_by_year=(0.0,) * NUM_YEARS,
    )


def _field(field_id: str, kystvand_id: int, kvotegivende: bool = True) -> YearlyFieldInput:
    return YearlyFieldInput(
        id=field_id,
        area_ha=10,
        kystvand_id=kystvand_id,
        options=(_option(*HIGH), _option(*LOW)),
        kvotegivende=kvotegivende,
    )


def _locked(kystvand_id: int, n_load: float) -> FixedYearlyFieldContribution:
    return FixedYearlyFieldContribution(
        kystvand_id=kystvand_id,
        db2_by_year=(0.0,) * NUM_YEARS,
        n_load_by_year=(n_load,) * NUM_YEARS,
        leaching_by_year=(n_load,) * NUM_YEARS,
        fen=0.0,
        fen_by_year=(0.0,) * NUM_YEARS,
    )


def _solve(
    fields: tuple[YearlyFieldInput, ...],
    caps: dict[int, tuple[float | None, ...]],
    trades: tuple[QuotaTradeInput, ...] = (),
    fixed: tuple[FixedYearlyFieldContribution, ...] = (),
):
    return solve_yearly(
        YearlyOptimizationInput(
            fields=fields,
            fixed_fields=fixed,
            constraints=YearlyConstraintsInput(
                max_n_load_by_kystvandopland_and_year=caps,
                db2_swing_pct=None,
                min_fen=None,
                max_fen=None,
                quota_trades=trades,
            ),
            time_limit_seconds=5,
        )
    )


def _chosen(output) -> dict[str, str]:
    return {a.field_id: a.rotation_id for a in output.assignments}


def _trades(output) -> dict[int, tuple[int, float]]:
    """Each opland's trade, the same in every year, and its payment per year."""
    trades = {}
    for t in output.quota_trades:
        assert t.same_each_year and len(set(t.trade_kg_by_year)) == 1, t
        trades[t.kystvand_id] = (t.trade_kg_by_year[0], t.payment_kr_per_year)
    return trades


def _yearly_trades(output) -> dict[int, tuple[tuple[int, ...], float]]:
    return {t.kystvand_id: (t.trade_kg_by_year, t.payment_kr_per_year) for t in output.quota_trades}


CAP_100 = (100.0,) * NUM_YEARS


class YearlyQuotaTradeTests(unittest.TestCase):
    def test_without_trade_the_cap_holds(self) -> None:
        output = _solve((_field("a", 1),), {1: CAP_100})
        self.assertEqual(_chosen(output), {"a": "low"})
        self.assertEqual(output.quota_trades, ())

    def test_buys_when_the_extra_db2_is_worth_more_than_the_kvote(self) -> None:
        # high: 2,000 - 8 * 50 = 1,600 per year; low and selling 50 kg: 1,400.
        output = _solve((_field("a", 1),), {1: CAP_100}, (QuotaTradeInput(1, 8),))
        self.assertEqual(_chosen(output), {"a": "high"})
        self.assertEqual(_trades(output), {1: (50, 400.0)})
        # total_db2 stays the crops' DB2 per year, without the payment.
        self.assertEqual(output.total_db2, 2_000)

    def test_sells_unused_kvote_when_the_price_is_high(self) -> None:
        # high: 2,000 - 30 * 50 = 500 per year; low and selling 50 kg: 2,500.
        output = _solve((_field("a", 1),), {1: CAP_100}, (QuotaTradeInput(1, 30),))
        self.assertEqual(_chosen(output), {"a": "low"})
        self.assertEqual(_trades(output), {1: (-50, -1_500.0)})

    def test_one_trade_moves_caps_that_differ_by_year(self) -> None:
        # The 60 kg year decides: high needs 90 kg more in every year.
        caps = (100.0, 60.0) + (100.0,) * (NUM_YEARS - 2)
        output = _solve((_field("a", 1),), {1: caps}, (QuotaTradeInput(1, 8),))
        self.assertEqual(_chosen(output), {"a": "high"})
        self.assertEqual(_trades(output), {1: (90, 720.0)})

    def test_selling_stops_at_the_smallest_cap(self) -> None:
        # Nothing is let out, so all of the 40 kg year can be sold, but no more.
        field = YearlyFieldInput(
            id="a", area_ha=10, kystvand_id=1, options=(_option("none", 0.0, 0.0),)
        )
        caps = (100.0, 40.0) + (100.0,) * (NUM_YEARS - 2)
        output = _solve((field,), {1: caps}, (QuotaTradeInput(1, 5),))
        self.assertEqual(_trades(output), {1: (-40, -200.0)})

    def test_each_opland_trades_at_its_own_price(self) -> None:
        output = _solve(
            (_field("a", 1), _field("b", 2)),
            {1: CAP_100, 2: CAP_100},
            (QuotaTradeInput(1, 8), QuotaTradeInput(2, 30)),
        )
        self.assertEqual(_chosen(output), {"a": "high", "b": "low"})
        self.assertEqual(_trades(output), {1: (50, 400.0), 2: (-50, -1_500.0)})

    def test_an_untraded_opland_keeps_its_cap(self) -> None:
        output = _solve(
            (_field("a", 1), _field("b", 2)),
            {1: CAP_100, 2: CAP_100},
            (QuotaTradeInput(1, 8),),
        )
        self.assertEqual(_chosen(output), {"a": "high", "b": "low"})
        self.assertEqual(set(_trades(output)), {1})

    def test_locked_marker_count_toward_the_kvote_needed(self) -> None:
        # The locked mark lets out 80 kg, so high needs 130 kg more.
        output = _solve(
            (_field("a", 1),), {1: CAP_100}, (QuotaTradeInput(1, 1),), (_locked(1, 80.0),)
        )
        self.assertEqual(_chosen(output), {"a": "high"})
        self.assertEqual(_trades(output), {1: (130, 130.0)})

    def test_a_free_kvote_is_reported_as_the_smallest_trade_the_plan_needs(self) -> None:
        output = _solve((_field("a", 1),), {1: CAP_100}, (QuotaTradeInput(1, 0),))
        self.assertEqual(_chosen(output), {"a": "high"})
        self.assertEqual(_trades(output), {1: (50, 0.0)})

    def test_a_trade_by_year_buys_only_what_each_year_needs(self) -> None:
        # high needs 90 kg more in the 60 kg year and 50 kg in the others.
        caps = (100.0, 60.0) + (100.0,) * (NUM_YEARS - 2)
        output = _solve(
            (_field("a", 1),), {1: caps}, (QuotaTradeInput(1, 8, same_each_year=False),)
        )
        self.assertEqual(_chosen(output), {"a": "high"})
        # 8 kr for 7 * 50 + 90 kg over 8 years: 440 kr per year, not 720.
        self.assertEqual(_yearly_trades(output), {1: ((50, 90) + (50,) * (NUM_YEARS - 2), 440.0)})
        self.assertFalse(output.quota_trades[0].same_each_year)

    def test_a_trade_by_year_sells_what_each_year_does_not_use(self) -> None:
        # Nothing is let out, so each year's whole cap is sold.
        field = YearlyFieldInput(
            id="a", area_ha=10, kystvand_id=1, options=(_option("none", 0.0, 0.0),)
        )
        caps = (100.0, 40.0) + (100.0,) * (NUM_YEARS - 2)
        output = _solve((field,), {1: caps}, (QuotaTradeInput(1, 5, same_each_year=False),))
        self.assertEqual(
            _yearly_trades(output),
            {1: ((-100, -40) + (-100,) * (NUM_YEARS - 2), -5 * (100 * 7 + 40) / NUM_YEARS)},
        )

    def test_an_opland_without_a_cap_in_every_year_cannot_trade(self) -> None:
        caps = (None,) + (100.0,) * (NUM_YEARS - 1)
        with self.assertRaises(ValueError):
            _solve((_field("a", 1),), {1: caps}, (QuotaTradeInput(1, 8),))
        with self.assertRaises(ValueError):
            _solve((_field("a", 1),), {}, (QuotaTradeInput(1, 8),))

    def test_an_opland_without_kvotegivende_marker_cannot_trade(self) -> None:
        with self.assertRaises(ValueError):
            _solve((_field("a", 1, kvotegivende=False),), {1: CAP_100}, (QuotaTradeInput(1, 8),))


if __name__ == "__main__":
    unittest.main()
