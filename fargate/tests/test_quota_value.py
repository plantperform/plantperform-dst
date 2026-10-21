import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from types import SimpleNamespace
from unittest import mock

from app.domain.optimization import NUM_YEARS
from app.domain.quota_value import QuotaTradeRange
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
)
from plantperform_fargate.deadline import remaining_time
from plantperform_fargate.models import (
    YearlyConstraintsInput,
    YearlyFieldInput,
    YearlyOptimizationInput,
    YearlyOptimizationOutput,
    YearlyRotationOption,
)
from plantperform_fargate.quota_value import (
    POINT_GAP,
    REFINED_GAP,
    BaseNotSolvedError,
    QuotaCurve,
    QuotaPoint,
    analyse_quota_value,
    best_trade,
    contender_trades,
    gain,
    kvotegivende_n_load_by_year,
    quota_value_curve,
    repair_hint,
    tradable_kystvandoplande,
)
from plantperform_fargate.quota_value_worker import _rotations, parallel_solves
from plantperform_fargate.yearly_engine import YearlyModel, solve_yearly

KYSTVAND, OTHER_KYSTVAND = 233, 244


def _candidate(key: str) -> RotationCandidateEvaluation:
    return RotationCandidateEvaluation(
        ref=RotationCandidateRef(saedskiftevariant=key, variant="1", n_norm_pct="100"),
        active_len=1,
        years=[],
        avg_leaching_kg_n_ha=0,
        avg_db_kr_ha=0,
        avg_fen=0,
    )


def _option(key: str, n_load: float, db2: float, fen: float = 0.0) -> YearlyRotationOption:
    return YearlyRotationOption(
        key=key,
        id=key,
        candidate=_candidate(key),
        years=(),
        db2_by_year=(db2,) * NUM_YEARS,
        n_load_by_year=(n_load,) * NUM_YEARS,
        leaching_by_year=(n_load,) * NUM_YEARS,
        fen=fen,
        fen_by_year=(fen,) * NUM_YEARS,
    )


def _field(field_id: str, kystvand_id: int, *options: YearlyRotationOption) -> YearlyFieldInput:
    return YearlyFieldInput(
        id=field_id, area_ha=10, kystvand_id=kystvand_id, options=options, kvotegivende=True
    )


def _input(fields, caps: dict[int, float], max_fen: float | None = None):
    return YearlyOptimizationInput(
        fields=tuple(fields),
        constraints=YearlyConstraintsInput(
            max_n_load_by_kystvandopland_and_year={k: (c,) * NUM_YEARS for k, c in caps.items()},
            db2_swing_pct=None,
            min_fen=None,
            max_fen=max_fen,
        ),
        time_limit_seconds=5,
    )


def _one_opland_farm():
    # Cap 100 kg N/år. V(0) = 1500 (both low); +30 kg lets B go mid (2500);
    # +100 lets A go high (3500); without a cap both go up (4500, needs +130).
    # The lowest udledning is 80, so at most 20 kg can be sold.
    return _input(
        [
            _field("a", KYSTVAND, _option("a-low", 50, 1000), _option("a-high", 150, 3000)),
            _field("b", KYSTVAND, _option("b-low", 30, 500), _option("b-mid", 80, 1500)),
        ],
        {KYSTVAND: 100},
    )


def _recording_solver(calls):
    def solver(input, hint):
        calls.append((input, hint))
        return solve_yearly(input, hint)

    return solver


def _window_farm():
    # Cap 120 kg N/år, so the window is 30 kg either way. V(0) = 3500 (a-high +
    # b-low, 110); +30 kg lets b go mid as well (4500, 150), which is also the
    # uncapped udledning. Selling 20 kg or more drops a to low (1500, 80); the
    # lowest udledning is 80, so at most 40 kg can be sold.
    return _input(
        [
            _field("a", KYSTVAND, _option("a-low", 50, 1000), _option("a-high", 80, 3000)),
            _field("b", KYSTVAND, _option("b-low", 30, 500), _option("b-mid", 70, 1500)),
        ],
        {KYSTVAND: 120},
    )


class QuotaValueCurveTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.analysis = analyse_quota_value(
            _window_farm(), price_kr_per_kg=20, solver=_recording_solver(self.calls)
        )
        [self.curve] = self.analysis.curves
        self.by_trade = {p.trade_kg: p for p in self.curve.points}

    def test_seven_points_spread_over_a_quarter_of_the_cap(self):
        expected = {-30: 1500, -20: 1500, -10: 3500, 0: 3500, 10: 3500, 20: 3500, 30: 4500}
        self.assertEqual(sorted(self.by_trade), sorted(expected))
        for trade, db2 in expected.items():
            with self.subTest(trade=trade):
                self.assertTrue(self.by_trade[trade].feasible)
                self.assertAlmostEqual(self.by_trade[trade].db2, db2)

    def test_the_uncapped_solution_is_the_top_when_the_window_reaches_it(self):
        self.assertEqual(self.curve.unconstrained_trade_kg, 30)
        # Uncapped, +10, +20 and the three selling points; +30 is not solved again.
        self.assertEqual(self.curve.solves, 6)
        self.assertEqual(self.by_trade[30].choices, {"a": "a-high", "b": "b-mid"})

    def test_points_are_hinted_with_a_neighbour_but_the_uncapped_solve_is_not(self):
        # The base (no stored solution here) and the uncapped solve start fresh.
        self.assertIsNone(self.calls[0][1])
        uncapped = self.calls[1][0].constraints.max_n_load_by_kystvandopland_and_year
        self.assertEqual(uncapped[KYSTVAND], (None,) * NUM_YEARS)
        self.assertIsNone(self.calls[1][1])
        self.assertTrue(all(hint for _, hint in self.calls[2:]))

    def test_points_carry_udledning_cap_and_choices(self):
        point = self.by_trade[20]
        self.assertEqual(point.cap_by_year, (140,) * NUM_YEARS)
        self.assertEqual(point.n_load_by_year, (110,) * NUM_YEARS)
        self.assertEqual(point.choices, {"a": "a-high", "b": "b-low"})
        self.assertEqual(point.fen_by_year, (0,) * NUM_YEARS)

    def test_best_trade_follows_the_price(self):
        base = self.analysis.base
        # Selling 10 kg costs nothing, so it pays at any price above 1000 / 30 kr.
        cases = {0: 30, 10: 30, 40: -10, 100: -10}
        for price, trade in cases.items():
            with self.subTest(price=price):
                best = best_trade(self.curve, base, price)
                self.assertEqual(best.trade_kg, trade)
        self.assertAlmostEqual(gain(self.by_trade[30], base, 10), 1000 - 300)


class WindowLimitTests(unittest.TestCase):
    def trades(self, farm, **options):
        base = analyse_quota_value(farm, 0, solver=solve_yearly).base
        curve = quota_value_curve(farm, KYSTVAND, base, solver=solve_yearly, **options)
        return curve, {p.trade_kg: p for p in curve.points}

    def test_buying_stops_inside_the_window_when_more_adds_nothing(self):
        # A 60 kg window, but buying more than the uncapped 30 kg adds nothing.
        _, points = self.trades(_window_farm(), window_share=0.5)
        self.assertEqual([t for t in sorted(points) if t > 0], [10, 20, 30])

    def test_the_uncapped_udledning_outside_the_window_is_not_a_point(self):
        # Cap 100, so a 25 kg window; buying everything would take 130 kg.
        curve, points = self.trades(_one_opland_farm())
        self.assertEqual(curve.unconstrained_trade_kg, 130)
        self.assertEqual([t for t in sorted(points) if t > 0], [8, 17, 25])

    def test_selling_stops_at_proven_infeasibility(self):
        # A 60 kg window, but at most 40 kg can be sold: -60 is infeasible and
        # within 25 kg of -40, so it is not bisected.
        _, points = self.trades(_window_farm(), window_share=0.5)
        self.assertEqual([t for t in sorted(points) if t < 0], [-60, -40, -20])
        self.assertEqual(points[-60].status, "INFEASIBLE")
        self.assertTrue(points[-40].feasible)

    def test_the_step_into_infeasibility_is_bisected(self):
        # The whole 200 kg cap: -200 is infeasible, -133 is not; at most 160 kg
        # can be sold, and the limit is located within 25 kg.
        _, points = self.trades(_selling_farm(), window_share=1)
        self.assertEqual([t for t in sorted(points) if t < 0], [-200, -175, -150, -133, -67])
        self.assertEqual(points[-175].status, "INFEASIBLE")
        self.assertAlmostEqual(points[-150].db2, 700)


