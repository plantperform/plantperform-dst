import unittest

from app.domain.optimization import NUM_YEARS, QuotaTradeSetting
from plantperform_fargate.models import (
    FixedYearlyFieldContribution,
    YearlyConstraintsInput,
    YearlyFieldInput,
    YearlyOptimizationInput,
    YearlyRotationOption,
)
from plantperform_fargate.yearly_engine import solve_yearly

# "high" earns 1,000 kr more per year than "low" and lets out 100 kg N more.
HIGH = ("high", 2_000.0, 150.0)
LOW = ("low", 1_000.0, 50.0)
# "mid" uses a 100 kg N cap exactly, so it needs no trade.
MID = ("mid", 1_600.0, 100.0)


def _trade(
    kystvand_id: int, buy: float, sell: float | None = None, *, same_each_year: bool = True
) -> QuotaTradeSetting:
    """Kvote bought at buy and sold at sell, which is the buy price unless given."""
    return QuotaTradeSetting(
        kystvand_id=kystvand_id,
        buy_price_kr_per_kg=buy,
        sell_price_kr_per_kg=buy if sell is None else sell,
        same_each_year=same_each_year,
    )


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


def _field(
    field_id: str, kystvand_id: int, kvotegivende: bool = True, options=(HIGH, LOW)
) -> YearlyFieldInput:
    return YearlyFieldInput(
        id=field_id,
        area_ha=10,
        kystvand_id=kystvand_id,
        options=tuple(_option(*option) for option in options),
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
    trades: tuple[QuotaTradeSetting, ...] = (),
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


CAP_100 = (100.0,) * NUM_YEARS


class YearlyQuotaTradeTests(unittest.TestCase):
    def test_without_trade_the_cap_holds(self) -> None:
        output = _solve((_field("a", 1),), {1: CAP_100})
        self.assertEqual(_chosen(output), {"a": "low"})
        self.assertEqual(output.quota_trades, {})

    def test_buys_when_the_extra_db2_is_worth_more_than_the_kvote(self) -> None:
        # high: 2,000 - 8 * 50 = 1,600 per year; low and selling 50 kg: 1,400.
        output = _solve((_field("a", 1),), {1: CAP_100}, (_trade(1, 8),))
        self.assertEqual(_chosen(output), {"a": "high"})
        self.assertEqual(output.quota_trades, {1: (50,) * NUM_YEARS})
        # total_db2 stays the crops' DB2 per year, without the payment.
        self.assertEqual(output.total_db2, 2_000)

    def test_sells_unused_kvote_when_the_price_is_high(self) -> None:
        # high: 2,000 - 30 * 50 = 500 per year; low and selling 50 kg: 2,500.
        output = _solve((_field("a", 1),), {1: CAP_100}, (_trade(1, 30),))
        self.assertEqual(_chosen(output), {"a": "low"})
        self.assertEqual(output.quota_trades, {1: (-50,) * NUM_YEARS})

    def test_one_trade_moves_caps_that_differ_by_year(self) -> None:
        # The 60 kg year decides: high needs 90 kg more in every year.
        caps = (100.0, 60.0) + (100.0,) * (NUM_YEARS - 2)
        output = _solve((_field("a", 1),), {1: caps}, (_trade(1, 8),))
        self.assertEqual(_chosen(output), {"a": "high"})
        self.assertEqual(output.quota_trades, {1: (90,) * NUM_YEARS})

    def test_selling_stops_at_the_smallest_cap(self) -> None:
        # Nothing is let out, so all of the 40 kg year can be sold, but no more.
        field = YearlyFieldInput(
            id="a", area_ha=10, kystvand_id=1, options=(_option("none", 0.0, 0.0),)
        )
        caps = (100.0, 40.0) + (100.0,) * (NUM_YEARS - 2)
        output = _solve((field,), {1: caps}, (_trade(1, 5),))
        self.assertEqual(output.quota_trades, {1: (-40,) * NUM_YEARS})

    def test_each_opland_trades_at_its_own_price(self) -> None:
        output = _solve(
            (_field("a", 1), _field("b", 2)),
            {1: CAP_100, 2: CAP_100},
            (_trade(1, 8), _trade(2, 30)),
        )
        self.assertEqual(_chosen(output), {"a": "high", "b": "low"})
        self.assertEqual(output.quota_trades, {1: (50,) * NUM_YEARS, 2: (-50,) * NUM_YEARS})

    def test_an_untraded_opland_keeps_its_cap(self) -> None:
        output = _solve(
            (_field("a", 1), _field("b", 2)),
            {1: CAP_100, 2: CAP_100},
            (_trade(1, 8),),
        )
        self.assertEqual(_chosen(output), {"a": "high", "b": "low"})
        self.assertEqual(set(output.quota_trades), {1})

    def test_locked_marker_count_toward_the_kvote_needed(self) -> None:
        # The locked mark lets out 80 kg, so high needs 130 kg more.
        output = _solve((_field("a", 1),), {1: CAP_100}, (_trade(1, 1),), (_locked(1, 80.0),))
        self.assertEqual(_chosen(output), {"a": "high"})
        self.assertEqual(output.quota_trades, {1: (130,) * NUM_YEARS})

    def test_a_free_kvote_is_reported_as_the_smallest_trade_the_plan_needs(self) -> None:
        output = _solve((_field("a", 1),), {1: CAP_100}, (_trade(1, 0),))
        self.assertEqual(_chosen(output), {"a": "high"})
        self.assertEqual(output.quota_trades, {1: (50,) * NUM_YEARS})

    def test_a_trade_by_year_buys_only_what_each_year_needs(self) -> None:
        # high needs 90 kg more in the 60 kg year and 50 kg in the others.
        caps = (100.0, 60.0) + (100.0,) * (NUM_YEARS - 2)
        output = _solve((_field("a", 1),), {1: caps}, (_trade(1, 8, same_each_year=False),))
        self.assertEqual(_chosen(output), {"a": "high"})
        # 8 kr for 7 * 50 + 90 kg over 8 years: 440 kr per year, not 720.
        self.assertEqual(output.quota_trades, {1: (50, 90) + (50,) * (NUM_YEARS - 2)})

    def test_a_trade_by_year_sells_what_each_year_does_not_use(self) -> None:
        # Nothing is let out, so each year's whole cap is sold.
        field = YearlyFieldInput(
            id="a", area_ha=10, kystvand_id=1, options=(_option("none", 0.0, 0.0),)
        )
        caps = (100.0, 40.0) + (100.0,) * (NUM_YEARS - 2)
        output = _solve((field,), {1: caps}, (_trade(1, 5, same_each_year=False),))
        self.assertEqual(
            output.quota_trades,
            {1: (-100, -40) + (-100,) * (NUM_YEARS - 2)},
        )

    def test_buys_at_the_buy_price(self) -> None:
        # high: 2,000 - 5 * 50 = 1,750; mid: 1,600; low and selling: 1,100.
        output = _solve(
            (_field("a", 1, options=(HIGH, MID, LOW)),), {1: CAP_100}, (_trade(1, 5, 2),)
        )
        self.assertEqual(_chosen(output), {"a": "high"})
        self.assertEqual(output.quota_trades, {1: (50,) * NUM_YEARS})

    def test_sells_at_the_sell_price(self) -> None:
        # low and selling 50 kg: 1,000 + 30 * 50 = 2,500; mid: 1,600.
        output = _solve(
            (_field("a", 1, options=(HIGH, MID, LOW)),), {1: CAP_100}, (_trade(1, 40, 30),)
        )
        self.assertEqual(_chosen(output), {"a": "low"})
        self.assertEqual(output.quota_trades, {1: (-50,) * NUM_YEARS})

    def test_trades_nothing_between_the_prices(self) -> None:
        # Buying 50 kg for high costs 1,250 and earns 400 more than mid;
        # selling 50 kg with low earns 500 and loses 600 against mid.
        output = _solve(
            (_field("a", 1, options=(HIGH, MID, LOW)),), {1: CAP_100}, (_trade(1, 25, 10),)
        )
        self.assertEqual(_chosen(output), {"a": "mid"})
        self.assertEqual(output.quota_trades, {1: (0,) * NUM_YEARS})

    def test_a_trade_by_year_pays_each_years_own_price(self) -> None:
        # high needs 50 kg more in the 100 kg years and leaves 50 kg in the
        # 200 kg year: 7 * 50 * 8 kr bought, 50 * 5 kr sold, over 8 years.
        caps = (100.0, 200.0) + (100.0,) * (NUM_YEARS - 2)
        output = _solve((_field("a", 1),), {1: caps}, (_trade(1, 8, 5, same_each_year=False),))
        self.assertEqual(_chosen(output), {"a": "high"})
        self.assertEqual(
            output.quota_trades,
            {1: (50, -50) + (50,) * (NUM_YEARS - 2)},
        )

    def test_fractional_shortfall_is_rounded_up_to_whole_kg(self) -> None:
        field = _field("a", 1, options=(("only", 2_000.0, 150.3),))
        caps = (100.2, 60.1) + (100.2,) * (NUM_YEARS - 2)
        trade = _trade(1, 8, same_each_year=False)

        output = _solve((field,), {1: caps}, (trade,))

        self.assertEqual(output.quota_trades, {1: (51, 91) + (51,) * (NUM_YEARS - 2)})

    def test_constant_trade_covers_the_largest_fractional_shortfall(self) -> None:
        field = _field("a", 1, options=(("only", 2_000.0, 150.3),))
        caps = (100.2, 60.1) + (100.2,) * (NUM_YEARS - 2)
        trade = _trade(1, 8)

        output = _solve((field,), {1: caps}, (trade,))

        self.assertEqual(output.quota_trades, {1: (91,) * NUM_YEARS})

    def test_fractional_surplus_is_rounded_down_to_whole_kg(self) -> None:
        field = _field("a", 1, options=(("only", 1_000.0, 50.7),))
        caps = (100.8,) * NUM_YEARS
        trade = _trade(1, 8, same_each_year=False)

        output = _solve((field,), {1: caps}, (trade,))

        self.assertEqual(output.quota_trades, {1: (-50,) * NUM_YEARS})

    def test_reported_trade_uses_the_solvers_scaled_emissions(self) -> None:
        field = _field("a", 1, options=(("only", 2_000.0, 150.0004),))
        trade = _trade(1, 8, same_each_year=False)

        output = _solve((field,), {1: CAP_100}, (trade,))

        self.assertEqual(output.quota_trades, {1: (50,) * NUM_YEARS})

    def test_rounding_does_not_allow_selling_more_than_the_original_cap(self) -> None:
        field = _field("a", 1, options=(("none", 0.0, 0.0),))
        caps = (0.9996,) * NUM_YEARS
        for same_each_year in (True, False):
            with self.subTest(same_each_year=same_each_year):
                trade = _trade(1, 8, same_each_year=same_each_year)

                output = _solve((field,), {1: caps}, (trade,))

                self.assertEqual(output.quota_trades, {1: (0,) * NUM_YEARS})

    def test_a_sell_price_above_the_buy_price_is_refused(self) -> None:
        # Buying and selling the same kg would then pay without end.
        with self.assertRaises(ValueError):
            _solve((_field("a", 1),), {1: CAP_100}, (_trade(1, 5, 8),))

    def test_an_opland_without_a_cap_in_every_year_cannot_trade(self) -> None:
        caps = (None,) + (100.0,) * (NUM_YEARS - 1)
        with self.assertRaises(ValueError):
            _solve((_field("a", 1),), {1: caps}, (_trade(1, 8),))
        with self.assertRaises(ValueError):
            _solve((_field("a", 1),), {}, (_trade(1, 8),))

    def test_an_opland_without_kvotegivende_marker_cannot_trade(self) -> None:
        with self.assertRaises(ValueError):
            _solve((_field("a", 1, kvotegivende=False),), {1: CAP_100}, (_trade(1, 8),))


if __name__ == "__main__":
    unittest.main()
