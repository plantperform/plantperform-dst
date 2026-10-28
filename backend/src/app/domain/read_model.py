"""Small display values and revision-bound preparation jobs."""

from typing import Literal
from uuid import NAMESPACE_URL, uuid5

from pydantic import Field, model_validator

from app.domain.base import CamelModel
from app.domain.economics import EconomicsSnapshot
from app.domain.farm import Farm
from app.domain.field import FieldRecord
from app.domain.optimization import OptimizeSimulationResponse
from app.domain.rotation_candidate import RotationYear
from app.domain.simulation import Simulation


class FieldYearValue(CamelModel):
    year: RotationYear
    leaching_kg_n_ha: float
    db_kr_ha: float
    # An afgrøde without a cost budget that no sædskifte grows: db_kr_ha is 0
    # and means no figure.
    economics_missing: bool = False
    fen_fe_ha: float
    forfrugtsvaerdi_kgn_ha: float = 0
    tildelt_husdyrgodning_udnyttet_kgn_ha: float = 0
    tildelt_handelsgodning_kgn_ha: float = 0
    husdyrgodning_organisk_bundet_kgn_ha: float = 0
    husdyrgodning_ton_pr_ha: float = 0
    afgrode_norm_kgn_ha: float | None = None
    n_norm_pct: float = 100
    # Whether the year's afgrøde has a yield-response curve, so n_norm_pct can
    # cut its N and yield. None in read models prepared before the flag existed.
    has_yield_response: bool | None = None
    winter_cover: dict = Field(default_factory=dict)


class YearlyTotal(CamelModel):
    year: int
    total_n_load_kg: float
    total_db2: float
    total_fen: float
    field_count: int


class CropAreaRangeValue(CamelModel):
    afgrode_kode: int
    min_average_ha: float
    max_average_ha: float
    min_ha_by_year: list[float]
    max_ha_by_year: list[float]
    yearly_max_average_ha: float


class RotationChoice(CamelModel):
    saedskiftevariant: str
    variant: str
    crop_sequence: list[str]
    active_len: int


class RotationChoiceCategory(CamelModel):
    kategori: str
    saedskifter: list[RotationChoice]


class SavedResultView(CamelModel):
    economics_snapshot: EconomicsSnapshot = Field(default_factory=EconomicsSnapshot)
    run_id: str
    result_revision: int
    response: OptimizeSimulationResponse
    fields_before: list[FieldRecord]
    field_years: dict[str, list[FieldYearValue]]


class FarmViewData(CamelModel):
    fields: list[FieldRecord]
    field_years: dict[str, list[FieldYearValue]]
    yearly_summary: list[YearlyTotal]


class SimulationViewData(FarmViewData):
    crop_area_ranges: list[CropAreaRangeValue]
    yearly_optimization_candidates: list[RotationChoiceCategory]
    saved_result: SavedResultView | None = None


class ViewState(CamelModel):
    input_revision: int
    view_version: int
    status: Literal["queued", "running", "done", "failed", "missing"]
    error: dict | None = None


class FarmView(ViewState):
    farm: Farm
    data: FarmViewData | None = None


class SimulationView(ViewState):
    simulation: Simulation
    data: SimulationViewData | None = None


class ReadModelNotReadyError(Exception):
    pass


def preparation_id(kind, entity_id, revision, generation=0):
    return str(uuid5(NAMESPACE_URL, f"plantperform:{kind}:{entity_id}:{revision}:{generation}"))


class PreparationJob(CamelModel):
    job_type: Literal["prepare_farm_history", "prepare_simulation_view"]
    farm_id: str = Field(min_length=1)
    simulation_id: str | None = None
    expected_revision: int = Field(ge=0)
    generation: int = Field(default=0, ge=0)
    job_id: str

    @property
    def entity_id(self):
        return self.simulation_id if self.job_type == "prepare_simulation_view" else self.farm_id

    @model_validator(mode="after")
    def check_identity(self):
        if not self.entity_id or (
            self.job_type == "prepare_farm_history" and self.simulation_id is not None
        ):
            raise ValueError("Invalid preparation entity")
        if self.job_id != preparation_id(
            self.job_type, self.entity_id, self.expected_revision, self.generation
        ):
            raise ValueError("Preparation job does not match its input revision")
        return self


def preparation_job(kind, farm_id, revision, simulation_id=None, generation=0):
    entity_id = simulation_id if kind == "prepare_simulation_view" else farm_id
    return PreparationJob(
        job_type=kind,
        farm_id=farm_id,
        simulation_id=simulation_id,
        expected_revision=revision,
        generation=generation,
        job_id=preparation_id(kind, entity_id, revision, generation),
    )