class InteractionTests(unittest.TestCase):
    def test_separate_best_trades_are_checked_together(self):
        # Each opland on its own buys kvote to go high, but the farm may only
        # produce 1 FE a year, so together only one field can go high.
        farm = _input(
            [
                _field("a", KYSTVAND, _option("a-low", 50, 1000), _option("a-high", 110, 3000, 1)),
                _field(
                    "b",
                    OTHER_KYSTVAND,
                    _option("b-low", 50, 1000),
                    _option("b-high", 110, 3000, 1),
                ),
            ],
            {KYSTVAND: 100, OTHER_KYSTVAND: 100},
            max_fen=1,
        )
        analysis = analyse_quota_value(farm, price_kr_per_kg=5)
        self.assertEqual(tradable_kystvandoplande(farm), [KYSTVAND, OTHER_KYSTVAND])
        check = analysis.interaction
        self.assertEqual(check.trades_kg, {KYSTVAND: 10, OTHER_KYSTVAND: 10})
        self.assertAlmostEqual(check.separate_gain, 2 * (2000 - 5 * 10))
        self.assertEqual(check.combined_status, "OPTIMAL")
        self.assertAlmostEqual(check.combined_gain, 2000 - 5 * 20)

    def test_no_check_when_only_one_opland_trades(self):
        analysis = analyse_quota_value(_one_opland_farm(), price_kr_per_kg=5)
        self.assertIsNone(analysis.interaction)

    def test_unsolved_base_raises_with_its_status(self):
        farm = _input([_field("a", KYSTVAND, _option("a-low", 50, 1000))], {KYSTVAND: 10})
        with self.assertRaises(BaseNotSolvedError) as raised:
            analyse_quota_value(farm, price_kr_per_kg=5)
        self.assertEqual(raised.exception.status, "INFEASIBLE")


def _selling_farm():
    # Cap 200 kg N/år. V(0) = 4000 (a-high 50 + b-high 150). Selling 50 or 100
    # keeps 1500 (a-high + b-low = 80); selling 150 leaves 700 (40); selling all
    # 200 is infeasible.
    return _input(
        [
            _field("a", KYSTVAND, _option("a-high", 50, 1000), _option("a-low", 10, 200)),
            _field("b", KYSTVAND, _option("b-high", 150, 3000), _option("b-low", 30, 500)),
        ],
        {KYSTVAND: 200},
    )


def _cap(input) -> float:
    return input.constraints.max_n_load_by_kystvandopland_and_year[KYSTVAND][0]


def _unsolved():
    """What CP-SAT returns when it finds no solution within its time limit."""
    return YearlyOptimizationOutput(
        status="UNKNOWN",
        assignments=(),
        total_db2=0,
        total_n_load_kg=0,
        total_leaching_kg=0,
        total_fen=0,
        total_db2_by_year=(0.0,) * NUM_YEARS,
        total_n_load_by_year=(0.0,) * NUM_YEARS,
    )


class SearchAndEnvelopeTests(unittest.TestCase):
    def curve(self, farm, solver, **options):
        base = analyse_quota_value(farm, 0, solver=solve_yearly).base
        return {
            p.trade_kg: p
            for p in quota_value_curve(farm, KYSTVAND, base, solver=solver, **options).points
        }

    def test_an_unsolved_point_takes_the_solution_of_a_smaller_trade(self):
        # The solver finds nothing in time at +67 kg (cap 167): V(67) is still
        # at least V(33), whose solution also meets the larger cap.
        def solver(input, hint):
            return _unsolved() if _cap(input) == 167 else solve_yearly(input, hint)

        points = self.curve(_one_opland_farm(), solver, window_share=1)
        self.assertEqual(points[67].status, "FEASIBLE")
        self.assertAlmostEqual(points[67].db2, 2500)
        self.assertEqual(points[67].solution_from_trade_kg, 33)
        self.assertEqual(points[67].choices, points[33].choices)
        self.assertEqual(points[67].cap_by_year, (167,) * NUM_YEARS)
        self.assertIsNone(points[33].solution_from_trade_kg)

    def test_selling_continues_past_an_unknown_step_to_proven_infeasibility(self):
        def solver(input, hint):
            return _unsolved() if _cap(input) == 133 else solve_yearly(input, hint)

        points = self.curve(_selling_farm(), solver, window_share=1)
        self.assertAlmostEqual(points[-133].db2, 700)
        self.assertEqual(points[-200].status, "INFEASIBLE")
        # The unsolved point takes the solution found further down.
        self.assertEqual(points[-67].solution_from_trade_kg, -133)

    def test_selling_points_are_solved_again_from_the_point_below(self):
        # Going down, the -67 kg point returns a poor solution (700 instead of
        # 1500). Going back up from -133 kg it is solved again and improves.
        calls = []

        def solver(input, hint):
            calls.append(_cap(input))
            if _cap(input) == 133 and calls.count(133) == 1:
                # A time-limited answer: valid for the cap, but not the best.
                poor = solve_yearly(replace(input, constraints=_selling_farm_caps(50)))
                return replace(poor, status="FEASIBLE")
            return solve_yearly(input, hint)

        points = self.curve(_selling_farm(), solver, window_share=1)
        self.assertEqual(calls.count(133), 2)
        self.assertAlmostEqual(points[-67].db2, 1500)
        self.assertIsNone(points[-67].solution_from_trade_kg)
        self.assertAlmostEqual(points[-133].db2, 700)
        self.assertEqual(points[-200].status, "INFEASIBLE")


