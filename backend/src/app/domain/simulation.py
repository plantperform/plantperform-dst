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
    # Ton-overblik (streamlit_app.py's "Reference — ton-overblik", linje
    # 1016-1018) — gødningens N-indhold, brugt til at omregne kg N til ton
    # gødning. Default matcher den gamle apps default; typisk kvæggylle 4-7.
    n_indhold_kg_per_ton: float = Field(default=6.0, gt=0)


class CropPercentageConstraint(CamelModel):
    crop: Crop
    minimum_percentage: float = Field(ge=0, le=100)


class KystvandoplandNLoadCap(CamelModel):
    """Udledningsloft for ét kystvandopland (en simulerings marker kan
    fordele sig over flere) — bekendtgørelsen håndhæver udledning pr.
    opland, aldrig som én samlet sum, jf. FarmSidebar's tilsvarende Aktuel-
    visning. `kystvand_id=None` dækker marker uden et tilknyttet opland.
    Et opland der ikke har en post her er ubegrænset."""

    kystvand_id: int | None = None
    max_n_load_kg: float | None = Field(default=None, ge=0)


class OptimizationConstraints(CamelModel):
    max_n_load_by_kystvandopland: list[KystvandoplandNLoadCap] = Field(default_factory=list)
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
            raise ValueError("Afgrødeandel-krav kan ikke indeholde samme afgrøde flere gange")

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
            raise ValueError("Globalt tilladte sædskifte-id'er skal være unikke")
        return value

    @model_validator(mode="after")
    def validate_percentage_sum(self) -> "OptimizationConstraints":
        total_percentage = sum(
            constraint.minimum_percentage for constraint in self.crop_percentages
        )
        if total_percentage > 100:
            raise ValueError("Afgrødeandel-krav kan ikke overstige 100 procent samlet")

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
    # Præcisionsjordbrug (SKH's faktaark om virkemidler, 2026) — scenarie-
    # niveau-toggle, uafhængig af sædskiftevalg (samme mønster som driftsform/
    # eea_precision_dagsbasis). Gælder KUN i år med korn eller raps som
    # hovedafgrøde (se bridge_v2._KORN_OG_RAPS_KODER/db_calculator's egen
    # kopi) — anvendes ikke på øvrige afgrøder selv når slået til.
    praecisionsjordbrug: bool = False
    # Tidlig såning/mellemafgrøde til/fra (candidate_evaluator's
    # _strip_disabled_virkemidler) — default True bevarer eksisterende
    # scenariers opførsel uændret (hele pointen med disse virkemidler var
    # hidtil styret alene af hvilken sædskiftevariant man valgte). Slået fra
    # fjerner KUN den pågældende virkemiddeltype fra rotationssekvensen — det
    # er ikke et filter på hvilke sædskiftevarianter der er valgbare.
    tidlig_saaning: bool = True
    mellemafgrode: bool = True


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
    praecisionsjordbrug: bool = False
    tidlig_saaning: bool = True
    mellemafgrode: bool = True
