"""The økologisk arealstøtte's ceiling on the farm's average utilised N per ha harmoniareal."""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://dst2:dst2@localhost:5432/dst2",
)

from app.domain.field import FieldRecord
from app.domain.optimization import NUM_YEARS
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    RotationCandidateYearResult,
    RotationYear,
    SimulationFieldCandidates,
)
from app.domain.simulation import GodningSettings, OptimizationConstraints
from app.services.scenario import candidate_evaluator
from plantperform_fargate import orchestrator, preparation
from plantperform_fargate.engine import solve
from plantperform_fargate.models import (
    ConstraintsInput,
    FieldInput,
    FixedFieldContribution,
    FixedYearlyFieldContribution,
    OptimizationInput,
    RotationOption,
    YearlyConstraintsInput,
    YearlyFieldInput,
    YearlyOptimizationInput,
    YearlyRotationOption,
)
from plantperform_fargate.yearly_engine import solve_yearly

# The marks below have 10 ha each, so 1,070 kg N is exactly 107 kg N/ha.
CEILING = 107


def option(key, db2, n, area=10.0):
    """One option: the mark's kg utilised N and ha harmoniareal, in each year.

    ``n`` is one value for every year, or a value per year.
    """
    n_by_year = n if isinstance(n, tuple) else (n,) * NUM_YEARS
    return key, db2, n_by_year, (area,) * NUM_YEARS


def average(values):
    return sum(values) / len(values)


def run(yearly, marks, ceiling, locked=()):
    """Solve for marks (a list of options each) and locked (kg N, ha harmoniareal) marks."""
    zeros = (0.0,) * NUM_YEARS
    if yearly:
        return solve_yearly(
            YearlyOptimizationInput(
                fields=tuple(
                    YearlyFieldInput(
                        id=f"mark{index}",
                        area_ha=10,
                        kystvand_id=None,
                        options=tuple(
                            YearlyRotationOption(
                                key=key,
                                id=key,
                                candidate=None,
                                years=(),
                                db2_by_year=(db2,) * NUM_YEARS,
                                n_load_by_year=zeros,
                                leaching_by_year=zeros,
                                fen=0,
                                fen_by_year=zeros,
                                udnyttet_n_by_year=n_by_year,
                                harmoni_area_by_year=area_by_year,
                            )
                            for key, db2, n_by_year, area_by_year in options
                        ),
                    )
                    for index, options in enumerate(marks)
                ),
                fixed_fields=tuple(
                    FixedYearlyFieldContribution(
                        kystvand_id=None,
                        db2_by_year=zeros,
                        n_load_by_year=zeros,
                        leaching_by_year=zeros,
                        fen=0,
                        fen_by_year=zeros,
                        udnyttet_n_by_year=(n,) * NUM_YEARS,
                        harmoni_area_by_year=(area,) * NUM_YEARS,
                    )
                    for n, area in locked
                ),
                constraints=YearlyConstraintsInput(
                    max_n_load_by_kystvandopland_and_year={},
                    db2_swing_pct=None,
                    min_fen=None,
                    max_fen=None,
                    max_udnyttet_n_per_harmoni_ha=ceiling,
                ),
                time_limit_seconds=5,
            )
        )
    return solve(
        OptimizationInput(
            fields=tuple(
                FieldInput(
                    id=f"mark{index}",
                    area_ha=10,
                    kystvand_id=None,
                    options=tuple(
                        RotationOption(
                            key=key,
                            id=key,
                            years=(),
                            db2=db2,
                            n_load=0,
                            leaching=0,
                            fen=0,
                            udnyttet_n=average(n_by_year),
                            harmoni_area_ha=average(area_by_year),
                        )
                        for key, db2, n_by_year, area_by_year in options
                    ),
                )
                for index, options in enumerate(marks)
            ),
            fixed_fields=tuple(
                FixedFieldContribution(
                    kystvand_id=None,
                    db2=0,
                    n_load=0,
                    leaching=0,
                    fen=0,
                    udnyttet_n=n,
                    harmoni_area_ha=area,
                )
                for n, area in locked
            ),
            constraints=ConstraintsInput(
                max_n_load_by_kystvandopland={},
                min_fen=None,
                max_fen=None,
                max_udnyttet_n_per_harmoni_ha=ceiling,
            ),
            time_limit_seconds=5,
        )
    )


