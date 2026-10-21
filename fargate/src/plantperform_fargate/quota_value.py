"""Value of buying or selling N kvote in one kystvandopland ("Kvotehandel").

For a kystvandopland k, V(t) is the best yearly DB2 "Års-optimering" reaches
when k's udledning cap is changed by t kg N in every capped year (t > 0 buys,
t < 0 sells), everything else unchanged. Given a market price p, the gain of a
trade over not trading is V(t) - p * t - V(0); the price is applied by the
caller, so one curve answers every price.

V(t) is solved at evenly spaced trades within a window of 25 % of k's no-trade
cap either way: three on each side of t = 0, so seven points. The window is cut
at the limits of t. Solving without k's cap gives the udledning the farm would
use if kvote were free; buying beyond it adds nothing, so it is the highest
trade looked at. Selling stops where the model becomes infeasible, and the step
into infeasibility is bisected so the selling limit is located more precisely.

Every solve is hinted with the solution of its nearest already-solved
neighbour, which is usually only a few fields away from the answer.

Each point is solved to within 0.1 % of its proven upper bound, so it is known
to lie in a range [V found, upper bound]. At the price asked for, the points
whose range still overlaps the best trade's could each be the best one; those
are solved again to 0.05 % to tell them apart.

The oplande's curves are independent of each other once the plan without trade
is known, and so are the solves that refine the contenders, so both are solved
several at a time, each thread on its own copy of the model (parallel_solves).
"""

import contextvars
import math
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace

import numpy as np

from app.domain.optimization import NUM_YEARS
from app.domain.quota_value import QuotaTradeRange
from app.domain.rotation_candidate import RotationCandidateEvaluation
from plantperform_fargate.deadline import remaining_time
from plantperform_fargate.models import YearlyOptimizationInput, YearlyOptimizationOutput
from plantperform_fargate.yearly_engine import YearlyModel, solve_yearly

# The trades looked at reach this share of the no-trade cap either way, with
# this many evenly spaced points on each side of t = 0.
WINDOW_SHARE = 0.25
POINTS_PER_SIDE = 3
# How precisely a selling limit inside the window is located.
MIN_STEP_KG = 25
# Solves allowed for locating the selling limit, on top of one per trade (two
# per selling trade, which may be solved again).
MAX_SELLING_LIMIT_SOLVES = 8
# Every point is solved to this relative gap; the points that could still be
# the best trade at the price asked for are then solved again to the second.
POINT_GAP = 0.001
REFINED_GAP = 0.0005
# Safety net for the repair heuristic; every switch lowers the excess anyway.
MAX_REPAIR_SWITCHES_PER_FIELD = 4
# Stop solving new points once less than this much of the job's time remains, so
# the points already solved are saved instead of the whole job timing out.
TIME_RESERVE_SECONDS = 60

FEASIBLE = ("OPTIMAL", "FEASIBLE")

Solver = Callable[[YearlyOptimizationInput, dict[str, str] | None], YearlyOptimizationOutput]


class QuotaProgress:
    """How far the analysis has come, step by step, reported after every change.

    The steps are listed up front in the order they run, so a viewer sees what
    is left: the base, then per opland the uncapped solve, buying, selling and
    locating the selling limit, then the refinement and the interaction check.
    A step's total is set once it is known. report receives a list of plain
    dicts (key, kystvand_id, state, done, total). Oplande solved in parallel
    report from their own threads, so every change and report holds a lock.
    """

    PER_OPLAND = ("uncapped", "buying", "selling", "selling_limit")

    def __init__(self, oplande: list[int], report: Callable[[list[dict]], None] | None = None):
        self._report = report
        self._lock = threading.RLock()
        self._steps = [self._step("base", None)]
        for k in oplande:
            self._steps += [self._step(key, k) for key in self.PER_OPLAND]
        self._steps.append(self._step("refinement", None))
        if len(oplande) > 1:
            self._steps.append(self._step("interaction", None))

    @staticmethod
    def _step(key: str, kystvand_id: int | None) -> dict:
        return {
            "key": key,
            "kystvand_id": kystvand_id,
            "state": "pending",
            "done": 0,
            "total": None,
        }

    def _find(self, key: str, kystvand_id: int | None) -> dict | None:
        return next(
            (s for s in self._steps if s["key"] == key and s["kystvand_id"] == kystvand_id), None
        )

    def _update(self, key: str, kystvand_id: int | None, **changes) -> None:
        with self._lock:
            step = self._find(key, kystvand_id)
            if step is None:
                return
            step.update(changes)
            if self._report is not None:
                self._report([dict(s) for s in self._steps])

    def start(self, key: str, kystvand_id: int | None = None, total: int | None = None) -> None:
        self._update(key, kystvand_id, state="running", total=total)

    def solved(self, key: str, kystvand_id: int | None = None) -> None:
        with self._lock:
            step = self._find(key, kystvand_id)
            if step is not None:
                total = step["total"]
                done = step["done"] + 1
                # A step may need a solve more than planned (a selling point
                # solved again); its total grows with it.
                self._update(
                    key, kystvand_id, done=done, total=None if total is None else max(total, done)
                )

    def finish(self, key: str, kystvand_id: int | None = None) -> None:
        with self._lock:
            step = self._find(key, kystvand_id)
            if step is not None:
                self._update(key, kystvand_id, state="done" if step["done"] else "skipped")

    @property
    def steps(self) -> list[dict]:
        with self._lock:
            return [dict(s) for s in self._steps]