class UpperBoundTests(unittest.TestCase):
    def test_an_optimal_solve_is_bounded_by_its_own_value(self):
        output = solve_yearly(_window_farm())
        self.assertEqual(output.status, "OPTIMAL")
        self.assertAlmostEqual(output.db2_upper_bound, output.total_db2)

    def test_every_point_is_bounded_from_above(self):
        [curve] = analyse_quota_value(_window_farm(), price_kr_per_kg=20).curves
        for point in curve.points:
            with self.subTest(trade=point.trade_kg):
                self.assertGreaterEqual(point.db2_upper_bound, point.db2)

    def test_a_larger_trade_bound_lowers_a_smaller_trade_bound(self):
        # Time-limited solves: +10 kg (cap 130) only proves V <= 9000, but +20 kg
        # proves V <= 3600, which also holds for every smaller trade.
        def solver(input, hint):
            output = solve_yearly(input, hint)
            bound = {130: 9000, 140: 3600}.get(_cap(input))
            if bound is None:
                return output
            return replace(output, status="FEASIBLE", db2_upper_bound=bound)

        base = analyse_quota_value(_window_farm(), 0, solver=solve_yearly).base
        points = {
            p.trade_kg: p
            for p in quota_value_curve(_window_farm(), KYSTVAND, base, solver=solver).points
        }
        self.assertAlmostEqual(points[20].db2_upper_bound, 3600)
        self.assertAlmostEqual(points[10].db2_upper_bound, 3600)
        self.assertAlmostEqual(points[30].db2_upper_bound, 4500)

    def test_an_unsolved_point_keeps_its_own_bound(self):
        # Nothing found in time at +20 kg, but the solver proved V <= 3550.
        def solver(input, hint):
            if _cap(input) == 140:
                return replace(_unsolved(), db2_upper_bound=3550)
            return solve_yearly(input, hint)

        base = analyse_quota_value(_window_farm(), 0, solver=solve_yearly).base
        points = {
            p.trade_kg: p
            for p in quota_value_curve(_window_farm(), KYSTVAND, base, solver=solver).points
        }
        self.assertEqual(points[20].solution_from_trade_kg, 10)
        self.assertAlmostEqual(points[20].db2, 3500)
        self.assertAlmostEqual(points[20].db2_upper_bound, 3550)


class TradeRangeTests(unittest.TestCase):
    def trades(self, trade_range):
        [curve] = analyse_quota_value(
            _window_farm(), price_kr_per_kg=20, trade_range=trade_range
        ).curves
        return {p.trade_kg: p for p in curve.points}

    def test_a_chosen_range_replaces_the_window_and_keeps_its_limits(self):
        # -45..50 in steps of 20: -45, -40, -20, 20, 40, 50. Buying stops at the
        # uncapped 30 kg; at most 40 kg can be sold, so -45 is infeasible.
        points = self.trades(QuotaTradeRange(min_kg=-45, max_kg=50, step_kg=20))
        self.assertEqual(sorted(points), [-45, -40, -20, 0, 20, 30])
        self.assertEqual(points[-45].status, "INFEASIBLE")
        self.assertAlmostEqual(points[30].db2, 4500)

    def test_a_buying_only_range_solves_no_selling(self):
        points = self.trades(QuotaTradeRange(min_kg=10, max_kg=30, step_kg=10))
        self.assertEqual(sorted(points), [0, 10, 20, 30])


