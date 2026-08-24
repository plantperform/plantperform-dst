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
    # Nøgletal til "nøgletal"-laget i markens beregningsgennemgang (jf. den
    # gamle app) — allerede beregnet af compute_n_inputs, men tidligere kasseret
    # efter brug i selve NLES5-/DB-kaldet, ikke gjort tilgængelig for UI'en.
    # Husdyrgødning består af en udnyttet/mineralsk del (tæller med i normen,
    # ligesom handelsgødning) og en organisk bundet del (tæller IKKE med i
    # normen, men indgår i NLES5-udvaskningen via G0/G1/G2).
    forfrugtsvaerdi_kgn_ha: float = 0.0
    tildelt_husdyrgodning_udnyttet_kgn_ha: float = 0.0
    tildelt_handelsgodning_kgn_ha: float = 0.0
    husdyrgodning_organisk_bundet_kgn_ha: float = 0.0
    # Ton-overblik (streamlit_app.py's "Reference — ton-overblik") — den
    # udlagte mængde husdyrgødning i ton/ha (scenariets "Maks tilladt
    # udnyttet N"-indstilling ÷ gødningens N-indhold kg N/ton), samme for
    # alle positioner i rotationen (jf. Fase 13: én gødningsindstilling for
    # hele scenariet). IKKE opdelt i udnyttet/organisk bundet — det er kun
    # relevant for selve NLES5-/DB-beregningen, ikke for hvor meget gødning
    # der fysisk køres ud. Rent opgørelsestal, ingen beregningseffekt — til
    # senere brug som optimeringsparameter (min/maks ton gødning brugt
    # pr. år).
    husdyrgodning_ton_pr_ha: float = 0.0
    # Afgrødens fulde Bilag 1-N-norm (kg N/ha), FØR forfrugtsværdi trækkes fra
    # og FØR N-norm%-reduktionen — None hvis afgrøden ikke har en norm i
    # datasættet (fx en administrativ arealtype). n_norm_pct er reduktionen
    # scenariet reelt gøder til (fx "80" = 80% af normen) — samme værdi som
    # candidate.ref.n_norm_pct, men som tal i stedet for streng, til direkte
    # visning ("100% gødet til norm"/"80% gødet til norm").
    afgrode_norm_kgn_ha: float | None = None
    n_norm_pct: float = 100.0


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
    start_year: int = 1


class SimulationFieldCandidates(CamelModel):
    """Den fulde, usynligt beregnede kandidatmængde for én mark i en
    simulering — gemt ved "Opret scenarie", læst af optimeringen senere."""

    field_id: str
    jbnr: int
    candidates: list[RotationCandidateEvaluation]