@dataclass(frozen=True)
class QuotaPoint:
    """One solved trade amount for one kystvandopland."""

    trade_kg: float
    status: str
    db2: float | None
    # Udledning of the opland's kvotegivende marker and the traded cap, per year.
    n_load_by_year: tuple[float, ...]
    cap_by_year: tuple[float | None, ...]
    # Foderenheder of the whole farm per year.
    fen_by_year: tuple[float, ...]
    # field id -> chosen option key; empty when infeasible.
    choices: dict[str, str]
    # Set when the solver found nothing better here within its time limit than
    # this smaller trade's solution, which also fits the larger cap: the value
    # is then a lower bound.
    solution_from_trade_kg: float | None = None
    # Proven upper bound on V(t): from this solve, lowered by any larger
    # trade's. db2 <= V(t) <= db2_upper_bound. None when nothing bounds it.
    db2_upper_bound: float | None = None

    @property
    def feasible(self) -> bool:
        return self.status in FEASIBLE


@dataclass(frozen=True)
class QuotaCurve:
    kystvand_id: int
    base_cap_by_year: tuple[float | None, ...]
    points: tuple[QuotaPoint, ...]
    # Buying more than this adds nothing: the farm's udledning without the cap.
    unconstrained_trade_kg: float
    solves: int


@dataclass(frozen=True)
class QuotaInteraction:
    """Separate best trades per opland checked by applying them together."""

    price_kr_per_kg: float
    trades_kg: dict[int, float]
    separate_gain: float
    combined_status: str
    combined_gain: float | None


@dataclass(frozen=True)
class QuotaValueAnalysis:
    base: QuotaPoint
    curves: tuple[QuotaCurve, ...]
    interaction: QuotaInteraction | None


def tradable_kystvandoplande(input: YearlyOptimizationInput) -> list[int]:
    """Oplande with a cap in at least one year and kvotegivende marker in them."""
    caps = input.constraints.max_n_load_by_kystvandopland_and_year
    with_quota = {f.kystvand_id for f in input.fields if f.kvotegivende} | {
        f.kystvand_id for f in input.fixed_fields if f.kvotegivende
    }
    return sorted(
        k
        for k, year_caps in caps.items()
        if k is not None and k in with_quota and any(c is not None for c in year_caps)
    )


def _caps(input: YearlyOptimizationInput, kystvand_id: int) -> tuple[float | None, ...]:
    caps = input.constraints.max_n_load_by_kystvandopland_and_year.get(kystvand_id)
    return tuple(caps) if caps is not None else (None,) * NUM_YEARS


def _traded_caps(caps: tuple[float | None, ...], trade_kg: float | None):
    """trade_kg=None removes the cap altogether."""
    if trade_kg is None:
        return (None,) * NUM_YEARS
    return tuple(None if cap is None else cap + trade_kg for cap in caps)


def with_trades(
    input: YearlyOptimizationInput, trades_kg: dict[int, float | None]
) -> YearlyOptimizationInput:
    caps = dict(input.constraints.max_n_load_by_kystvandopland_and_year)
    for kystvand_id, trade_kg in trades_kg.items():
        caps[kystvand_id] = _traded_caps(_caps(input, kystvand_id), trade_kg)
    return replace(
        input,
        constraints=replace(input.constraints, max_n_load_by_kystvandopland_and_year=caps),
    )


def _rotation_signature(candidate: RotationCandidateEvaluation) -> tuple:
    """What a rotation grows, independent of how its shift was named.

    A saved winner may be labelled with another start year than the option the
    model builds for it (start year 8 of a 3-year cycle is start year 2), so the
    two are matched on the base rotation, N-norm and crops per calendar year.
    """
    base = candidate.base_ref or candidate.ref
    return (
        base.saedskiftevariant,
        base.variant.split("+", 1)[0],
        candidate.ref.n_norm_pct,
        tuple((y.year.afgrode_kode, y.year.udlaeg_kode) for y in candidate.years),
    )


