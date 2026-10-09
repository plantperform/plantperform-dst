import unittest
from types import SimpleNamespace

from app.data.optimizer_inputs import optimizer_input, parse_optimizer_input
from app.domain.optimization import NUM_YEARS
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    RotationCandidateYearResult,
    RotationYear,
    SimulationFieldCandidates,
)
from app.domain.simulation import GodningSettings
from plantperform_optimizer.models import (
    FixedYearlyFieldContribution,
    YearlyConstraintsInput,
    YearlyFieldInput,
    YearlyOptimizationInput,
    YearlyRotationOption,
)
from plantperform_optimizer.orchestrator import (
    _expand_yearly_options,
    _locked_yearly_field_contribution,
)
from plantperform_optimizer.yearly_engine import solve_yearly

GRASS, BARLEY = 252, 1
GRASS_FE_HA, BARLEY_HKG_HA = 6000.0, 60.0


def _year_result(code: int) -> RotationCandidateYearResult:
    db_detail = (
        {"udbytte": GRASS_FE_HA, "udbytteenhed": "FE/ha"}
        if code == GRASS
        else {"udbytte": BARLEY_HKG_HA, "udbytteenhed": "hkg/ha"}
    )
    return RotationCandidateYearResult(
        year=RotationYear(afgrode_kode=code, afgrode_navn=str(code)),
        leaching_kg_n_ha=0,
        leaching_detail={},
        db_kr_ha=0,
        db_detail=db_detail,
    )


def _candidate(codes: tuple[int, ...]) -> RotationCandidateEvaluation:
    repeated = (codes * NUM_YEARS)[:NUM_YEARS]
    return RotationCandidateEvaluation(
        ref=RotationCandidateRef(saedskiftevariant="1", variant="1", n_norm_pct="100"),
        active_len=len(codes),
        years=[_year_result(code) for code in repeated],
        avg_leaching_kg_n_ha=0,
        avg_db_kr_ha=0,
        avg_fen=0,
    )


def _field(area_ha: float, locked_to: RotationCandidateEvaluation | None = None):
    locked_id = locked_to.ref.to_id() if locked_to is not None else None
    return SimpleNamespace(
        id="a",
        area_ha=area_ha,
        retention=None,
        kystvand_id=None,
        kvotegivende=True,
        rotation_id=locked_id,
        allowed_rotation_ids=[locked_id] if locked_id else [],
    )


class FenByYearTests(unittest.TestCase):
    def test_locked_field_counts_foderenheder_only_in_fe_years(self) -> None:
        candidate = _candidate((GRASS, GRASS, BARLEY))
        fixed = _locked_yearly_field_contribution(_field(10, candidate), [candidate])
        grass, barley = GRASS_FE_HA * 10, 0.0
        self.assertEqual(
            fixed.fen_by_year,
            (grass, grass, barley, grass, grass, barley, grass, grass),
        )

    def test_unlocked_option_carries_one_fen_entry_per_calendar_year(self) -> None:
        # A one-year cycle has a single start year, so the stored candidate is
        # used as-is without re-evaluating it through NLES5 and the DB tables.
        options = _expand_yearly_options(
            _field(4),
            [_candidate((GRASS,))],
            jbnr=1,
            godning=GodningSettings(),
            fdato="20/8",
            precision_dagsbasis=False,
            praecisionsjordbrug=False,
            tidlig_saaning=True,
            mellemafgrode=True,
        )
        self.assertEqual(len(options), 1)
        self.assertEqual(options[0].fen_by_year, (GRASS_FE_HA * 4,) * NUM_YEARS)

    def test_compact_cached_candidates_give_the_same_fen_as_full_ones(self) -> None:
        # The worker reads compact cached candidates, which have no db_detail.
        full = _candidate((GRASS, GRASS, BARLEY))
        compact = parse_optimizer_input(
            optimizer_input(SimulationFieldCandidates(field_id="a", jbnr=1, candidates=[full]))
        ).candidates[0]
        self.assertFalse(hasattr(compact.years[0], "db_detail"))
        self.assertEqual(
            _locked_yearly_field_contribution(_field(10, compact), [compact]).fen_by_year,
            _locked_yearly_field_contribution(_field(10, full), [full]).fen_by_year,
        )
        one_year = _candidate((GRASS,))
        compact_one_year = parse_optimizer_input(
            optimizer_input(SimulationFieldCandidates(field_id="a", jbnr=1, candidates=[one_year]))
        ).candidates[0]
        options = _expand_yearly_options(
            _field(4),
            [compact_one_year],
            jbnr=1,
            godning=GodningSettings(),
            fdato="20/8",
            precision_dagsbasis=False,
            praecisionsjordbrug=False,
            tidlig_saaning=True,
            mellemafgrode=True,
        )
        self.assertEqual(options[0].fen_by_year, (GRASS_FE_HA * 4,) * NUM_YEARS)


