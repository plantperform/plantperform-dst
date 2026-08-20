"""Finkornede sædskifte-kandidater — reference til en (saedskiftevariant,
variant, N-norm %)-kombination i services.rotations.saedskifte_library, samt
en enkelt års-position (rigtig afgrødekode) i en genereret rotation.

RotationCandidateRef serialiseres som ét komposit-id ("11:1:100"), så den kan
genbruge det eksisterende FieldRecord.allowed_rotation_ids: list[str]-felt
uændret (jf. planen for Fase 5-cutover).
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


class RotationPositionOverride(CamelModel):
    """Manuel overskrivning af hovedafgrøden i én position (0-7) af en
    ellers biblioteksgenereret rotation — jf. Fase 10 (levende beregning)."""

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


class SimulationFieldCandidates(CamelModel):
    """Den fulde, usynligt beregnede kandidatmængde for én mark i en
    simulering — gemt ved "Opret scenarie", læst af optimeringen senere."""

    field_id: str
    jbnr: int
    candidates: list[RotationCandidateEvaluation]
