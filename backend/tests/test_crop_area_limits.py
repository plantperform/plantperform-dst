import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from pydantic import ValidationError

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://dst2:dst2@localhost:5432/dst2")

from app.data import repository
from app.domain.optimization import NUM_YEARS
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    RotationCandidateYearResult,
    RotationYear,
)
from app.domain.simulation import (
    CreateSimulationRequest,
    CropAreaLimit,
    OptimizationConstraints,
    Simulation,
)
from app.services.optimization.crop_area_ranges import crop_area_ranges

BARLEY = 1
BEANS = 31
GRASS = 252


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


class CropAreaPersistenceTests(unittest.TestCase):
    def test_validation_and_camel_case_wire_shape(self) -> None:
        request = CreateSimulationRequest.model_validate(
            {
                "name": "Annual limits",
                "constraints": {
                    "cropAreaLimits": [
                        {"afgrodeKode": 1, "minAreaHa": 2.5, "maxAreaHa": 7.5},
                    ]
                },
            }
        )
        self.assertEqual(request.constraints.crop_area_limits[0].afgrode_kode, 1)
        self.assertEqual(
            request.model_dump(mode="json", by_alias=True)["constraints"]["cropAreaLimits"],
            [{"afgrodeKode": 1, "minAreaHa": 2.5, "maxAreaHa": 7.5}],
        )
        old_request = CreateSimulationRequest(name="Old client")
        self.assertEqual(old_request.constraints.crop_area_limits, [])
        self.assertEqual(
            Simulation(
                id="s",
                farm_id="f",
                name="Legacy",
                created_at="now",
            ).constraints.crop_area_limits,
            [],
        )
        for invalid in (
            {"afgrodeKode": 1},
            {"afgrodeKode": 1, "minAreaHa": -1},
            {"afgrodeKode": 1, "minAreaHa": 3, "maxAreaHa": 2},
            {"afgrodeKode": 1, "maxAreaHa": float("inf")},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValidationError):
                CropAreaLimit.model_validate(invalid)
        with self.assertRaises(ValidationError):
            OptimizationConstraints.model_validate(
                {
                    "cropAreaLimits": [
                        {"afgrodeKode": 1, "minAreaHa": 1},
                        {"afgrodeKode": 1, "maxAreaHa": 2},
                    ]
                }
            )

    def test_create_persists_optional_constraints(self) -> None:
        request = CreateSimulationRequest.model_validate(
            {
                "name": "New",
                "constraints": {"cropAreaLimits": [{"afgrodeKode": 1, "minAreaHa": 3}]},
            }
        )
        with (
            patch.object(repository, "SessionLocal") as factory,
            patch.object(repository, "_farm_exists", return_value=True),
        ):
            session = factory.begin.return_value.__enter__.return_value
            session.execute.return_value.scalars.return_value.all.return_value = []
            created = repository.create_simulation("farm", request, "member@example.com")
            inserted = session.execute.call_args_list[0].args[0].compile().params["data"]
        self.assertEqual(created.constraints.crop_area_limits[0].min_area_ha, 3)
        self.assertEqual(inserted["constraints"]["crop_area_limits"][0]["afgrode_kode"], 1)

    def test_partial_patch_preserves_other_rules_and_explicit_empty_clears(self) -> None:
        saved = Simulation(
            id="s",
            farm_id="f",
            name="Existing",
            created_at="now",
            constraints=OptimizationConstraints(min_fen=10, max_fields_with_new_rotation=999),
        )

        def patch_constraints(simulation: Simulation, payload: dict) -> Simulation:
            from app.data.simulation_store import merge_constraints

            merged = merge_constraints(
                simulation.constraints, OptimizationConstraints.model_validate(payload), 1
            )
            return simulation.model_copy(update={"constraints": merged})

        with_limit = patch_constraints(
            saved,
            {
                "cropAreaLimits": [{"afgrodeKode": 2, "maxAreaHa": 4}],
            },
        )
        self.assertEqual(with_limit.constraints.min_fen, 10)
        self.assertEqual(with_limit.constraints.crop_area_limits[0].max_area_ha, 4)
        old_client_patch = patch_constraints(with_limit, {"minFen": 12})
        self.assertEqual(
            old_client_patch.constraints.crop_area_limits,
            with_limit.constraints.crop_area_limits,
        )
        cleared = patch_constraints(old_client_patch, {"cropAreaLimits": []})
        self.assertEqual(cleared.constraints.crop_area_limits, [])
        self.assertEqual(cleared.constraints.min_fen, 12)