def hint_from_candidates(
    input: YearlyOptimizationInput, selected: dict[str, RotationCandidateEvaluation]
) -> dict[str, str]:
    """Option keys for a previous solution, e.g. the optimization shown to the user."""
    hint = {}
    for field in input.fields:
        candidate = selected.get(field.id)
        if candidate is None:
            continue
        signature = _rotation_signature(candidate)
        match = next(
            (o.key for o in field.options if _rotation_signature(o.candidate) == signature),
            None,
        )
        if match is not None:
            hint[field.id] = match
    return hint


def repair_hint(
    input: YearlyOptimizationInput,
    choices: dict[str, str],
    kystvand_id: int,
    caps: tuple[float | None, ...],
) -> dict[str, str] | None:
    """Turn a solution for a larger cap into one that meets the smaller caps.

    Selling hints come from the neighbour with more kvote, which breaks the
    tighter cap; CP-SAT then has to repair it and, on large scenarier, often
    stops at a poor plan. This repairs it first, greedily: while any year is
    over its cap, switch the one mark to the option that lowers the total excess
    over all years the most per krone of DB2 lost, never breaking the per-year
    FEN bounds. A shifted rotation can move udledning into another year, so a
    switch counts only by how much it lowers the excess summed over the years;
    as that total falls with every switch, the repair always ends. Crop area
    limits and the DB2 swing are left to CP-SAT. Returns None when no switch
    lowers the excess.
    """
    fields = [f for f in input.fields if f.kystvand_id == kystvand_id and f.kvotegivende]
    if not fields:
        return None
    repaired = dict(choices)
    cap = np.array([np.inf if c is None else c for c in caps])
    load = np.array(kvotegivende_n_load_by_year(input, repaired, kystvand_id))
    fen = np.array(fen_by_year(input, repaired))
    min_fen = -np.inf if input.constraints.min_fen is None else input.constraints.min_fen
    max_fen = np.inf if input.constraints.max_fen is None else input.constraints.max_fen
    # Per field: its options' udledning and FEN per year and their total DB2.
    tables = [
        (
            field.id,
            [option.key for option in field.options],
            {option.key: i for i, option in enumerate(field.options)},
            np.array([option.n_load_by_year for option in field.options]),
            np.array([option.fen_by_year for option in field.options]),
            np.array([sum(option.db2_by_year) for option in field.options]),
        )
        for field in fields
    ]

    for _ in range(MAX_REPAIR_SWITCHES_PER_FIELD * len(fields)):
        excess = np.clip(load - cap, 0, None).sum()
        if excess <= 1e-9:
            return repaired
        best = None
        for field_id, keys, index, n_load, fen_options, db2 in tables:
            current = index[repaired[field_id]]
            new_load = load - n_load[current] + n_load
            lowered = excess - np.clip(new_load - cap, 0, None).sum(axis=1)
            new_fen = fen - fen_options[current] + fen_options
            allowed = (lowered > 1e-9) & np.all((new_fen >= min_fen) & (new_fen <= max_fen), axis=1)
            if not allowed.any():
                continue
            score = np.where(allowed, (db2[current] - db2) / np.where(allowed, lowered, 1), np.inf)
            choice = int(np.argmin(score))
            if best is None or score[choice] < best[0]:
                best = (score[choice], field_id, keys[choice], current, choice, n_load, fen_options)
        if best is None:
            return None
        _, field_id, key, current, choice, n_load, fen_options = best
        load += n_load[choice] - n_load[current]
        fen += fen_options[choice] - fen_options[current]
        repaired[field_id] = key
    return None


def _choices(output: YearlyOptimizationOutput) -> dict[str, str]:
    return {a.field_id: a.rotation_id for a in output.assignments}


def kvotegivende_n_load_by_year(
    input: YearlyOptimizationInput, choices: dict[str, str], kystvand_id: int
) -> tuple[float, ...]:
    totals = [0.0] * NUM_YEARS
    for field in input.fields:
        if field.kystvand_id != kystvand_id or not field.kvotegivende:
            continue
        option = next(o for o in field.options if o.key == choices[field.id])
        for y in range(NUM_YEARS):
            totals[y] += option.n_load_by_year[y]
    for fixed in input.fixed_fields:
        if fixed.kystvand_id == kystvand_id and fixed.kvotegivende:
            for y in range(NUM_YEARS):
                totals[y] += fixed.n_load_by_year[y]
    return tuple(totals)