class ProgressTests(unittest.TestCase):
    def test_every_step_is_reported_in_order_until_done(self):
        reports = []
        analyse_quota_value(_window_farm(), price_kr_per_kg=20, on_progress=reports.append)
        steps = lambda report: [  # noqa: E731
            (s["key"], s["kystvand_id"], s["state"], s["done"], s["total"]) for s in report
        ]
        self.assertEqual(
            steps(reports[0]),
            [
                ("base", None, "running", 0, 1),
                ("uncapped", KYSTVAND, "pending", 0, None),
                ("buying", KYSTVAND, "pending", 0, None),
                ("selling", KYSTVAND, "pending", 0, None),
                ("selling_limit", KYSTVAND, "pending", 0, None),
                ("refinement", None, "pending", 0, None),
            ],
        )
        # The top buying point is the uncapped solution, not a solve of its own,
        # but it counts as done. Nothing needed bisecting or refining.
        self.assertEqual(
            steps(reports[-1]),
            [
                ("base", None, "done", 1, 1),
                ("uncapped", KYSTVAND, "done", 1, 1),
                ("buying", KYSTVAND, "done", 3, 3),
                ("selling", KYSTVAND, "done", 3, 3),
                ("selling_limit", KYSTVAND, "skipped", 0, None),
                ("refinement", None, "skipped", 0, 0),
            ],
        )
        running = [s["key"] for report in reports for s in report if s["state"] == "running"]
        self.assertIn("buying", running)

    def test_the_interaction_check_is_a_step_with_several_oplande(self):
        farm = _input(
            [
                _field("a", KYSTVAND, _option("a-low", 50, 1000)),
                _field("b", OTHER_KYSTVAND, _option("b-low", 50, 1000)),
            ],
            {KYSTVAND: 100, OTHER_KYSTVAND: 100},
        )

        def final_states(price):
            reports = []
            analyse_quota_value(farm, price_kr_per_kg=price, on_progress=reports.append)
            return {(s["key"], s["kystvand_id"]): s["state"] for s in reports[-1]}

        # At 5 kr/kg both oplande sell their spare 25 kg, which is checked together.
        at_five = final_states(5)
        self.assertEqual(at_five[("uncapped", OTHER_KYSTVAND)], "done")
        self.assertEqual(at_five[("interaction", None)], "done")
        # At 0 kr/kg selling earns nothing, so neither opland trades.
        self.assertEqual(final_states(0)[("interaction", None)], "skipped")


