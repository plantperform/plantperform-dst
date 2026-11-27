"""Shared economics modules and simulation-owned, frozen override snapshots."""

import json
from datetime import datetime
from typing import Annotated, Literal
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import ConfigDict, Field, field_validator

from app.domain.base import CamelModel
from app.domain.membership import MembershipRole

Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False, strict=True)]
Price = Annotated[float, Field(allow_inf_nan=False, strict=True)]
# Early sowing is priced as the difference from normal sowing, so its two
# price-list amounts can be a saving, which is a negative price. No other price
# can be negative.
SIGNED_PRICE_IDS = frozenset(
    {'list:["Tidlig såning, udsæd"]', 'list:["Tidlig såning, etablering"]'}
)
YieldPercentage = Annotated[float, Field(gt=-100, allow_inf_nan=False, strict=True)]
# kr/ha added to one crop's dækningsbidrag; negative lowers it.
CropCorrection = Annotated[float, Field(ge=-100_000, le=100_000, allow_inf_nan=False, strict=True)]
STANDARD_ID = "standard"
STANDARD_NAME = "Standard (SEGES 2026)"


class EconomicsCalculationInputs(CamelModel):
    """Physical inputs captured on a chosen year, independent of economic prices."""

    afgrodekode: int
    driftsform: str
    jbnr: int
    mncs: float | None = None
    mnca: float = 0
    irrigated: bool = False
    org_mineral_n_applied: float = 0
    udlaeg_kode: int | None = None
    only_organic: bool = False
    kvalitet: str = ""
    praecisionsjordbrug: bool = False
    forfrugtsvaerdi: float = 0
    rotation_crop: bool = False
    husdyrgodning_ton_pr_ha: float = 0
    oeko_n_tillaeg: bool = False


class EconomicsOverrides(CamelModel):
    model_config = ConfigDict(extra="forbid")
    prices: dict[str, Price] = Field(default_factory=dict)
    quantities: dict[str, Nonnegative] = Field(default_factory=dict)
    yield_pct: dict[str, YieldPercentage] = Field(default_factory=dict)
    crop_corrections: dict[str, CropCorrection] = Field(default_factory=dict)

    @field_validator("prices")
    @classmethod
    def only_signed_prices_are_negative(cls, prices):
        negative = sorted(
            price_id
            for price_id, value in prices.items()
            if value < 0 and price_id not in SIGNED_PRICE_IDS
        )
        if negative:
            raise ValueError(f"These prices cannot be negative: {negative}")
        return prices

    def cache_key(self) -> str:
        if not any((self.prices, self.quantities, self.yield_pct, self.crop_corrections)):
            return ""
        return json.dumps(self.model_dump(), sort_keys=True, separators=(",", ":"))


class EconomicsSnapshot(CamelModel):
    source_id: str = STANDARD_ID
    name: str = STANDARD_NAME
    revision: int = 0
    overrides: EconomicsOverrides = Field(default_factory=EconomicsOverrides)


class EconomicsModule(CamelModel):
    effective_role: MembershipRole = "viewer"
    id: str
    name: str
    overrides: EconomicsOverrides = Field(default_factory=EconomicsOverrides)
    revision: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CreateEconomicsModuleRequest(CamelModel):
    name: str = Field(min_length=1)
    overrides: EconomicsOverrides = Field(default_factory=EconomicsOverrides)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value):
        if value is None or not value.strip():
            raise ValueError("Give the economics module a name")
        return value.strip()


class UpdateEconomicsModuleRequest(CreateEconomicsModuleRequest):
    expected_revision: int = Field(ge=0, strict=True)
    name: str | None = None
    overrides: EconomicsOverrides | None = None


class SelectEconomicsRequest(CamelModel):
    expected_revision: int = Field(ge=0, strict=True)
    economics_module_id: str | None = None


class RecalculateEconomicsRequest(CamelModel):
    expected_revision: int = Field(ge=0, strict=True)
    request_id: UUID
    refresh_from_module: bool = True


class BudgetPrice(CamelModel):
    id: str
    label: str
    unit: str
    value: float
    source: str | None = None


class BudgetLine(CamelModel):
    label: str
    category: str
    quantity: float
    quantity_unit: str
    quantity_id: str | None = None
    price_id: str | None = None
    follows_yield: bool = False


class CropBudget(CamelModel):
    crop_code: int
    crop_name: str
    preceding_crop_value_kg_n_ha: float
    revenue: list[BudgetLine]
    subsidies: list[BudgetLine]
    costs: list[BudgetLine]


class SoilVariant(CamelModel):
    id: str
    value: float


class StandardManure(CamelModel):
    """The husdyrgødning an økologisk budget without a simulation is fertilised with.

    It covers the whole N-norm, at `n_kg_per_ton` utilized N per tonne.
    """

    name: str
    n_kg_per_ton: float


class CrossCropPrice(CamelModel):
    """A price-list price that is added on top of a crop's own budget."""

    price_id: str
    group: Literal["catchCrops", "fieldWork", "fertiliser"]
    can_be_negative: bool = False


class CropBudgets(CamelModel):
    jb_nr: int | None
    farming_system: str
    prices: list[BudgetPrice]
    # The husdyrgødning prices per tonne, always in `prices`, on either driftsform.
    manure_spreading_price_id: str | None = None
    manure_purchase_price_id: str | None = None
    # The cross-crop prices, also always in `prices`, on either driftsform.
    cross_crop_prices: list[CrossCropPrice] = Field(default_factory=list)
    standard_manure: StandardManure | None = None
    crops: list[CropBudget]
    soil_variants: dict[str, list[SoilVariant]]


class EconomicsRecalculationJob(CamelModel):
    job_type: Literal["recalculate_simulation_economics"] = "recalculate_simulation_economics"
    farm_id: str = Field(min_length=1)
    simulation_id: str = Field(min_length=1)
    job_id: str = Field(min_length=1)
    requested_by: str = Field(min_length=1)
    expected_revision: int = Field(ge=0, strict=True)
    snapshot: EconomicsSnapshot

    def envelope(self):
        return self.model_dump(mode="json", by_alias=True)


def recalculation_job_id(simulation_id, revision):
    return str(uuid5(NAMESPACE_URL, f"plantperform:economics:{simulation_id}:{revision}"))


class EconomicsModuleNotFoundError(Exception):
    pass


class EconomicsConflictError(Exception):
    pass