def fen_by_year(input: YearlyOptimizationInput, choices: dict[str, str]) -> tuple[float, ...]:
    totals = [0.0] * NUM_YEARS
    for field in input.fields:
        option = next(o for o in field.options if o.key == choices[field.id])
        for y in range(NUM_YEARS):
            totals[y] += option.fen_by_year[y]
    for fixed in input.fixed_fields:
        for y in range(NUM_YEARS):
            totals[y] += fixed.fen_by_year[y]
    return tuple(totals)


def _point(
    input: YearlyOptimizationInput,
    kystvand_id: int,
    trade_kg: float,
    output: YearlyOptimizationOutput,
) -> QuotaPoint:
    caps = _traded_caps(_caps(input, kystvand_id), trade_kg)
    if output.status not in FEASIBLE:
        return QuotaPoint(
            trade_kg, output.status, None, (), caps, (), {}, db2_upper_bound=output.db2_upper_bound
        )
    choices = _choices(output)
    return QuotaPoint(
        trade_kg=trade_kg,
        status=output.status,
        db2=output.total_db2,
        n_load_by_year=kvotegivende_n_load_by_year(input, choices, kystvand_id),
        cap_by_year=caps,
        fen_by_year=fen_by_year(input, choices),
        choices=choices,
        db2_upper_bound=output.db2_upper_bound,
    )


def _out_of_time() -> bool:
    """Less than the reserve left of the job's total time; keep what is solved."""
    remaining = remaining_time.get()
    return bool(remaining) and remaining() / 1000 < TIME_RESERVE_SECONDS


def _within_job_time(limit_seconds: float) -> float:
    """A solve's time limit, shortened so it always ends before the reserve."""
    remaining = remaining_time.get()
    if not remaining:
        return limit_seconds
    return max(1.0, min(limit_seconds, remaining() / 1000 - TIME_RESERVE_SECONDS))