def chosen(output):
    return sorted(assignment.rotation_id for assignment in output.assignments)


class CeilingConstraintTest(unittest.TestCase):
    def test_one_mark_may_exceed_the_ceiling_while_the_farm_average_stays_under_it(self):
        # 150 kg N/ha on one mark and 50 on the other average 100 kg N/ha.
        marks = [[option("high", 1000, 1500), option("low", 100, 500)]] * 2
        for yearly in (False, True):
            with self.subTest(yearly=yearly):
                output = run(yearly, marks, CEILING)
                self.assertEqual(output.status, "OPTIMAL")
                self.assertEqual(chosen(output), ["high", "low"])
                self.assertEqual(output.total_db2, 1100)

    def test_a_farm_without_a_ceiling_is_left_to_db2(self):
        marks = [[option("high", 1000, 1500), option("low", 100, 500)]] * 2
        for yearly in (False, True):
            with self.subTest(yearly=yearly):
                self.assertEqual(chosen(run(yearly, marks, None)), ["high", "high"])

    def test_the_stricter_ceiling_leaves_both_marks_on_the_low_option(self):
        marks = [[option("high", 1000, 1500), option("low", 100, 500)]] * 2
        for yearly in (False, True):
            with self.subTest(yearly=yearly):
                self.assertEqual(chosen(run(yearly, marks, 65)), ["low", "low"])
                self.assertEqual(run(yearly, marks, 45).status, "INFEASIBLE")

    def test_only_harmoniareal_counts_in_the_denominator(self):
        # The second mark's 10 ha are not harmoniareal, so they do not dilute the
        # 110 kg N/ha of the first mark, and any N they get still counts.
        for yearly in (False, True):
            with self.subTest(yearly=yearly):
                outside = [option("outside", 0, 0, area=0)]
                self.assertEqual(
                    run(yearly, [[option("grain", 100, 1100)], outside], 107).status, "INFEASIBLE"
                )
                self.assertEqual(
                    run(yearly, [[option("grain", 100, 1000)], outside], 107).status, "OPTIMAL"
                )
                fertilised = [option("outside", 0, 500, area=0)]
                self.assertEqual(
                    run(yearly, [[option("grain", 100, 1000)], fertilised], 107).status,
                    "INFEASIBLE",
                )

    def test_the_ceiling_itself_is_allowed_but_nothing_above_it(self):
        for yearly in (False, True):
            with self.subTest(yearly=yearly):
                self.assertEqual(
                    run(yearly, [[option("at", 100, 1070)]], CEILING).status, "OPTIMAL"
                )
                self.assertEqual(
                    run(yearly, [[option("over", 100, 1070.1)]], CEILING).status, "INFEASIBLE"
                )
                # 107 * 3.3 is not exactly 353.1 in floating point.
                at_ceiling = option("float", 100, 353.1, area=3.3)
                self.assertEqual(run(yearly, [[at_ceiling]], CEILING).status, "OPTIMAL")

    def test_a_mark_without_harmoniareal_or_n_leaves_the_ceiling_open(self):
        for yearly in (False, True):
            with self.subTest(yearly=yearly):
                self.assertEqual(
                    run(yearly, [[option("fallow", 100, 0, area=0)]], 65).status, "OPTIMAL"
                )

    def test_locked_marks_count_toward_the_average(self):
        marks = [[option("high", 1000, 1500), option("low", 100, 500)]]
        for yearly in (False, True):
            with self.subTest(yearly=yearly):
                # 150 kg N/ha on the locked mark leaves room for 50, not for 150.
                output = run(yearly, marks, CEILING, locked=[(1500, 10)])
                self.assertEqual(output.status, "OPTIMAL")
                self.assertEqual(chosen(output), ["low"])
                self.assertEqual(
                    run(yearly, marks, CEILING, locked=[(2500, 10)]).status, "INFEASIBLE"
                )

    def test_the_period_engine_averages_the_cycle_but_the_yearly_engine_holds_each_year(self):
        # 300 kg N/ha in the third year, 50 in the others: 81 kg N/ha on average.
        peak = (500, 500, 3000, 500, 500, 500, 500, 500)
        marks = [[option("peak", 1000, peak), option("flat", 100, 1000)]]
        self.assertEqual(chosen(run(False, marks, CEILING)), ["peak"])
        self.assertEqual(chosen(run(True, marks, CEILING)), ["flat"])

    def test_the_yearly_engine_holds_the_farm_total_in_every_year(self):
        first_year = (1500,) + (500,) * (NUM_YEARS - 1)
        second_year = (500, 1500) + (500,) * (NUM_YEARS - 2)
        flat = option("flat", 100, 500)
        # Two peaks in the same year put the farm at 150 kg N/ha that year, whatever
        # the rest of the cycle looks like; in different years they stay at 100.
        together = [[option("peak", 1000, first_year), flat]] * 2
        staggered = [
            [option("peak", 1000, first_year), flat],
            [option("peak", 1000, second_year), flat],
        ]
        self.assertEqual(chosen(run(True, together, CEILING)), ["flat", "peak"])
        self.assertEqual(chosen(run(True, staggered, CEILING)), ["peak", "peak"])
        self.assertEqual(chosen(run(False, together, CEILING)), ["peak", "peak"])


