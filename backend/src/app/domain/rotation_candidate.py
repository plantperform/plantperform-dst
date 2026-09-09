"""Fine-grained sædskifte candidates.

References a (saedskiftevariant, variant, N-norm %) combination in
services.rotations.saedskifte_library and a single year position (a real
afgrødekode) in a generated rotation.

RotationCandidateRef is serialized as one composite ID ("11:1:100"), allowing
the existing FieldRecord.allowed_rotation_ids: list[str] field to be reused
unchanged (see the Phase 5 cutover plan).
"""
from __future__ import annotations

from pydantic import Field

from app.domain.base import CamelModel


class RotationCandidateRef(CamelModel):
    saedskiftevariant: str = Field(min_length=1)
    variant: str = Field(min_length=1)
    n_norm_pct: str = Field(min_length=1)

    def to_id(self) -> str:
        return f"{self.saedskiftevariant}:{self.variant}:{self.n_norm_pct}"

    @classmethod
    def from_id(cls, value: str) -> RotationCandidateRef:
        saedskiftevariant, variant, n_norm_pct = value.split(":")
        return cls(saedskiftevariant=saedskiftevariant, variant=variant, n_norm_pct=n_norm_pct)


class RotationYear(CamelModel):
    afgrode_kode: int
    afgrode_navn: str
    udlaeg_kode: int | None = None
    udlaeg_navn: str | None = None


class RotationCandidateYearResult(CamelModel):
    year: RotationYear
    leaching_kg_n_ha: float
    leaching_detail: dict
    db_kr_ha: float
    db_detail: dict
    # Nøgletal for the "nøgletal" layer in the mark's calculation walkthrough
    # (see the old app). Already calculated by compute_n_inputs, these were
    # previously discarded after the NLES5/DB call and not exposed to the UI.
    # Husdyrgødning consists of a utilized/mineral part (counts toward the norm,
    # like handelsgødning) and an organically bound part (does not count toward
    # the norm but contributes to NLES5 udvaskning through G0/G1/G2).
    forfrugtsvaerdi_kgn_ha: float = 0.0
    tildelt_husdyrgodning_udnyttet_kgn_ha: float = 0.0
    tildelt_handelsgodning_kgn_ha: float = 0.0
    husdyrgodning_organisk_bundet_kgn_ha: float = 0.0
    # Tonnage overview (streamlit_app.py's "Reference — ton-overblik"): the
    # norm-limited quantity of husdyrgødning allocated at this rotation position
    # (the position's utilized N from husdyrgødning divided by the gødning's N
    # content in kg N/tonne). It may vary by position because the afgrøde norm
    # caps the allocation; the scenarie's "Maks tilladt udnyttet N" setting is
    # an upper limit, not a fixed applied quantity. This reporting value has no
    # calculation effect and is intended for later use as an optimization
    # parameter (minimum/maximum tonnes of gødning used per year).
    husdyrgodning_ton_pr_ha: float = 0.0
    # The afgrøde's full Bilag 1 N norm (kg N/ha), before deducting
    # forfrugtsværdi and before the N-norm% reduction. None when the afgrøde has
    # no norm in the dataset (e.g. an administrative area type). n_norm_pct is
    # the level to which the scenarie actually applies gødning (e.g. "80" = 80%
    # of the norm), matching candidate.ref.n_norm_pct but stored as a number for
    # direct display ("100% gødet til norm"/"80% gødet til norm").
    afgrode_norm_kgn_ha: float | None = None
    n_norm_pct: float = 100.0


class RotationPositionOverride(CamelModel):
    """Manual hovedafgrøde override in one position (0-7) of an otherwise
    library-generated rotation; see Phase 10 (live calculation)."""

    position: int = Field(ge=0, le=7)
    afgrode_kode: int


class RotationCandidateEvaluation(CamelModel):
    ref: RotationCandidateRef
    active_len: int
    years: list[RotationCandidateYearResult]
    avg_leaching_kg_n_ha: float
    avg_db_kr_ha: float
    avg_fen: float
    base_ref: RotationCandidateRef | None = None
    overrides: list[RotationPositionOverride] = Field(default_factory=list)
    start_year: int = 1


class SimulationFieldCandidates(CamelModel):
    """The complete, invisibly calculated candidate set for a mark in a
    simulering, stored by "Opret scenarie" and read later by the optimizer."""

    field_id: str
    jbnr: int
    candidates: list[RotationCandidateEvaluation]
    # The mark's own actual 2025/26 history (afgrøde + historical N input; see
    # historisk_goedning.real_history_lookback), cached here by "Opret scenarie"
    # so the optimizer/"Rediger manuelt" can later seed the 2027/2028 lookback
    # without an additional DB lookup per mark per call.
    real_history: dict[str, dict] | None = None