def quota_value_curve(
    input: YearlyOptimizationInput,
    kystvand_id: int,
    base: QuotaPoint,
    *,
    solver: Solver = solve_yearly,
    window_share: float = WINDOW_SHARE,
    points_per_side: int = POINTS_PER_SIDE,
    min_step_kg: float = MIN_STEP_KG,
    max_solves: int | None = None,
    selling_time_limit_seconds: float | None = None,
    progress: QuotaProgress | None = None,
    trade_range: QuotaTradeRange | None = None,
) -> QuotaCurve:
    """Solve V(t) for one opland; base is the already-solved t = 0 point.

    The window is window_share of the smallest capped year's cap, so selling
    all of it never takes a year's cap below zero. A trade_range replaces the
    window with its own trades, cut at the same limits.

    Selling points are the hard ones (the tighter cap forces many marker to
    change), so they may be given a longer time limit than input's.
    """
    base_caps = _caps(input, kystvand_id)
    capped = [y for y in range(NUM_YEARS) if base_caps[y] is not None]
    points: dict[float, QuotaPoint] = {0.0: replace(base, cap_by_year=base_caps)}
    solves = 0

    def attempt(trade_kg: float, hint: dict[str, str] | None) -> QuotaPoint:
        nonlocal solves
        solves += 1
        limit = input.time_limit_seconds
        if trade_kg < 0 and selling_time_limit_seconds is not None:
            limit = selling_time_limit_seconds
        trade_input = replace(
            with_trades(input, {kystvand_id: trade_kg}),
            time_limit_seconds=_within_job_time(limit),
        )
        return _point(input, kystvand_id, trade_kg, solver(trade_input, hint))

    def selling_hint(trade_kg: float, upper: QuotaPoint) -> dict[str, str]:
        """upper's solution repaired to meet trade_kg's tighter cap, if possible."""
        caps = _traded_caps(base_caps, trade_kg)
        return repair_hint(input, upper.choices, kystvand_id, caps) or upper.choices

    def solve(trade_kg: float, hint: dict[str, str] | None) -> QuotaPoint:
        points[trade_kg] = attempt(trade_kg, hint)
        return points[trade_kg]

    def can_solve() -> bool:
        return solves < max_solves and not _out_of_time()

    # Top: the udledning the farm would use with no cap in this opland. Solved
    # without a hint: its optimum is far from the capped solution, and starting
    # there kept CP-SAT near it (562,874 after 10 s on a real farm, against
    # 567,260 proven optimal in 4 s without the hint).
    progress = progress or QuotaProgress([])
    progress.start("uncapped", kystvand_id, total=1)
    solves += 1
    free = solver(with_trades(input, {kystvand_id: None}), None)
    progress.solved("uncapped", kystvand_id)
    progress.finish("uncapped", kystvand_id)
    unconstrained_trade_kg = 0.0
    if free.status in FEASIBLE:
        free_load = kvotegivende_n_load_by_year(input, _choices(free), kystvand_id)
        excess = max(free_load[y] - base_caps[y] for y in capped)
        unconstrained_trade_kg = float(math.ceil(excess)) if excess > 0 else 0.0

    # The trades are cut where buying adds nothing and where the cap would drop
    # below zero.
    lowest_allowed = -min(base_caps[y] for y in capped)
    if trade_range is None:
        window_kg = float(round(window_share * -lowest_allowed))
        buying = _grid(min(window_kg, unconstrained_trade_kg), points_per_side)
        selling = _grid(max(-window_kg, lowest_allowed), points_per_side)
    else:
        buying, selling = _cut_to_limits(
            trade_range.trades(), unconstrained_trade_kg, lowest_allowed
        )
    if max_solves is None:
        max_solves = 1 + len(buying) + 2 * len(selling) + MAX_SELLING_LIMIT_SOLVES

    # Buying side, each point hinted with the one below it, whose solution
    # always fits the larger cap.
    hint = base.choices
    progress.start("buying", kystvand_id, total=len(buying))
    for trade in buying:
        if trade == unconstrained_trade_kg:
            # The uncapped solution meets the cap raised by exactly this much.
            points[trade] = _point(input, kystvand_id, trade, free)
            progress.solved("buying", kystvand_id)
            break
        if not can_solve():
            break
        point = solve(trade, hint)
        progress.solved("buying", kystvand_id)
        if point.feasible:
            hint = point.choices
    progress.finish("buying", kystvand_id)

    # Selling side, outwards until the window ends or the model is proven
    # infeasible. A point without any solution in time (UNKNOWN) is not proof,
    # so selling continues past it.
    upper = points[0.0]
    progress.start("selling", kystvand_id, total=len(selling))
    for trade in selling:
        if not can_solve():
            break
        point = solve(trade, selling_hint(trade, upper))
        progress.solved("selling", kystvand_id)
        if point.status == "INFEASIBLE":
            break
        if point.feasible:
            upper = point
    progress.finish("selling", kystvand_id)

    # Infeasibility inside the window is where the curve ends: the step into it
    # is bisected so the selling limit is located within min_step_kg. Midpoints
    # are hinted with the feasible point above, repaired to the midpoint's cap.
    progress.start("selling_limit", kystvand_id)
    while can_solve():
        interval = _selling_limit_interval(points, min_step_kg)
        if interval is None:
            break
        low, high = interval
        middle = _midpoint(low, high, min_step_kg)
        solve(middle, selling_hint(middle, points[high]))
        progress.solved("selling_limit", kystvand_id)

    # Going back up, the solution below always fits, so a selling point the
    # solver did not finish (not OPTIMAL) is solved again from it and keeps the
    # better of the two answers.
    below = None
    for trade in sorted(t for t in points if t < 0):
        current = points[trade]
        if below is not None and current.status != "OPTIMAL" and can_solve():
            again = attempt(trade, below.choices)
            progress.solved("selling_limit", kystvand_id)
            if again.feasible and (not current.feasible or again.db2 > current.db2):
                points[trade] = current = again
        if current.feasible:
            below = current
    progress.finish("selling_limit", kystvand_id)
    _monotone_envelope(points, input, kystvand_id)

    return QuotaCurve(
        kystvand_id=kystvand_id,
        base_cap_by_year=base_caps,
        points=tuple(points[t] for t in sorted(points)),
        unconstrained_trade_kg=unconstrained_trade_kg,
        solves=solves,
    )


def _monotone_envelope(
    points: dict[float, QuotaPoint], input: YearlyOptimizationInput, kystvand_id: int
) -> None:
    """Lift every point to the best solution found for any smaller trade.

    More kvote can never lower V(t): a solution for a smaller trade also meets
    the larger cap. So when the solver returned less (or nothing) within its
    time limit, that smaller trade's solution is used, and recorded as such.

    For the same reason V(t) can never exceed a larger trade's proven upper
    bound, so every point's bound is lowered to the smallest one above it.
    """
    best: QuotaPoint | None = None
    for trade in sorted(points):
        point = points[trade]
        if best is not None and (not point.feasible or point.db2 < best.db2):
            points[trade] = point = replace(
                best,
                trade_kg=trade,
                status="FEASIBLE",
                cap_by_year=_traded_caps(_caps(input, kystvand_id), trade),
                solution_from_trade_kg=best.solution_from_trade_kg
                if best.solution_from_trade_kg is not None
                else best.trade_kg,
                db2_upper_bound=point.db2_upper_bound,
            )
        if point.feasible and (best is None or point.db2 >= best.db2):
            best = point

    lowest_bound: float | None = None
    for trade in sorted(points, reverse=True):
        point = points[trade]
        bounds = [b for b in (point.db2_upper_bound, lowest_bound) if b is not None]
        if point.status == "INFEASIBLE" or not bounds:
            continue
        lowest_bound = min(bounds)
        if point.feasible:
            # The bound is computed on the model's rounded coefficients, so it
            # can fall a fraction of a krone below the solution's exact value.
            lowest_bound = max(lowest_bound, point.db2)
        points[trade] = replace(point, db2_upper_bound=lowest_bound)


