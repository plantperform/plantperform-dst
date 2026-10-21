from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.domain.base import CamelModel
from app.domain.creation import CreationStatus
from app.domain.economics import EconomicsSnapshot
from app.domain.field import Crop
from app.domain.optimization import OptimizationSettings, SimulationResultSummary


class GodningSettings(CamelModel):
    """Scenario-level gødning selection (Phase 13).

    Ported from streamlit_app.py's "Organisk gødning" sidebar and now fully
    decoupled from the selected sædskifter/variants. It was previously bundled
    through saedskifte_kategorier's category system. These are the same three
    values candidate_evaluator.compute_n_inputs has used since Phase 2, but
    they are no longer looked up through a category string.
    """

    driftsform: Literal["Konventionel", "Økologisk"] = "Konventionel"
    org_mineral_n: float = Field(default=0.0, ge=0)
    mineralsk_andel_pct: float = Field(default=100.0, gt=0, le=100)
    only_organic: bool = False
    # Tonnage overview (streamlit_app.py's "Reference — ton-overblik", lines
    # 1016-1018): the gødning's N content, used to convert kg N to tonnes of
    # gødning. The default matches the old app; kvæggylle is typically 4-7.
    n_indhold_kg_per_ton: float = Field(default=6.0, gt=0)


class CropPercentageConstraint(CamelModel):
    crop: Crop
    minimum_percentage: float = Field(ge=0, le=100)