class LowestAverageTest(unittest.TestCase):
    @staticmethod
    def candidate_option(n, area):
        return RotationOption(str(n), str(n), (), 0, 0, 0, 0, udnyttet_n=n, harmoni_area_ha=area)

    def test_the_lowest_average_is_not_always_the_pick_with_the_least_n(self):
        x, y = self.candidate_option(120, 10), self.candidate_option(200, 20)
        z = self.candidate_option(50, 5)
        fields = [FieldInput("a", 10, None, (x, y)), FieldInput("b", 5, None, (z,))]
        # x with z is 170 kg over 15 ha; y with z is 250 kg over 25 ha.
        self.assertAlmostEqual(orchestrator._lowest_udnyttet_n_per_harmoni_ha(fields, [])[None], 10)
        locked = [FixedFieldContribution(None, 0, 0, 0, 0, udnyttet_n=130, harmoni_area_ha=10)]
        self.assertAlmostEqual(
            orchestrator._lowest_udnyttet_n_per_harmoni_ha(fields, locked)[None], 380 / 35
        )

    def test_there_is_no_average_without_harmoniareal_unless_there_is_no_n_either(self):
        fertilised = FieldInput("a", 10, None, (self.candidate_option(100, 0),))
        self.assertEqual(
            orchestrator._lowest_udnyttet_n_per_harmoni_ha([fertilised], []), {None: None}
        )
        bare = FieldInput("a", 10, None, (self.candidate_option(0, 0),))
        self.assertEqual(orchestrator._lowest_udnyttet_n_per_harmoni_ha([bare], []), {None: 0})

    def test_each_year_has_its_own_lowest_average(self):
        def yearly_option(key, n_by_year):
            return YearlyRotationOption(
                key=key,
                id=key,
                candidate=None,
                years=(),
                db2_by_year=(),
                n_load_by_year=(),
                leaching_by_year=(),
                fen=0,
                fen_by_year=(),
                udnyttet_n_by_year=n_by_year,
                harmoni_area_by_year=(10.0,) * NUM_YEARS,
            )

        first_year_high = (1500,) + (500,) * (NUM_YEARS - 1)
        options = (yearly_option("a", first_year_high), yearly_option("b", (1000,) * NUM_YEARS))
        field = YearlyFieldInput("a", 10, None, options)
        lowest = orchestrator._lowest_udnyttet_n_per_harmoni_ha_by_year([field], [])
        self.assertEqual(list(lowest), list(range(NUM_YEARS)))
        self.assertAlmostEqual(lowest[0], 100)
        self.assertTrue(all(abs(lowest[year] - 50) < 1e-9 for year in range(1, NUM_YEARS)))


