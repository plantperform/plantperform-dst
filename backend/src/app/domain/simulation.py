from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.domain.base import CamelModel
from app.domain.field import Crop


class GodningSettings(CamelModel):
    """Scenarie-niveau gødningsvalg (Fase 13) — porteret fra
    streamlit_app.py's "Organisk gødning"-sidebar, nu fuldt afkoblet fra
    hvilke sædskifter/varianter der er valgt (var tidligere bundlet
    sammen via saedskifte_kategorier's kategori-system). Samme tre tal
    candidate_evaluator.compute_n_inputs allerede har brugt siden Fase 2,
    blot ikke længere opslået via en kategori-streng."""

    driftsform: Literal["Konventionel", "Økologisk"] = "Konventionel"
    org_mineral_n: float = Field(default=0.0, ge=0)
    mineralsk_andel_pct: float = Field(default=100.0, gt=0, le=100)
    only_organic: bool = False


class CropPercentageConstraint(CamelModel):
    crop: Crop
    minimum_percentage: float = Field(ge=0, le=100)


class OptimizationConstraints(CamelModel):
    max_n_load_kg: float | None = Field(default=None, ge=0)
    min_fen: float | None = Field(default=None, ge=0)
    max_fen: float | None = Field(default=None, ge=0)
    max_fields_with_new_rotation: int | None = Field(default=None, ge=0)
    crop_percentages: list[CropPercentageConstraint] = Field(default_factory=list)
    # UI-only memory of the last globally-applied allowed-rotation selection
    # from the simulation field list. The solver does not read this; it exists
    # purely so the checklist reloads in the same state next time the user
    # opens the simulation. `None` means "never applied".
    globally_allowed_rotation_ids: list[str] | None = None

    @field_validator("crop_percentages")
    @classmethod
    def validate_crop_percentages(
        cls,
        value: list[CropPercentageConstraint],
    ) -> list[CropPercentageConstraint]:
        crops = [constraint.crop for constraint in value]
        if len(crops) != len(set(crops)):
            raise ValueError("Crop percentage constraints cannot contain duplicate crops")

        return value

    @field_validator("globally_allowed_rotation_ids")
    @classmethod
    def validate_globally_allowed_rotation_ids(
        cls,
        value: list[str] | None,
    ) -> list[str] | None:
        if value is None:
            return value
        if len(set(value)) != len(value):
            raise ValueError("Globally allowed rotation ids must be unique")
        return value

    @model_validator(mode="after")
    def validate_percentage_sum(self) -> "OptimizationConstraints":
        total_percentage = sum(
            constraint.minimum_percentage for constraint in self.crop_percentages
        )
        if total_percentage > 100:
            raise ValueError("Crop percentage constraints cannot exceed 100 percent")

        return self

    @model_validator(mode="after")
    def validate_fen_range(self) -> "OptimizationConstraints":
        if self.min_fen is not None and self.max_fen is not None and self.min_fen > self.max_fen:
            raise ValueError("min_fen cannot exceed max_fen")

        return self


class Simulation(CamelModel):
    id: str
    farm_id: str
    name: str
    created_at: str
    constraints: OptimizationConstraints = Field(default_factory=OptimizationConstraints)
    # Hvilke sædskiftevarianter + N-norm% "Opret scenarie" brugte til at
    # generere den gemte kandidatmængde (simulation_field_candidates) — rent
    # oplysende/audit, solveren læser dette indirekte via de gemte kandidater.
    rotation_saedskiftevarianter: list[str] = Field(default_factory=list)
    rotation_n_norm_procenter: list[str] = Field(default_factory=list)
    # Gødningsvalg (Fase 13) — uafhængig af rotation_saedskiftevarianter.
    # Sikker default for allerede-gemte simuleringer: tolkes som "ren
    # mineralsk gødning, konventionel" (samme "genskab for korrekte tal"-
    # præcedens som Fase 7/8/9's andre additive scenarie-felter).
    godning: GodningSettings = Field(default_factory=GodningSettings)
    # Sådato/etableringsinterval for efterafgrøde (EEA) — gælder for alle år
    # med efterafgrøde på tværs af scenariets marker (jf. streamlit_app.py's
    # globale "gælder for alle år med efterafgrøde"-indstilling). eea_fdato er
    # enten en af de 4 §37-intervaldatoer eller en af de 30 §38-dagsbasis-datoer,
    # afhængig af eea_precision_dagsbasis.
    eea_fdato: str = "20/8"
    eea_precision_dagsbasis: bool = False


class CreateSimulationRequest(CamelModel):
    name: str = Field(min_length=1)
    # Flad liste af valgte saedskiftevariant-id'er (fra "Nyt scenarie"s
    # fold-ud-liste, som stadig grupperer efter kategori for browsing —
    # men gødning (herunder) er fuldt uafhængig af dette valg, jf. Fase 13).
    saedskiftevarianter: list[str] = Field(default_factory=list)
    n_norm_procenter: list[str] = Field(default_factory=list)
    godning: GodningSettings = Field(default_factory=GodningSettings)
    eea_fdato: str = "20/8"
    eea_precision_dagsbasis: bool = False
