from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.domain.base import CamelModel
from app.domain.field import Crop


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
    # The sædskifte variants + N-norm% used by "Opret scenarie" to generate the
    # stored candidate set (simulation_field_candidates). Informational/audit
    # only; the solver reads this indirectly through the stored candidates.
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


class CreateSimulationRequest(CamelModel):
    name: str = Field(min_length=1)
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