class ContenderRefinementTests(unittest.TestCase):
    def analyse(self, loose_by: float, parallel_solves: int = 1):
        # At the point gap every solve proves only V <= found + loose_by; at the
        # refined gap it proves its solution best.
        calls = []

        def solver(input, hint):
            output = solve_yearly(input, hint)
            calls.append((_cap(input), input.relative_gap_limit, threading.current_thread().name))
            if input.relative_gap_limit == REFINED_GAP:
                return replace(output, db2_upper_bound=output.total_db2)
            return replace(output, db2_upper_bound=output.total_db2 + loose_by)

        analysis = analyse_quota_value(
            _window_farm(), price_kr_per_kg=20, solver=solver, parallel_solves=parallel_solves
        )
        return analysis, calls

    def test_the_refinement_solves_run_in_parallel_with_the_same_result(self):
        sequential, _ = self.analyse(500)
        parallel, calls = self.analyse(500, parallel_solves=3)
        refined = [name for _, gap, name in calls if gap == REFINED_GAP]
        self.assertEqual(len(refined), 3)
        self.assertTrue(all(name.startswith("quota-solve") for name in refined))
        self.assertEqual(_curves(parallel), _curves(sequential))
        self.assertEqual(
            [p.db2_upper_bound for p in parallel.curves[0].points],
            [p.db2_upper_bound for p in sequential.curves[0].points],
        )

    def test_points_that_could_be_best_are_solved_again_to_the_tighter_gap(self):
        # V - 20 t: +30 is best (3900). With 500 kr ranges, -10 (3700) and 0
        # (3500) might still beat it; +10 (3300) and the rest cannot.
        analysis, calls = self.analyse(500)
        refined = sorted(cap for cap, gap, _ in calls if gap == REFINED_GAP)
        self.assertEqual(refined, [110, 120, 150])
        self.assertTrue(all(gap == POINT_GAP for _, gap, _ in calls[: -len(refined)]))
        [curve] = analysis.curves
        by_trade = {p.trade_kg: p for p in curve.points}
        for trade in (-10, 0, 30):
            with self.subTest(trade=trade):
                self.assertAlmostEqual(by_trade[trade].db2_upper_bound, by_trade[trade].db2)
        self.assertEqual(contender_trades(curve, 20), [])

    def test_nothing_is_solved_again_when_the_best_trade_is_proven(self):
        _, calls = self.analyse(100)
        self.assertNotIn(REFINED_GAP, {gap for _, gap, _ in calls})

    def test_contenders_follow_the_price(self):
        point = lambda t, db2, bound: replace(  # noqa: E731
            QuotaPoint(t, "OPTIMAL", db2, (), (), (), {}), db2_upper_bound=bound
        )
        curve = QuotaCurve(
            KYSTVAND,
            (),
            (point(0, 1000, 1010), point(10, 1200, 1260), point(20, 1300, 1310)),
            20,
            0,
        )
        # V - 5 t: 1000, 1150, 1200; only +10's range (up to 1210) reaches +20.
        self.assertEqual(contender_trades(curve, 5), [10, 20])
        # V - 20 t: 1000, 1000, 900; ties go to no trade, and +10 could reach 1060.
        self.assertEqual(contender_trades(curve, 20), [0, 10])
        # V - 50 t: no trade is best by far.
        self.assertEqual(contender_trades(curve, 50), [])


def _selling_farm_caps(cap: float):
    return replace(
        _selling_farm().constraints,
        max_n_load_by_kystvandopland_and_year={KYSTVAND: (cap,) * NUM_YEARS},
    )


