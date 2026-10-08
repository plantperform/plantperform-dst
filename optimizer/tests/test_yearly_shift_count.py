import os
import unittest
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://dst2:dst2@localhost:5432/dst2",
)

from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    RotationCandidateYearResult,
    RotationPositionOverride,
    RotationYear,
)
from plantperform_optimizer import orchestrator

EMPTY = (None, None, None)

# Library rotations as get_raw_rotation returns them: eight positions, padded
# with empty positions after the rotation's own length.
RAW_ROTATIONS = {
    ("3aar", "1"): [(1, None, None), (11, None, None), (22, None, None)] + [EMPTY] * 5,
    ("8aar", "1"): [(code, None, None) for code in (1, 11, 22, 1, 11, 22, 10, 14)],
    ("brak", "1"): [(310, None, None)] + [EMPTY] * 7,
}


def fake_get_raw_rotation(saedskifte, variant):
    return RAW_ROTATIONS.get((saedskifte, variant), [EMPTY] * 8)


def _candidate(
    saedskiftevariant: str,
    overrides: list[RotationPositionOverride] | None = None,
    base_ref: RotationCandidateRef | None = None,
) -> RotationCandidateEvaluation:
    return RotationCandidateEvaluation(
        ref=RotationCandidateRef(
            saedskiftevariant=saedskiftevariant, variant="1", n_norm_pct="100",
        ),
        base_ref=base_ref,
        overrides=overrides or [],
        # generate_rotation always cycles the rotation out to eight positions.
        active_len=8,
        years=[
            RotationCandidateYearResult(
                year=RotationYear(afgrode_kode=1, afgrode_navn="1"),
                leaching_kg_n_ha=0, leaching_detail={}, db_kr_ha=0, db_detail={},
            )
            for _ in range(8)
        ],
        avg_leaching_kg_n_ha=0,
        avg_db_kr_ha=0,
        avg_fen=0,
    )


class ShiftCountTests(unittest.TestCase):
    def setUp(self) -> None:
        patcher = patch.object(
            orchestrator.saedskifte_library, "get_raw_rotation", fake_get_raw_rotation,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_short_rotation_is_shifted_through_its_own_length(self) -> None:
        self.assertEqual(orchestrator._shift_count(_candidate("3aar")), 3)

    def test_one_year_rotation_has_a_single_start_year(self) -> None:
        self.assertEqual(orchestrator._shift_count(_candidate("brak")), 1)

    def test_eight_year_rotation_keeps_eight_start_years(self) -> None:
        self.assertEqual(orchestrator._shift_count(_candidate("8aar")), 8)

    def test_shifted_candidate_uses_its_base_rotation(self) -> None:
        base_ref = RotationCandidateRef(saedskiftevariant="3aar", variant="1", n_norm_pct="100")
        self.assertEqual(
            orchestrator._shift_count(_candidate("3aar+manuel-x", base_ref=base_ref)), 3,
        )

    def test_manual_overrides_keep_all_eight_start_years(self) -> None:
        override = RotationPositionOverride(position=4, afgrode_kode=263)
        self.assertEqual(orchestrator._shift_count(_candidate("3aar", [override])), 8)

    def test_unknown_rotation_falls_back_to_active_len(self) -> None:
        self.assertEqual(orchestrator._shift_count(_candidate("permanent")), 8)


if __name__ == "__main__":
    unittest.main()