def _midpoint(low: float, high: float, min_step_kg: float) -> float:
    """A multiple of min_step_kg above low, as close to the middle as possible.

    Only called for intervals wider than min_step_kg, so the result is always
    strictly between low and high.
    """
    steps = max(1, math.floor((high - low) / min_step_kg / 2))
    return low + steps * min_step_kg


def _grid(end_kg: float, count: int) -> list[float]:
    """count evenly spaced trades from 0 (left out) to end_kg, nearest 0 first.

    Rounded to whole kg, except end_kg itself, which may be a limit of t.
    """
    trades = [float(round(end_kg * i / count)) for i in range(1, count)] + [end_kg]
    return sorted({t for t in trades if t != 0}, key=abs)


def _cut_to_limits(
    trades: list[float], highest: float, lowest: float
) -> tuple[list[float], list[float]]:
    """Buying and selling trades of a chosen range, nearest no trade first.

    Trades beyond a limit are dropped, and the limit itself takes their place:
    buying more than the uncapped udledning adds nothing, and the cap cannot
    drop below zero.
    """
    buying = [t for t in trades if 0 < t < highest]
    if highest > 0 and any(t >= highest for t in trades):
        buying.append(highest)
    selling = sorted((t for t in trades if lowest < t < 0), key=abs)
    if any(t <= lowest for t in trades):
        selling.append(lowest)
    return buying, selling


def _selling_limit_interval(
    points: dict[float, QuotaPoint], min_step_kg: float
) -> tuple[float, float] | None:
    """The step from the lowest feasible trade down to a proven infeasible one."""
    feasible = [t for t, p in points.items() if p.feasible]
    below = [t for t in points if feasible and t < min(feasible)]
    if not below:
        return None
    low, high = max(below), min(feasible)
    if points[low].status != "INFEASIBLE" or high - low <= min_step_kg:
        return None
    return low, high


def gain(point: QuotaPoint, base: QuotaPoint, price_kr_per_kg: float) -> float:
    """V(t) - p * t - V(0): the yearly gain of this trade over not trading."""
    return point.db2 - price_kr_per_kg * point.trade_kg - base.db2


def best_trade(curve: QuotaCurve, base: QuotaPoint, price_kr_per_kg: float) -> QuotaPoint:
    """The feasible point with the highest gain; ties go to the smaller trade."""
    feasible = [p for p in curve.points if p.feasible]
    return max(feasible, key=lambda p: (gain(p, base, price_kr_per_kg), -abs(p.trade_kg)))


def interaction_check(
    input: YearlyOptimizationInput,
    curves: tuple[QuotaCurve, ...],
    base: QuotaPoint,
    price_kr_per_kg: float,
    *,
    solver: Solver = solve_yearly,
    progress: QuotaProgress | None = None,
) -> QuotaInteraction | None:
    """Apply every opland's own best trade together and compare the gains.

    Oplande share farm-wide constraints (FEN, crop areas, DB2 swing), so the
    value of kvote in one can depend on the other. Only meaningful when at
    least two oplande would trade.
    """
    best = {curve.kystvand_id: best_trade(curve, base, price_kr_per_kg) for curve in curves}
    trades = {k: p.trade_kg for k, p in best.items() if p.trade_kg != 0}
    progress = progress or QuotaProgress([])
    if len(trades) < 2 or _out_of_time():
        progress.finish("interaction")
        return None
    progress.start("interaction", total=1)
    separate_gain = sum(gain(best[k], base, price_kr_per_kg) for k in trades)
    hint = dict(base.choices)
    for k in trades:
        hint.update(best[k].choices)
    output = solver(with_trades(input, trades), hint)
    progress.solved("interaction")
    progress.finish("interaction")
    combined_gain = (
        output.total_db2 - price_kr_per_kg * sum(trades.values()) - base.db2
        if output.status in FEASIBLE
        else None
    )
    return QuotaInteraction(
        price_kr_per_kg=price_kr_per_kg,
        trades_kg=trades,
        separate_gain=separate_gain,
        combined_status=output.status,
        combined_gain=combined_gain,
    )


