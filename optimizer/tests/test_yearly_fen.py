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
from plantperform_optimizer.orchestrator import (
    _expand_yearly_options,
    _locked_yearly_field_contribution,
)

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


if __name__ == "__main__":
    unittest.main()