def _field(field_id: str, area_ha: float, locked_to: str | None = None) -> SimpleNamespace:
    locked_id = f"{locked_to}:1:100" if locked_to else None
    return SimpleNamespace(
        id=field_id,
        area_ha=area_ha,
        rotation_id=locked_id,
        allowed_rotation_ids=[locked_id] if locked_id else [],
    )


def _by_code(ranges):
    return {area_range.afgrode_kode: area_range for area_range in ranges}


class CropAreaRangeTests(unittest.TestCase):
    def test_average_is_capped_by_how_often_a_rotation_has_the_crop(self) -> None:
        beans_rotation = _candidate("62", (BARLEY, BARLEY, BEANS, BARLEY))
        barley_only = _candidate("1", (BARLEY,))
        ranges = _by_code(
            crop_area_ranges(
                [_field("a", 30), _field("b", 10)],
                {"a": [beans_rotation, barley_only], "b": [beans_rotation, barley_only]},
            )
        )
        self.assertEqual(ranges[BEANS].min_average_ha, 0)
        self.assertEqual(ranges[BEANS].max_average_ha, 10)
        self.assertEqual(ranges[BARLEY].min_average_ha, 30)
        self.assertEqual(ranges[BARLEY].max_average_ha, 40)

    def test_yearly_run_can_start_a_free_rotation_in_any_year(self) -> None:
        ranges = _by_code(
            crop_area_ranges(
                [_field("a", 5)],
                {"a": [_candidate("62", (BARLEY, BEANS))]},
            )
        )
        self.assertEqual(ranges[BEANS].max_ha_by_year, (5,) * NUM_YEARS)
        self.assertEqual(ranges[BEANS].min_ha_by_year, (0,) * NUM_YEARS)

    def test_yearly_average_counts_the_best_start_year(self) -> None:
        ranges = _by_code(
            crop_area_ranges(
                [_field("a", 8)],
                {"a": [_candidate("62", (BARLEY, BARLEY, BEANS))]},
            )
        )
        self.assertEqual(ranges[BEANS].max_average_ha, 2)
        self.assertEqual(ranges[BEANS].yearly_max_average_ha, 3)

    def test_locked_field_counts_only_its_selected_rotation(self) -> None:
        ranges = _by_code(
            crop_area_ranges(
                [_field("a", 4, locked_to="62")],
                {"a": [_candidate("1", (GRASS,)), _candidate("62", (BEANS, BARLEY))]},
            )
        )
        self.assertNotIn(GRASS, ranges)
        self.assertEqual(ranges[BEANS].min_average_ha, 2)
        self.assertEqual(ranges[BEANS].max_average_ha, 2)
        self.assertEqual(ranges[BEANS].min_ha_by_year, (4, 0) * (NUM_YEARS // 2))
        self.assertEqual(ranges[BEANS].max_ha_by_year, (4, 0) * (NUM_YEARS // 2))

    def test_a_crop_in_every_rotation_every_year_sets_a_floor(self) -> None:
        ranges = _by_code(
            crop_area_ranges(
                [_field("a", 3)],
                {"a": [_candidate("g1", (GRASS,)), _candidate("g2", (GRASS, GRASS))]},
            )
        )
        self.assertEqual(ranges[GRASS].min_average_ha, 3)
        self.assertEqual(ranges[GRASS].min_ha_by_year, (3,) * NUM_YEARS)