def contender_trades(curve: QuotaCurve, price_kr_per_kg: float) -> list[float]:
    """Trades that could still be the best at this price, given their ranges.

    The best found trade is proven to reach at least its V - p * t; any other
    point whose upper bound - p * t exceeds that might be better. V(0) is the
    same in every comparison, so its own uncertainty does not matter here.
    Empty when the best trade is already proven best.
    """
    feasible = [p for p in curve.points if p.feasible]
    if not feasible:
        return []
    # As best_trade, without V(0): ties go to the smaller trade.
    best = max(feasible, key=lambda p: (p.db2 - price_kr_per_kg * p.trade_kg, -abs(p.trade_kg)))
    proven = best.db2 - price_kr_per_kg * best.trade_kg

    def upper(point: QuotaPoint) -> float:
        bound = math.inf if point.db2_upper_bound is None else point.db2_upper_bound
        return bound - price_kr_per_kg * point.trade_kg

    others = [p.trade_kg for p in feasible if p is not best and upper(p) > proven]
    return sorted([best.trade_kg, *others]) if others else []


def _merged(old: QuotaPoint, new: QuotaPoint) -> QuotaPoint:
    """The better solution of two solves of one trade, with the tighter bound."""
    bounds = [b for b in (old.db2_upper_bound, new.db2_upper_bound) if b is not None]
    better = new if new.feasible and (not old.feasible or new.db2 > old.db2) else old
    return replace(better, db2_upper_bound=min(bounds) if bounds else None)


def _refine_contenders(
    input: YearlyOptimizationInput,
    base: QuotaPoint,
    curves: tuple[QuotaCurve, ...],
    price_kr_per_kg: float,
    *,
    solver: Solver,
    new_solver: Callable[[], Solver],
    workers: int,
    selling_time_limit_seconds: float | None,
    progress: QuotaProgress,
) -> tuple[QuotaPoint, tuple[QuotaCurve, ...]]:
    """Solve the contender points again with input's tighter gap.

    Each solve starts from the point's own solution, which already meets its
    cap. The no-trade point is shared by every opland, so it is solved once.
    The solves are independent of each other, so up to workers run at once.
    """

    def solve_again(solver: Solver, kystvand_id: int, old: QuotaPoint) -> QuotaPoint | None:
        if _out_of_time():
            return None
        limit = input.time_limit_seconds
        if old.trade_kg < 0 and selling_time_limit_seconds is not None:
            limit = selling_time_limit_seconds
        trade_input = replace(
            with_trades(input, {kystvand_id: old.trade_kg}),
            time_limit_seconds=_within_job_time(limit),
        )
        output = solver(trade_input, old.choices or None)
        progress.solved("refinement")
        return _merged(old, _point(input, kystvand_id, old.trade_kg, output))

    contenders = {curve.kystvand_id: contender_trades(curve, price_kr_per_kg) for curve in curves}
    points_by_opland = {
        curve.kystvand_id: {p.trade_kg: p for p in curve.points} for curve in curves
    }
    # (opland, trade) per solve; the no-trade point once, under the first opland.
    planned = [(k, t) for k, trades in contenders.items() for t in trades if t != 0]
    if any(0.0 in trades for trades in contenders.values()):
        planned.insert(0, (curves[0].kystvand_id, 0.0))
    progress.start("refinement", total=len(planned))

    def job(kystvand_id: int, old: QuotaPoint) -> Callable[[Solver], QuotaPoint | None]:
        return lambda solver: solve_again(solver, kystvand_id, old)

    jobs = [job(k, base if t == 0 else points_by_opland[k][t]) for k, t in planned]
    results = dict(zip(planned, _in_parallel(jobs, workers, solver, new_solver), strict=True))

    base_again = next((r for (_, t), r in results.items() if t == 0 and r is not None), None)
    if base_again is not None:
        base = base_again
    refined = []
    for curve in curves:
        k = curve.kystvand_id
        points = points_by_opland[k]
        solves = 0
        if base_again is not None:
            points[0.0] = _merged(
                points[0.0],
                replace(
                    base,
                    n_load_by_year=kvotegivende_n_load_by_year(input, base.choices, k),
                    cap_by_year=_caps(input, k),
                ),
            )
        for (opland, trade), point in results.items():
            if opland == k and trade != 0 and point is not None:
                points[trade] = point
                solves += 1
        if base_again is not None or solves:
            _monotone_envelope(points, input, k)
        refined.append(
            replace(
                curve,
                points=tuple(points[t] for t in sorted(points)),
                solves=curve.solves + solves,
            )
        )
    progress.finish("refinement")
    return base, tuple(refined)