class CropAreaLimit(CamelModel):
    """Hectares of one exact crop code allowed in each planning year."""

    afgrode_kode: int = Field(gt=0)
    min_area_ha: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    max_area_ha: float | None = Field(default=None, ge=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_bounds(self) -> "CropAreaLimit":
        if self.min_area_ha is None and self.max_area_ha is None:
            raise ValueError("At least one crop area bound is required")
        if (
            self.min_area_ha is not None
            and self.max_area_ha is not None
            and self.min_area_ha > self.max_area_ha
        ):
            raise ValueError("min_area_ha cannot exceed max_area_ha")
        return self


class KystvandoplandNLoadCap(CamelModel):
    """Udledning cap for one kystvandopland.

    A simulering's marker may span several oplande. The bekendtgørelse enforces
    udledning per kystvandopland, never as one combined total; see FarmSidebar's
    corresponding Aktuel visning. `kystvand_id=None` covers marker without an
    associated opland. An opland without an entry here is unlimited.
    """

    kystvand_id: int | None = None
    max_n_load_kg: float | None = Field(default=None, ge=0)


class OptimizationConstraints(CamelModel):
    max_n_load_by_kystvandopland: list[KystvandoplandNLoadCap] = Field(default_factory=list)
    min_fen: float | None = Field(default=None, ge=0)
    max_fen: float | None = Field(default=None, ge=0)
    max_fields_with_new_rotation: int | None = Field(default=None, ge=0)
    crop_percentages: list[CropPercentageConstraint] = Field(default_factory=list)
    crop_area_limits: list[CropAreaLimit] = Field(default_factory=list)
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

    @field_validator("crop_area_limits")
    @classmethod
    def validate_crop_area_limits(cls, value: list[CropAreaLimit]) -> list[CropAreaLimit]:
        codes = [limit.afgrode_kode for limit in value]
        if len(codes) != len(set(codes)):
            raise ValueError("Crop area limits must use unique afgrode_kode values")
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


class SimulationQuotaTrade(CamelModel):
    """The kvote trade a simulering was created for, from a Kvotehandel curve.

    The simulering's DB2 is the afgrøder's alone; the trade adds
    -trade_kg * price_kr_per_kg kr per year on top.
    """

    kystvand_id: int
    kystvand_navn: str | None = None
    # kg N per year; positive bought, negative sold.
    trade_kg: float
    price_kr_per_kg: float = Field(ge=0)


class Simulation(CamelModel):
    fields_initialized: bool = True  # Legacy simulations already have their field snapshot.
    optimization_settings: OptimizationSettings = Field(default_factory=OptimizationSettings)
    economics_module_id: str = "standard"
    economics_snapshot: EconomicsSnapshot = Field(default_factory=EconomicsSnapshot)
    creation_status: CreationStatus = "done"
    economics_recalculation_failed: bool = False
    revision: int = 0
    result: SimulationResultSummary = Field(default_factory=SimulationResultSummary)
    id: str
    farm_id: str
    comparison_availability: dict | None = None
    name: str
    created_at: str
    constraints: OptimizationConstraints = Field(default_factory=OptimizationConstraints)
    # Editable library variants and N-norm levels used to generate alternatives
    # in memory on each optimization run.
    rotation_saedskiftevarianter: list[str] = Field(default_factory=list)
    rotation_n_norm_procenter: list[str] = Field(default_factory=list)
    # Gødning selection (Phase 13), independent of rotation_saedskiftevarianter.
    # Safe default for existing stored simuleringer: interpreted as "pure
    # mineral gødning, konventionel", following the same "reconstruct for
    # correct figures" precedent as other additive Phase 7/8/9 scenarie attributes.
    godning: GodningSettings = Field(default_factory=GodningSettings)
    # Sowing date/establishment interval for efterafgrøde (EEA), applying to
    # every year with efterafgrøde across the scenarie's marker (see
    # streamlit_app.py's global "applies to all years with efterafgrøde"
    # setting). eea_fdato is either one of four §37 interval dates or one of 30
    # §38 daily dates, depending on eea_precision_dagsbasis.
    eea_fdato: str = "20/8"
    eea_precision_dagsbasis: bool = False
    praecisionsjordbrug: bool = False
    tidlig_saaning: bool = True
    mellemafgrode: bool = True
    # Set when the simulering was created from a point of a Kvotehandel curve.
    quota_trade: SimulationQuotaTrade | None = None


class CreateSimulationRequest(CamelModel):
    optimization_settings: OptimizationSettings = Field(default_factory=OptimizationSettings)
    economics_module_id: str | None = None
    request_id: UUID | None = None
    optimize_on_create: bool = False
    name: str = Field(min_length=1)
    constraints: OptimizationConstraints = Field(default_factory=OptimizationConstraints)
    # Flat list of selected saedskiftevariant IDs (from the expandable list in
    # "Nyt scenarie", which still groups by category for browsing). The gødning
    # below is fully independent of this selection, as specified in Phase 13.
    saedskiftevarianter: list[str] = Field(default_factory=list)
    n_norm_procenter: list[str] = Field(default_factory=list)
    godning: GodningSettings = Field(default_factory=GodningSettings)
    eea_fdato: str = "20/8"
    eea_precision_dagsbasis: bool = False
    praecisionsjordbrug: bool = False
    tidlig_saaning: bool = True
    mellemafgrode: bool = True

    @field_validator("name")
    @classmethod
    def trim_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Give the simulation a name")
        return value


class UpdateSimulationRequest(CamelModel):
    expected_revision: int = Field(ge=0)
    name: str | None = Field(default=None, min_length=1)
    economics_module_id: str | None = None
    constraints: OptimizationConstraints | None = None
    saedskiftevarianter: list[str] | None = None
    n_norm_procenter: list[str] | None = None
    godning: GodningSettings | None = None
    eea_fdato: str | None = None
    eea_precision_dagsbasis: bool | None = None
    praecisionsjordbrug: bool | None = None
    tidlig_saaning: bool | None = None
    mellemafgrode: bool | None = None
    optimization_settings: OptimizationSettings | None = None

    @model_validator(mode="after")
    def validate_nonnull_settings(self):
        for key in self.model_fields_set - {"economics_module_id"}:
            if getattr(self, key) is None:
                raise ValueError(f"{key} cannot be null")
        if self.name is not None:
            self.name = self.name.strip()
            if not self.name:
                raise ValueError("Give the simulation a name")
        return self
