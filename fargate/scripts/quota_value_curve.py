"""Print the kvote value curve ("Kvotehandel") of a local simulation.

Uses the simulation's latest completed "Års-optimering" and its parameters, the
same as the app, but only prints the result; nothing is stored.

    cd backend
    pixi run quota-value-curve <simulation-id> --price 35
    pixi run quota-value-curve <simulation-id> --price 35 --range -100 150 50
"""

import argparse
import sys

from sqlalchemy import select

from app.data.db import SessionLocal
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.data.quota_value_store import load_quota_snapshot
from app.domain.optimization import YearlyOptimizeSimulationRequest
from app.domain.quota_value import QuotaTradeRange
from app.domain.rotation_candidate import RotationCandidateEvaluation
from plantperform_fargate import quota_value
from plantperform_fargate.orchestrator import build_yearly_input
from plantperform_fargate.preparation import prepare
from plantperform_fargate.quota_value import (
    BaseNotSolvedError,
    analyse_quota_value,
    best_trade,
    gain,
    hint_from_candidates,
)
from plantperform_fargate.quota_value_worker import (
    POINT_TIME_LIMIT_SECONDS,
    SELLING_POINT_TIME_LIMIT_SECONDS,
    parallel_solves,
)
from plantperform_fargate.worker import yearly_caps


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("simulation_id")
    parser.add_argument("--price", type=float, required=True, help="kr per kg N per år")
    parser.add_argument(
        "--selling-seconds",
        type=float,
        help="time limit per selling point (default: as the app, 60 s)",
    )
    parser.add_argument(
        "--range",
        nargs=3,
        type=float,
        metavar=("MIN", "MAX", "STEP"),
        help="kg N per år to solve instead of the default window",
    )
    parser.add_argument(
        "--parallel",
        type=int,
        help="solves run at once (default: as the app, OPTIMIZER_PARALLEL_SOLVES)",
    )
    parser.add_argument(
        "--no-repair",
        action="store_true",
        help="hint selling points with the unrepaired neighbour (for comparison)",
    )
    args = parser.parse_args()
    if args.no_repair:
        quota_value.repair_hint = lambda *_: None

    with SessionLocal() as session:
        setup = session.execute(
            select(setups.c.farm_id, setups.c.revision).where(setups.c.id == args.simulation_id)
        ).first()
        base = session.execute(
            select(
                results.c.kind,
                results.c.status,
                results.c.parameters,
                results.c.result_revision,
                results.c.output["selected_candidates"],
            ).where(results.c.simulation_id == args.simulation_id)
        ).first()
    if setup is None or base is None:
        print("Simulation not found.", file=sys.stderr)
        return 1
    if (
        base.kind != "yearly"
        or base.status != "completed"
        or base.result_revision != setup.revision
    ):
        print("The simulation needs a completed, current Års-optimering.", file=sys.stderr)
        return 1

    captured = load_quota_snapshot(args.simulation_id, setup.revision)
    if captured is None:
        print("The simulation changed since its Års-optimering.", file=sys.stderr)
        return 1
    snapshot = prepare(*captured)
    request = YearlyOptimizeSimulationRequest.model_validate(base.parameters)
    built = build_yearly_input(
        setup.farm_id,
        args.simulation_id,
        POINT_TIME_LIMIT_SECONDS,
        yearly_caps(request),
        request.db2_swing_pct,
        frozenset(request.excluded_afgrodekoder),
        "",
        snapshot=snapshot,
    )
    selected = {
        field_id: RotationCandidateEvaluation.model_validate(candidate)
        for field_id, candidate in (base[4] or {}).items()
    }
    hint = hint_from_candidates(built.input, selected)
    print(f"Hint from the shown optimization: {len(hint)} of {len(built.input.fields)} marker")
    try:
        analysis = analyse_quota_value(
            built.input,
            args.price,
            base_hint=hint,
            selling_time_limit_seconds=args.selling_seconds or SELLING_POINT_TIME_LIMIT_SECONDS,
            trade_range=QuotaTradeRange(
                min_kg=args.range[0], max_kg=args.range[1], step_kg=args.range[2]
            )
            if args.range
            else None,
            parallel_solves=args.parallel or parallel_solves(),
        )
    except BaseNotSolvedError as error:
        print(f"The optimization without trade has no solution: {error.status}.", file=sys.stderr)
        return 1

    print(f"V(0) = {analysis.base.db2:,.0f} kr/år, price {args.price:g} kr/kg N")
    for curve in analysis.curves:
        print(f"\nKystvandopland {curve.kystvand_id} ({curve.solves} solves)")
        print(
            f"{'t (kg N/år)':>12} {'status':>10} {'V(t) kr/år':>12} {'øvre grænse':>12} "
            f"{'gap kr':>8} {'gap %':>7} {'gevinst':>10} {'marker':>7} {'løsning fra':>12}"
        )
        for point in curve.points:
            changed = sum(
                1 for f, key in point.choices.items() if analysis.base.choices.get(f) != key
            )
            value = f"{point.db2:,.0f}" if point.feasible else "-"
            bound = point.db2_upper_bound
            upper = f"{bound:,.0f}" if bound is not None else "-"
            gap = bound - point.db2 if bound is not None and point.feasible else None
            gap_kr = f"{gap:,.0f}" if gap is not None else "-"
            gap_pct = f"{100 * gap / point.db2:.3f}" if gap is not None and point.db2 else "-"
            net = f"{gain(point, analysis.base, args.price):,.0f}" if point.feasible else "-"
            source = (
                "" if point.solution_from_trade_kg is None else f"{point.solution_from_trade_kg:g}"
            )
            print(
                f"{point.trade_kg:>12g} {point.status:>10} {value:>12} {upper:>12} "
                f"{gap_kr:>8} {gap_pct:>7} {net:>10} {changed:>7} {source:>12}"
            )
        best = best_trade(curve, analysis.base, args.price)
        action = "køb" if best.trade_kg > 0 else "sælg" if best.trade_kg < 0 else "ingen handel"
        amount = f" {abs(best.trade_kg):g} kg N/år" if best.trade_kg else ""
        print(f"Bedst ved {args.price:g} kr/kg: {action}{amount}")
    if analysis.interaction:
        check = analysis.interaction
        combined = (
            f"{check.combined_gain:,.0f} kr/år"
            if check.combined_gain is not None
            else check.combined_status
        )
        print(f"\nSamlet kontrol: hver for sig {check.separate_gain:,.0f} kr/år, sammen {combined}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