ALTERNATING = (60_000.0, 0.0) * (NUM_YEARS // 2)
SHIFTED = (0.0, 60_000.0) * (NUM_YEARS // 2)
STEADY = (20_000.0,) * NUM_YEARS


def _option(key: str, db2: float, fen_by_year: tuple[float, ...]) -> YearlyRotationOption:
    return YearlyRotationOption(
        key=key,
        id=key,
        candidate=_candidate((GRASS,)),
        years=(),
        db2_by_year=(db2,) * NUM_YEARS,
        n_load_by_year=(0.0,) * NUM_YEARS,
        leaching_by_year=(0.0,) * NUM_YEARS,
        fen=sum(fen_by_year) / NUM_YEARS,
        fen_by_year=fen_by_year,
    )


def _locked(fen_by_year: tuple[float, ...]) -> FixedYearlyFieldContribution:
    return FixedYearlyFieldContribution(
        kystvand_id=None,
        db2_by_year=(0.0,) * NUM_YEARS,
        n_load_by_year=(0.0,) * NUM_YEARS,
        leaching_by_year=(0.0,) * NUM_YEARS,
        fen=sum(fen_by_year) / NUM_YEARS,
        fen_by_year=fen_by_year,
    )


def _solve(
    options: tuple[YearlyRotationOption, ...],
    min_fen: float | None = None,
    max_fen: float | None = None,
    fixed: tuple[FixedYearlyFieldContribution, ...] = (),
):
    return solve_yearly(
        YearlyOptimizationInput(
            fields=(YearlyFieldInput(id="a", area_ha=10, kystvand_id=None, options=options),),
            fixed_fields=fixed,
            constraints=YearlyConstraintsInput(
                max_n_load_by_kystvandopland_and_year={},
                db2_swing_pct=None,
                min_fen=min_fen,
                max_fen=max_fen,
            ),
            time_limit_seconds=5,
        )
    )


class YearlyFenBoundTests(unittest.TestCase):
    def setUp(self) -> None:
        # "alternating" earns more and averages 30,000 FE, but has no
        # foderenheder at all every other year; "steady" has 20,000 every year.
        self.options = (
            _option("alternating", 100, ALTERNATING),
            _option("steady", 50, STEADY),
        )

    def test_without_bounds_the_higher_db2_option_wins(self) -> None:
        output = _solve(self.options)
        self.assertEqual(output.status, "OPTIMAL")
        self.assertEqual(output.assignments[0].rotation_id, "alternating")

    def test_minimum_must_hold_in_every_year_not_only_on_average(self) -> None:
        output = _solve(self.options, min_fen=15_000)
        self.assertEqual(output.status, "OPTIMAL")
        self.assertEqual(output.assignments[0].rotation_id, "steady")

    def test_maximum_must_hold_in_every_year_not_only_on_average(self) -> None:
        output = _solve(self.options, max_fen=40_000)
        self.assertEqual(output.status, "OPTIMAL")
        self.assertEqual(output.assignments[0].rotation_id, "steady")

    def test_minimum_no_option_meets_in_every_year_is_infeasible(self) -> None:
        self.assertEqual(_solve(self.options, min_fen=25_000).status, "INFEASIBLE")

    def test_locked_fields_count_toward_each_years_bound(self) -> None:
        # The locked mark fills the even years, so only the shifted start
        # covers the odd ones, even though it earns less.
        options = (
            _option("start_1", 20, ALTERNATING),
            _option("start_2", 10, SHIFTED),
        )
        output = _solve(options, min_fen=30_000, fixed=(_locked(ALTERNATING),))
        self.assertEqual(output.status, "OPTIMAL")
        self.assertEqual(output.assignments[0].rotation_id, "start_2")


if __name__ == "__main__":
    unittest.main()