class ShortfallErrorTest(unittest.TestCase):
    def test_names_the_lowest_possible_average_rounded_up(self):
        self.assertEqual(
            str(orchestrator._n_ceiling_shortfall_error(107, {None: 112.31})),
            "Med de valgte sædskifter og N-normer kan bedriftens gennemsnit af udnyttet N ikke "
            "komme under grænsen på 107 kg N pr. ha harmoniareal (laveste mulige: 112,4 kg N). "
            "Vælg flere N-norm-niveauer under 100 % eller flere sædskifter.",
        )

    def test_the_reduced_ceiling_also_points_to_the_basic_one(self):
        self.assertEqual(
            str(orchestrator._n_ceiling_shortfall_error(65, {None: 79.5})),
            "Med de valgte sædskifter og N-normer kan bedriftens gennemsnit af udnyttet N ikke "
            "komme under grænsen på 65 kg N pr. ha harmoniareal (laveste mulige: 79,5 kg N). "
            "Vælg flere N-norm-niveauer under 100 %, flere sædskifter eller grænsen på 107 kg N.",
        )

    def test_names_each_year_over_the_ceiling(self):
        lowest = {0: 90.0, 1: None, 2: 120.04, 3: 107.0, 4: 130.0}
        self.assertIn(
            "harmoniareal i 2029 (laveste mulige: 120,1 kg N) "
            "og i 2031 (laveste mulige: 130,0 kg N).",
            str(orchestrator._n_ceiling_shortfall_error(107, lowest)),
        )

    def test_stays_silent_when_every_average_can_meet_the_ceiling(self):
        self.assertIsNone(orchestrator._n_ceiling_shortfall_error(107, {None: 107.0}))
        self.assertIsNone(orchestrator._n_ceiling_shortfall_error(107, {0: 80.0, 1: None}))


HARMONI_CODES = {1, 3}


def evaluation(key, codes, n_by_code, db_kr_ha=0.0):
    """A candidate cycling through codes; n_by_code maps a code to (husdyr, handels) kg N/ha."""
    return RotationCandidateEvaluation(
        ref=RotationCandidateRef(saedskiftevariant=key, variant="1", n_norm_pct="100"),
        active_len=len(codes),
        years=[
            RotationCandidateYearResult(
                year=RotationYear(afgrode_kode=code, afgrode_navn=str(code)),
                leaching_kg_n_ha=0,
                leaching_detail={},
                db_kr_ha=db_kr_ha,
                db_detail={},
                tildelt_husdyrgodning_udnyttet_kgn_ha=n_by_code[code][0],
                tildelt_handelsgodning_kgn_ha=n_by_code[code][1],
                husdyrgodning_organisk_bundet_kgn_ha=99,
            )
            for code in (codes * NUM_YEARS)[:NUM_YEARS]
        ],
        avg_leaching_kg_n_ha=0,
        avg_db_kr_ha=db_kr_ha,
        avg_fen=0,
    )