class RepairHintTests(unittest.TestCase):
    def test_makes_the_plan_meet_the_tighter_cap_with_the_cheapest_switch(self):
        # Base load 200 (a-high 50 + b-high 150). Selling 30 kg: a-low cuts 40 kg
        # for 800 kr (20 kr/kg), b-low cuts 120 kg for 2500 kr; a-low is chosen.
        repaired = repair_hint(
            _selling_farm(), {"a": "a-high", "b": "b-high"}, KYSTVAND, (170,) * NUM_YEARS
        )
        self.assertEqual(repaired, {"a": "a-low", "b": "b-high"})

    def test_keeps_the_per_year_fen_bounds(self):
        # a-low would be cheapest, but only a-high produces the required FE.
        farm = _input(
            [
                _field("a", KYSTVAND, _option("a-high", 50, 1000, 1), _option("a-low", 10, 200)),
                _field("b", KYSTVAND, _option("b-high", 150, 3000), _option("b-low", 30, 500)),
            ],
            {KYSTVAND: 200},
            max_fen=None,
        )
        farm = replace(farm, constraints=replace(farm.constraints, min_fen=1))
        repaired = repair_hint(farm, {"a": "a-high", "b": "b-high"}, KYSTVAND, (170,) * NUM_YEARS)
        self.assertEqual(repaired, {"a": "a-high", "b": "b-low"})

    def test_a_shift_that_only_moves_the_excess_to_other_years_is_not_taken(self):
        # "even" is over the cap in even years; "odd" (the same rotation shifted
        # one year, same DB2) would only move the excess to the odd years. The
        # previous version swapped between them forever; "low" really helps.
        def shifted(key, loads):
            return replace(
                _option(key, 0, 1000),
                n_load_by_year=loads * (NUM_YEARS // 2),
                leaching_by_year=loads * (NUM_YEARS // 2),
            )

        farm = _input(
            [
                _field(
                    "a",
                    KYSTVAND,
                    shifted("even", (100, 20)),
                    shifted("odd", (20, 100)),
                    replace(_option("low", 40, 900)),
                )
            ],
            {KYSTVAND: 60},
        )
        repaired = repair_hint(farm, {"a": "even"}, KYSTVAND, (60,) * NUM_YEARS)
        self.assertEqual(repaired, {"a": "low"})

    def test_gives_up_when_no_switch_lowers_the_udledning_enough(self):
        self.assertIsNone(
            repair_hint(
                _selling_farm(), {"a": "a-high", "b": "b-high"}, KYSTVAND, (10,) * NUM_YEARS
            )
        )

    def test_selling_steps_start_from_a_hint_that_meets_their_cap(self):
        calls = []

        def solver(input, hint):
            calls.append((_cap(input), hint))
            return solve_yearly(input, hint)

        farm = _selling_farm()
        base = analyse_quota_value(farm, 0, solver=solve_yearly).base
        quota_value_curve(farm, KYSTVAND, base, solver=solver, window_share=1)
        # Caps below 40 kg (the lowest possible udledning) cannot be repaired;
        # those steps fall back to the neighbour's hint and prove infeasible.
        selling = [
            (cap, hint) for cap, hint in calls if cap is not None and 40 <= cap < 200 and hint
        ]
        # The grid points and the midpoint towards the selling limit.
        self.assertLessEqual({50, 67, 133}, {cap for cap, _ in selling})
        for cap, hint in selling:
            load = kvotegivende_n_load_by_year(farm, hint, KYSTVAND)
            self.assertLessEqual(max(load), cap)


def _two_opland_farm():
    # Each opland can buy its way from low to high on its own (+50 kg each).
    return _input(
        [
            _field("a", KYSTVAND, _option("a-low", 50, 1000), _option("a-high", 110, 3000)),
            _field("b", KYSTVAND, _option("b-low", 30, 500), _option("b-mid", 60, 1200)),
            _field("c", OTHER_KYSTVAND, _option("c-low", 40, 800), _option("c-high", 90, 2500)),
        ],
        {KYSTVAND: 120, OTHER_KYSTVAND: 100},
    )


def _curves(analysis):
    return [
        (c.kystvand_id, [(p.trade_kg, p.status, round(p.db2 or 0, 6)) for p in c.points])
        for c in analysis.curves
    ]


class ParallelOplandeTests(unittest.TestCase):
    def test_solving_oplande_in_parallel_gives_the_sequential_result(self):
        sequential = analyse_quota_value(_two_opland_farm(), price_kr_per_kg=20)
        parallel = analyse_quota_value(_two_opland_farm(), price_kr_per_kg=20, parallel_solves=2)
        self.assertEqual(len(parallel.curves), 2)
        self.assertEqual(_curves(parallel), _curves(sequential))
        self.assertEqual(parallel.interaction, sequential.interaction)

    def test_curves_run_on_their_own_threads_and_keep_the_job_deadline(self):
        seen = []

        def solver(input, hint):
            seen.append((threading.current_thread().name, remaining_time.get()))
            return solve_yearly(input, hint)

        deadline = lambda: 10**9  # noqa: E731  (milliseconds left: plenty)
        token = remaining_time.set(deadline)
        try:
            analyse_quota_value(
                _two_opland_farm(), price_kr_per_kg=20, solver=solver, parallel_solves=2
            )
        finally:
            remaining_time.reset(token)
        curve_threads = {name for name, _ in seen if name.startswith("quota-solve")}
        self.assertEqual(len(curve_threads), 2)
        self.assertTrue(all(found is deadline for _, found in seen))

    def test_one_worker_solves_on_the_calling_thread(self):
        names = []

        def solver(input, hint):
            names.append(threading.current_thread().name)
            return solve_yearly(input, hint)

        analyse_quota_value(_two_opland_farm(), price_kr_per_kg=20, solver=solver)
        self.assertEqual(set(names), {threading.current_thread().name})

    def test_the_number_of_parallel_solves_comes_from_the_environment(self):
        with mock.patch.dict(os.environ, {"OPTIMIZER_PARALLEL_SOLVES": "3"}):
            self.assertEqual(parallel_solves(), 3)
        with mock.patch.dict(os.environ, {"OPTIMIZER_PARALLEL_SOLVES": "0"}):
            self.assertEqual(parallel_solves(), 1)
        # Without it: half the cores, at OPTIMIZER_SOLVER_THREADS each.
        with (
            mock.patch.dict(os.environ, {"OPTIMIZER_SOLVER_THREADS": "2"}),
            mock.patch.object(os, "cpu_count", return_value=8),
        ):
            os.environ.pop("OPTIMIZER_PARALLEL_SOLVES", None)
            self.assertEqual(parallel_solves(), 2)


class ReusableModelTests(unittest.TestCase):
    def test_copies_solve_independently_and_at_the_same_time(self):
        farm = _one_opland_farm()
        model = YearlyModel(farm)
        caps = {cap: {KYSTVAND: (cap,) * NUM_YEARS} for cap in (100, 130, 200, 230)}
        expected = {cap: 1500 + 1000 * i for i, cap in enumerate(caps)}
        copies = [model.copy() for _ in caps]
        with ThreadPoolExecutor(len(copies)) as pool:
            outputs = list(pool.map(lambda copy, cap: copy.solve(cap, 5), copies, caps.values()))
        for cap, output in zip(caps, outputs, strict=True):
            with self.subTest(cap=cap):
                self.assertEqual(output.status, "OPTIMAL")
                self.assertAlmostEqual(output.total_db2, expected[cap])
        # Solving a copy for another cap leaves the original's cap alone.
        model.solve(caps[100], 5)
        copies[0].solve(caps[230], 5)
        self.assertAlmostEqual(model.solve(caps[100], 5).total_db2, 1500)

    def test_one_model_solved_for_several_caps_matches_fresh_models(self):
        farm = _one_opland_farm()
        model = YearlyModel(farm)
        for cap in (100, 150, 230, None, 100):
            with self.subTest(cap=cap):
                caps = {KYSTVAND: (cap,) * NUM_YEARS}
                reused = model.solve(caps, 5)
                fresh = solve_yearly(
                    replace(
                        farm,
                        constraints=replace(
                            farm.constraints, max_n_load_by_kystvandopland_and_year=caps
                        ),
                    )
                )
                self.assertEqual(reused.status, fresh.status)
                self.assertAlmostEqual(reused.total_db2, fresh.total_db2)

    def test_the_default_analysis_reuses_one_model_with_the_same_result(self):
        reused = analyse_quota_value(_one_opland_farm(), price_kr_per_kg=20)
        fresh = analyse_quota_value(_one_opland_farm(), price_kr_per_kg=20, solver=solve_yearly)
        self.assertEqual(
            [(p.trade_kg, p.status, p.db2) for p in reused.curves[0].points],
            [(p.trade_kg, p.status, p.db2) for p in fresh.curves[0].points],
        )


class SolverHintTests(unittest.TestCase):
    def test_a_poor_hint_does_not_change_the_optimum(self):
        farm = _one_opland_farm()
        hinted = solve_yearly(farm, {"a": "a-high", "b": "b-mid", "missing": "x"})
        self.assertEqual(hinted.status, "OPTIMAL")
        self.assertAlmostEqual(hinted.total_db2, solve_yearly(farm).total_db2)


if __name__ == "__main__":
    unittest.main()


class StoredPlanTests(unittest.TestCase):
    def test_every_mark_gets_its_rotation_from_the_plan_or_its_lock(self):
        shifted = _candidate("315").model_copy(
            update={
                "ref": RotationCandidateRef(
                    saedskiftevariant="315", variant="4+s3", n_norm_pct="100"
                ),
                "base_ref": RotationCandidateRef(
                    saedskiftevariant="315", variant="4", n_norm_pct="100"
                ),
                "start_year": 3,
            }
        )
        built = SimpleNamespace(
            fields=[SimpleNamespace(id="a"), SimpleNamespace(id="locked"), SimpleNamespace(id="x")],
            options_by_field_id={
                "a": (
                    SimpleNamespace(key="a-low", candidate=_candidate("a-low")),
                    SimpleNamespace(key="a-shift", candidate=shifted),
                ),
            },
        )
        point = QuotaPoint(50, "OPTIMAL", 1000, (), (), (), {"a": "a-shift"})
        rotations = _rotations(built, point, {"locked": _candidate("locked")})
        self.assertEqual([r.field_id for r in rotations], ["a", "locked"])
        # The shifted option is stored as its base rotation and start year.
        self.assertEqual(rotations[0].base_ref.variant, "4")
        self.assertEqual(rotations[0].start_year, 3)
        self.assertEqual(rotations[1].base_ref.saedskiftevariant, "locked")
        self.assertEqual(_rotations(built, replace(point, status="INFEASIBLE"), {}), [])
