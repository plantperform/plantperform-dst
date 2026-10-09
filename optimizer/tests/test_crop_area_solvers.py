import unittest
from types import SimpleNamespace

from app.domain.optimization import NUM_YEARS
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    RotationCandidateYearResult,
    RotationYear,
)
from app.domain.simulation import CropAreaLimit
from app.services.scenario.rotations import selected_locked_candidate
from plantperform_optimizer.engine import solve
from plantperform_optimizer.models import (
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
from plantperform_optimizer.orchestrator import (
    _locked_field_contribution,
    _locked_yearly_field_contribution,
)
from plantperform_optimizer.yearly_engine import solve_yearly


def _year(code: int) -> RotationYear:
    return RotationYear(afgrode_kode=code, afgrode_navn=str(code))


def _candidate(key: str, codes: tuple[int, ...]) -> RotationCandidateEvaluation:
    repeated = (codes * NUM_YEARS)[:NUM_YEARS]
    return RotationCandidateEvaluation(
        ref=RotationCandidateRef(saedskiftevariant=key, variant="1", n_norm_pct="100"),
        active_len=len(codes),
        years=[
            RotationCandidateYearResult(
                year=_year(code),
                leaching_kg_n_ha=0,
                leaching_detail={},
                db_kr_ha=0,
                db_detail={},
            )
            for code in repeated
        ],
        avg_leaching_kg_n_ha=0,
        avg_db_kr_ha=0,
        avg_fen=0,
    )


def _run(
    yearly: bool,
    fields: list[tuple[str, float, list[tuple[str, tuple[int, ...], float]]]],
    limits: tuple[CropAreaLimit, ...] = (),
    fixed: tuple[tuple[float, tuple[int, ...], bool], ...] = (),
):
    if yearly:
        field_inputs = tuple(
            YearlyFieldInput(
                id=field_id,
                area_ha=area,
                kystvand_id=None,
                options=tuple(
                    YearlyRotationOption(
                        key=key,
                        id=key,
                        candidate=_candidate(key, codes),
                        years=tuple(_year(code) for code in codes),
                        db2_by_year=(db2,) * NUM_YEARS,
                        n_load_by_year=(0.0,) * NUM_YEARS,
                        leaching_by_year=(0.0,) * NUM_YEARS,
                        fen=0,
                        fen_by_year=(0.0,) * NUM_YEARS,
                    )
                    for key, codes, db2 in options
                ),
            )
            for field_id, area, options in fields
        )
        fixed_inputs = tuple(
            FixedYearlyFieldContribution(
                kystvand_id=None,
                db2_by_year=(0.0,) * NUM_YEARS,
                n_load_by_year=(0.0,) * NUM_YEARS,
                leaching_by_year=(0.0,) * NUM_YEARS,
                fen=0,
                fen_by_year=(0.0,) * NUM_YEARS,
                kvotegivende=quota_eligible,
                area_ha=area,
                crop_codes_by_year=(codes * NUM_YEARS)[:NUM_YEARS],
            )
            for area, codes, quota_eligible in fixed
        )
        return solve_yearly(
            YearlyOptimizationInput(
                fields=field_inputs,
                fixed_fields=fixed_inputs,
                constraints=YearlyConstraintsInput(
                    max_n_load_by_kystvandopland_and_year={},
                    db2_swing_pct=None,
                    min_fen=None,
                    max_fen=None,
                    crop_area_limits=limits,
                ),
                time_limit_seconds=5,
            )
        )

    field_inputs = tuple(
        FieldInput(
            id=field_id,
            area_ha=area,
            kystvand_id=None,
            options=tuple(
                RotationOption(
                    key=key,
                    id=key,
                    years=tuple(_year(code) for code in codes),
                    db2=db2,
                    n_load=0,
                    leaching=0,
                    fen=0,
                )
                for key, codes, db2 in options
            ),
        )
        for field_id, area, options in fields
    )
    fixed_inputs = tuple(
        FixedFieldContribution(
            kystvand_id=None,
            db2=0,
            n_load=0,
            leaching=0,
            fen=0,
            kvotegivende=quota_eligible,
            area_ha=area,
            crop_codes_by_year=codes,
        )
        for area, codes, quota_eligible in fixed
    )
    return solve(
        OptimizationInput(
            fields=field_inputs,
            fixed_fields=fixed_inputs,
            constraints=ConstraintsInput(
                max_n_load_by_kystvandopland={},
                min_fen=None,
                max_fen=None,
                crop_area_limits=limits,
            ),
            time_limit_seconds=5,
        )
    )


class CropAreaSolverTests(unittest.TestCase):
    def test_minimum_maximum_and_multiple_codes(self) -> None:
        fields = [
            ("a", 5, [("a1", (1,), 10), ("a2", (2,), 20)]),
            ("b", 3, [("b1", (1,), 20), ("b2", (2,), 10)]),
        ]
        limits = (
            CropAreaLimit(afgrode_kode=1, min_area_ha=5, max_area_ha=5),
            CropAreaLimit(afgrode_kode=2, min_area_ha=3, max_area_ha=3),
        )
        for yearly in (False, True):
            with self.subTest(yearly=yearly):
                output = _run(yearly, fields, limits)
                self.assertEqual(output.status, "OPTIMAL")
                self.assertEqual(
                    {assignment.rotation_id for assignment in output.assignments},
                    {"a1", "b2"},
                )

    def test_single_sided_bounds_and_no_limits(self) -> None:
        cases = (
            (CropAreaLimit(afgrode_kode=1, min_area_ha=4), "crop1"),
            (CropAreaLimit(afgrode_kode=1, max_area_ha=0), "crop2"),
        )
        for yearly in (False, True):
            fields = [("a", 4, [("crop1", (1,), 20), ("crop2", (2,), 10)])]
            with self.subTest(yearly=yearly, bounds="none"):
                self.assertEqual(_run(yearly, fields).assignments[0].rotation_id, "crop1")
            for limit, expected in cases:
                with self.subTest(yearly=yearly, bounds=limit):
                    output = _run(yearly, fields, (limit,))
                    self.assertEqual(output.status, "OPTIMAL")
                    self.assertEqual(output.assignments[0].rotation_id, expected)

    def test_impossible_bounds_are_infeasible(self) -> None:
        fields = [("a", 4, [("crop1", (1,), 10)])]
        for yearly in (False, True):
            for limit in (
                CropAreaLimit(afgrode_kode=1, min_area_ha=5),
                CropAreaLimit(afgrode_kode=1, max_area_ha=3),
            ):
                with self.subTest(yearly=yearly, bounds=limit):
                    self.assertEqual(_run(yearly, fields, (limit,)).status, "INFEASIBLE")

    def test_standard_solver_holds_the_average_over_the_period(self) -> None:
        fields = [
            ("a", 5, [("two_year", (1, 2), 10)]),
            ("b", 5, [("three_year", (2, 1, 2), 10)]),
        ]
        for min_area, status in ((4.375, "OPTIMAL"), (4.4, "INFEASIBLE")):
            with self.subTest(min_area=min_area):
                limit = CropAreaLimit(afgrode_kode=1, min_area_ha=min_area)
                self.assertEqual(_run(False, fields, (limit,)).status, status)
        yearly = _run(True, fields, (CropAreaLimit(afgrode_kode=1, min_area_ha=4.375),))
        self.assertEqual(yearly.status, "INFEASIBLE")

    def test_yearly_solver_uses_shifted_eight_year_sequences(self) -> None:
        fields = [
            ("a", 5, [("a_start_1", (1, 2), 20), ("a_start_2", (2, 1), 10)]),
            ("b", 5, [("b_start_1", (1, 2), 20), ("b_start_2", (2, 1), 10)]),
        ]
        limit = CropAreaLimit(afgrode_kode=1, min_area_ha=5, max_area_ha=5)
        output = _run(True, fields, (limit,))
        self.assertEqual(output.status, "OPTIMAL")
        self.assertEqual(
            sum(assignment.rotation_id.endswith("start_1") for assignment in output.assignments),
            1,
        )

    def test_locked_fields_count_even_when_not_quota_eligible(self) -> None:
        fields = [("free", 6, [("crop1", (1,), 20), ("crop2", (2,), 10)])]
        fixed = ((4, (1,), False),)
        limit = CropAreaLimit(afgrode_kode=1, min_area_ha=4, max_area_ha=4)
        for yearly in (False, True):
            with self.subTest(yearly=yearly):
                output = _run(yearly, fields, (limit,), fixed)
                self.assertEqual(output.status, "OPTIMAL")
                self.assertEqual(output.assignments[0].rotation_id, "crop2")

    def test_locked_fields_use_selected_candidate_crop_codes(self) -> None:
        first, selected = _candidate("first", (1,)), _candidate("selected", (2,))
        field = SimpleNamespace(
            rotation_id=selected.ref.to_id(),
            allowed_rotation_ids=[first.ref.to_id(), selected.ref.to_id()],
            kystvand_id=None,
            db2=0,
            n_load=0,
            leaching=0,
            fen=0,
            kvotegivende=False,
            area_ha=4,
            retention=None,
        )
        self.assertIs(selected_locked_candidate(field, [first, selected]), selected)
        self.assertIsNone(selected_locked_candidate(field, [first]))
        standard = _locked_field_contribution(field, selected)
        yearly = _locked_yearly_field_contribution(field, [first, selected])
        self.assertEqual(standard.crop_codes_by_year, (2,))
        self.assertEqual(yearly.crop_codes_by_year, (2,) * NUM_YEARS)