class HarmoniStubTest(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(
            orchestrator.afgroede_normer, "is_harmoniareal", side_effect=HARMONI_CODES.__contains__
        )
        patcher.start()
        self.addCleanup(patcher.stop)


class OptionInputsTest(HarmoniStubTest):
    def setUp(self):
        super().setUp()
        # Harmoniareal code 1 gets 70 kg N/ha, then code 2, which is not, gets 10.
        self.candidate = evaluation("cycle", (1, 2), {1: (40, 30), 2: (10, 0)})
        self.field = SimpleNamespace(
            area_ha=4,
            retention=None,
            kystvand_id=None,
            db2=0,
            n_load=0,
            leaching=0,
            fen=0,
            kvotegivende=False,
            rotation_id=self.candidate.ref.to_id(),
            allowed_rotation_ids=[self.candidate.ref.to_id()],
        )

    def test_options_carry_the_cycle_average_of_the_whole_mark_when_asked(self):
        (asked,) = orchestrator._build_options(self.field, [self.candidate], with_udnyttet_n=True)
        self.assertEqual((asked.udnyttet_n, asked.harmoni_area_ha), (160, 2))
        (default,) = orchestrator._build_options(self.field, [self.candidate])
        self.assertEqual((default.udnyttet_n, default.harmoni_area_ha), (0, 0))

    def test_locked_marks_carry_their_selected_candidates_n_when_asked(self):
        asked = orchestrator._locked_field_contribution(
            self.field, self.candidate, with_udnyttet_n=True
        )
        self.assertEqual((asked.udnyttet_n, asked.harmoni_area_ha), (160, 2))
        for locked in (
            orchestrator._locked_field_contribution(self.field, self.candidate),
            orchestrator._locked_field_contribution(self.field, None, with_udnyttet_n=True),
        ):
            self.assertEqual((locked.udnyttet_n, locked.harmoni_area_ha), (0, 0))

    def test_locked_marks_carry_the_n_of_each_year_when_asked(self):
        asked = orchestrator._locked_yearly_field_contribution(
            self.field, [self.candidate], with_udnyttet_n=True
        )
        self.assertEqual(asked.udnyttet_n_by_year, (280, 40) * (NUM_YEARS // 2))
        self.assertEqual(asked.harmoni_area_by_year, (4, 0) * (NUM_YEARS // 2))
        default = orchestrator._locked_yearly_field_contribution(self.field, [self.candidate])
        self.assertEqual((default.udnyttet_n_by_year, default.harmoni_area_by_year), ((), ()))


class CompactCandidatesTest(HarmoniStubTest):
    """The compact input the worker solves on has the utilised N only for a farm with a ceiling."""

    def setUp(self):
        super().setUp()
        self.full = SimulationFieldCandidates(
            field_id="mark",
            jbnr=1,
            candidates=[evaluation("cycle", (1, 2), {1: (40, 30), 2: (10, 0)})],
        )

    def compact(self, **godning):
        simulation = SimpleNamespace(godning=GodningSettings(**godning))
        return preparation.compact_candidates(simulation, self.full).candidates[0]

    def test_a_farm_with_a_ceiling_carries_the_utilised_n_of_each_year(self):
        candidate = self.compact(driftsform="Økologisk")
        self.assertEqual(candidate.udnyttet_n_kgn_ha_by_year, (70, 10) * (NUM_YEARS // 2))
        n_by_year, harmoni_by_year = orchestrator._udnyttet_n_and_harmoni_area_by_year(candidate, 4)
        self.assertEqual(n_by_year, (280, 40) * (NUM_YEARS // 2))
        self.assertEqual(harmoni_by_year, (4, 0) * (NUM_YEARS // 2))

    def test_the_other_farms_keep_the_input_as_it_was(self):
        candidate = self.compact(driftsform="Konventionel")
        self.assertEqual(candidate.udnyttet_n_kgn_ha_by_year, ())

    def test_a_compact_candidate_without_its_utilised_n_is_not_counted_as_zero(self):
        candidate = self.compact(driftsform="Konventionel")
        with self.assertRaises(ValueError):
            orchestrator._udnyttet_n_and_harmoni_area_by_year(candidate, 4)


class AutumnNTest(unittest.TestCase):
    """N spread the autumn before a crop counts in the year the crop is harvested.

    The ceiling is per planperiode, 1 August to 31 July, and an efterårstildeling
    is spread in the planperiode of the crop it feeds. Moving N to the autumn must
    therefore not move it between the years the ceiling is held to.
    """

    VINTERHVEDE = 11
    VINTERRAPS = 22
    NORMS = {
        VINTERHVEDE: {"n_norm": 175.0, "forfrugtsvaerdi": 0.0, "indregn_ffv": True},
        VINTERRAPS: {"n_norm": 159.0, "forfrugtsvaerdi": 0.0, "indregn_ffv": True},
    }

    def setUp(self):
        candidate_evaluator.compute_n_inputs.cache_clear()
        self.addCleanup(candidate_evaluator.compute_n_inputs.cache_clear)
        normer = candidate_evaluator.afgroede_normer
        for patcher in (
            patch.object(normer, "lookup_norm", lambda code, *args: self.NORMS.get(code)),
            patch.object(normer, "lookup_nfix", return_value=0.0),
            patch.object(normer, "lookup_crop_params", return_value={"navn": "Afgrøde"}),
            patch.object(normer, "catch_crop_preceding_crop_value", return_value=0.0),
            patch.object(
                candidate_evaluator.bridge_v2,
                "evaluate_leaching_position",
                return_value={"L_nuar": 10.0},
            ),
            patch.object(
                candidate_evaluator,
                "calculate_db",
                return_value={"db": 0.0, "udbytte": 0.0, "udbytteenhed": ""},
            ),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def utilised_n(self, org_mineral_n, plan):
        crops = [self.VINTERHVEDE, self.VINTERRAPS]
        result = candidate_evaluator.evaluate_sequence_for_mark(
            RotationCandidateRef(saedskiftevariant="test", variant="1", n_norm_pct="100"),
            [crops[index % 2] for index in range(8)],
            [None] * 8,
            [None] * 8,
            2,
            1,
            "Konventionel",
            org_mineral_n,
            70.0,
            False,
            autumn_plan=plan,
        )
        return [year.udnyttet_n_kgn_ha for year in result.years]

    def test_moving_n_to_the_autumn_does_not_change_the_n_of_any_year(self):
        norms = [175.0, 159.0] * (NUM_YEARS // 2)
        # Handelsgødning only, husdyrgødning that fits beside the autumn N, and
        # husdyrgødning that handelsgødning in the autumn leaves less room for.
        for org_mineral_n in (0.0, 50.0, 150.0):
            for manure in (False, True):
                plan = ((self.VINTERRAPS, 40.0, manure),)
                with self.subTest(org_mineral_n=org_mineral_n, manure=manure):
                    self.assertEqual(self.utilised_n(org_mineral_n, ()), norms)
                    self.assertEqual(self.utilised_n(org_mineral_n, plan), norms)


# Kg utilised N/ha as (husdyrgødning, handelsgødning), and DB per ha, of one crop in harmoniareal.
SINGLE_CROP_CANDIDATES = {
    "lean": ((0, 60), 50),
    "low": ((0, 80), 100),
    "mid": ((40, 60), 500),
    "high": ((50, 100), 1000),
}


class RunOptimizationTest(HarmoniStubTest):
    def setUp(self):
        super().setUp()
        for patcher in (
            patch.object(orchestrator.repository, "get_registry_soil_data_batch", return_value={}),
            patch.object(orchestrator, "_shift_count", return_value=1),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def snapshot(names, **godning):
        simulation = SimpleNamespace(
            godning=GodningSettings(**godning),
            # The rotation scope takes the groups from here instead of the database.
            rotation_groups={},
            constraints=OptimizationConstraints(),
            eea_fdato="",
            eea_precision_dagsbasis=False,
            praecisionsjordbrug=False,
            tidlig_saaning=False,
            mellemafgrode=False,
            economics_snapshot=SimpleNamespace(overrides=SimpleNamespace(cache_key=lambda: "")),
        )
        field = FieldRecord(
            id="mark", farm_id="farm", name="Mark", area_ha=10, db2=0, n_load=0, leaching=0
        )
        candidates = []
        for name in names:
            n, db_kr_ha = SINGLE_CROP_CANDIDATES[name]
            candidates.append(evaluation(name, (1,), {1: n}, db_kr_ha))
        row = SimulationFieldCandidates(field_id="mark", jbnr=1, candidates=candidates)
        # The worker solves on the compact input, as preparation builds it.
        return simulation, [field], [preparation.compact_candidates(simulation, row)]

    @staticmethod
    def run_with(yearly, snapshot):
        if yearly:
            return orchestrator.run_yearly_optimization(
                "farm", "sim", 5, {}, None, frozenset(), "user@example.com", snapshot
            )
        return orchestrator.run_optimization(
            "farm", "sim", 5, frozenset(), "user@example.com", snapshot
        )

    def winner(self, yearly, names=tuple(SINGLE_CROP_CANDIDATES), **godning):
        result = self.run_with(yearly, self.snapshot(names, **godning))
        return result.fields[0].rotation_id.split(":")[0]

    def test_the_chosen_ceiling_decides_which_candidate_wins(self):
        for yearly in (False, True):
            with self.subTest(yearly=yearly):
                self.assertEqual(self.winner(yearly, driftsform="Konventionel"), "high")
                self.assertEqual(self.winner(yearly, driftsform="Økologisk"), "mid")
                self.assertEqual(
                    self.winner(yearly, driftsform="Økologisk", oeko_n_loft=65), "lean"
                )

    def test_the_ceiling_is_only_for_økologisk_farms(self):
        for yearly in (False, True):
            with self.subTest(yearly=yearly):
                self.assertEqual(
                    self.winner(yearly, driftsform="Konventionel", oeko_n_loft=65), "high"
                )

    def test_a_ceiling_no_candidate_meets_names_the_lowest_possible_average(self):
        names = ("low", "mid", "high")
        for yearly in (False, True):
            with self.subTest(yearly=yearly):
                snapshot = self.snapshot(names, driftsform="Økologisk", oeko_n_loft=65)
                with self.assertRaises(orchestrator.OptimizationInfeasibleError) as raised:
                    self.run_with(yearly, snapshot)
                message = str(raised.exception)
                self.assertIn("grænsen på 65 kg N pr. ha harmoniareal", message)
                self.assertIn("(laveste mulige: 80,0 kg N)", message)
                self.assertIn("grænsen på 107 kg N", message)
                self.assertEqual("i 2027 (" in message, yearly)


if __name__ == "__main__":
    unittest.main()