def _in_parallel[T](
    jobs: list[Callable[[Solver], T]],
    workers: int,
    solver: Solver,
    new_solver: Callable[[], Solver],
) -> list[T]:
    """Run each job with a solver, up to workers at once; results in job order.

    With one worker (or job) everything runs on the calling thread with solver.
    Otherwise every pool thread gets its own solver from new_solver (a model
    copy: a model is changed by each solve) and starts from a copy of the
    caller's context, so the job's deadline (remaining_time) holds there too.
    """
    workers = min(workers, len(jobs))
    if workers <= 1:
        return [job(solver) for job in jobs]
    local = threading.local()

    def run(job: Callable[[Solver], T]) -> T:
        if not hasattr(local, "solver"):
            local.solver = new_solver()
        return job(local.solver)

    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="quota-solve") as pool:
        futures = [pool.submit(contextvars.copy_context().run, run, job) for job in jobs]
        return [future.result() for future in futures]


def _model_solver(model: YearlyModel) -> Solver:
    def solve(trade_input: YearlyOptimizationInput, hint: dict[str, str] | None):
        return model.solve(
            trade_input.constraints.max_n_load_by_kystvandopland_and_year,
            trade_input.time_limit_seconds,
            hint,
            trade_input.relative_gap_limit,
        )

    return solve


class BaseNotSolvedError(Exception):
    """The model without trade has no solution: INFEASIBLE, or UNKNOWN in time."""

    def __init__(self, status: str):
        super().__init__(status)
        self.status = status


def analyse_quota_value(
    input: YearlyOptimizationInput,
    price_kr_per_kg: float,
    *,
    base_hint: dict[str, str] | None = None,
    solver: Solver | None = None,
    selling_time_limit_seconds: float | None = None,
    point_gap: float = POINT_GAP,
    refined_gap: float = REFINED_GAP,
    on_progress: Callable[[list[dict]], None] | None = None,
    trade_range: QuotaTradeRange | None = None,
    parallel_solves: int = 1,
) -> QuotaValueAnalysis:
    """V(t) for every tradable opland plus the interaction check at the given price.

    The CP-SAT model is built once and only its caps change between solves,
    unless a solver is passed (as tests do). Raises BaseNotSolvedError when the
    model without trade (t = 0 everywhere) has no solution. on_progress gets
    QuotaProgress's steps after every change.

    Up to parallel_solves curves, and then refinement solves, run at the same
    time, each on its own copy of the model; a passed solver is shared and must
    allow that. Each
    solve uses its own CP-SAT threads (OPTIMIZER_SOLVER_THREADS), so the
    caller keeps the product within the cores the job may use.
    """
    input = replace(input, relative_gap_limit=point_gap)
    oplande = tradable_kystvandoplande(input)
    progress = QuotaProgress(oplande, on_progress)
    if solver is None:
        model = YearlyModel(input)
        solver = _model_solver(model)

        def curve_solver() -> Solver:
            return _model_solver(model.copy())
    else:
        shared = solver

        def curve_solver() -> Solver:
            return shared

    progress.start("base", total=1)
    base_output = solver(input, base_hint)
    progress.solved("base")
    progress.finish("base")
    if base_output.status not in FEASIBLE:
        raise BaseNotSolvedError(base_output.status)
    base = _point(input, oplande[0], 0.0, base_output) if oplande else None
    if base is None:
        return QuotaValueAnalysis(
            base=QuotaPoint(0.0, base_output.status, base_output.total_db2, (), (), (), {}),
            curves=(),
            interaction=None,
        )

    def curve(k: int, curve_solver: Solver) -> QuotaCurve:
        return quota_value_curve(
            input,
            k,
            replace(
                base,
                n_load_by_year=kvotegivende_n_load_by_year(input, base.choices, k),
                cap_by_year=_caps(input, k),
            ),
            solver=curve_solver,
            selling_time_limit_seconds=selling_time_limit_seconds,
            progress=progress,
            trade_range=trade_range,
        )

    curves = tuple(
        _in_parallel(
            [lambda solver, k=k: curve(k, solver) for k in oplande],
            parallel_solves,
            solver,
            curve_solver,
        )
    )
    base, curves = _refine_contenders(
        replace(input, relative_gap_limit=refined_gap),
        base,
        curves,
        price_kr_per_kg,
        solver=solver,
        new_solver=curve_solver,
        workers=parallel_solves,
        selling_time_limit_seconds=selling_time_limit_seconds,
        progress=progress,
    )
    return QuotaValueAnalysis(
        base=base,
        curves=curves,
        interaction=interaction_check(
            input, curves, base, price_kr_per_kg, solver=solver, progress=progress
        ),
    )
