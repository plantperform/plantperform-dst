import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://dst2:dst2@localhost:5432/dst2")

from app.data import repository
from app.data.simulation_store import project_fields
from app.domain.optimization import NUM_YEARS
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    RotationCandidateYearResult,
    RotationYear,
)
from app.domain.simulation import CreateSimulationRequest
from app.services.scenario.rotations import compute_yearly_summary

PERMANENT_GRASS = 252


def _permanent_candidate() -> RotationCandidateEvaluation:
    return RotationCandidateEvaluation(
        ref=RotationCandidateRef(
            saedskiftevariant="permanent", variant=str(PERMANENT_GRASS), n_norm_pct="100"
        ),
        active_len=NUM_YEARS,
        years=[
            RotationCandidateYearResult(
                year=RotationYear(afgrode_kode=PERMANENT_GRASS, afgrode_navn="Græs"),
                leaching_kg_n_ha=10,
                leaching_detail={},
                db_kr_ha=2000,
                db_detail={"udbytte": 3200, "udbytteenhed": "FE/ha"},
            )
            for _ in range(NUM_YEARS)
        ],
        avg_leaching_kg_n_ha=10,
        avg_db_kr_ha=2000,
        avg_fen=3200,
    )


def _stored_setup(session) -> dict:
    """The fields and order create_simulation writes onto the simulation row."""
    [values] = [
        call.args[0].compile().params
        for call in session.execute.call_args_list
        if call.args[0].__visit_name__ == "update" and call.args[0].table.name == "simulation"
    ]
    return values


class PermanentFieldLockTests(unittest.TestCase):
    def test_locked_permanent_field_stores_its_projection_not_its_history(self) -> None:
        # The farm field still carries its "Aktuel" figures from 2019-2026.
        farm_field = {
            "id": "farm-field",
            "farm_id": "farm",
            "imk_id": 1,
            "name": "55-0",
            "area_ha": 4,
            "retention": 25,
            "kvotegivende": True,
            "db2": 1,
            "n_load": 99,
            "leaching": 132,
            "fen": 5000,
        }
        registry_row = SimpleNamespace(
            jbnr=4, crop_history={"2026": PERMANENT_GRASS}, goedningsregion=None, oeko=False
        )
        with (
            patch.object(repository, "SessionLocal") as factory,
            patch.object(repository, "_farm_exists", return_value=True),
            patch.object(
                repository, "_registry_contexts_for_imk_ids", return_value={1: registry_row}
            ),
            patch.object(repository, "_soil_data_for_context", return_value=None),
            patch.object(repository, "real_history_lookback", return_value={}),
            patch.object(repository, "is_permanent_afgrode", return_value=True),
            patch.object(
                repository,
                "generate_permanent_crop_candidate",
                return_value=_permanent_candidate(),
            ),
        ):
            session = factory.begin.return_value.__enter__.return_value
            session.execute.return_value.scalars.return_value.all.return_value = [farm_field]
            repository.create_simulation(
                "farm", CreateSimulationRequest(name="Locked"), "member@example.com"
            )
            setup = _stored_setup(session)

        # Read back the way the field list and Optimér see a locked mark.
        [field] = project_fields(setup["fields"], setup["field_order"], None)
        self.assertEqual(field.allowed_rotation_ids, [f"permanent:{PERMANENT_GRASS}:100"])
        self.assertEqual(field.db2, 2000 * 4)
        self.assertEqual(field.leaching, 10 * 4)
        self.assertEqual(field.n_load, 10 * 4 * 0.75)
        self.assertEqual(field.fen, 3200 * 4)


class YearlySummaryTests(unittest.TestCase):
    def test_udledning_counts_only_kvotegivende_marker(self) -> None:
        candidate = _permanent_candidate()
        fields = [
            SimpleNamespace(
                id=field_id,
                rotation_id=candidate.ref.to_id(),
                area_ha=area,
                retention=None,
                kvotegivende=kvotegivende,
            )
            for field_id, area, kvotegivende in (("quota", 2, True), ("no-quota", 3, False))
        ]
        selected = (fields, {field.id: candidate for field in fields})
        with patch.object(repository, "selected_evaluations", return_value=selected):
            summary = compute_yearly_summary("farm", "simulation", "member@example.com")

        self.assertEqual(len(summary), NUM_YEARS)
        for entry in summary:
            self.assertEqual(entry.total_n_load_kg, 10 * 2)
            self.assertEqual(entry.total_db2, 2000 * (2 + 3))
            self.assertEqual(entry.total_fen, 3200 * (2 + 3))
            self.assertEqual(entry.field_count, 2)


if __name__ == "__main__":
    unittest.main()
