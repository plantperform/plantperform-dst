from typing import Any

from pydantic import Field

from app.domain.base import CamelModel
from app.domain.field import GeoJSONMultiPolygon, GeoJSONPolygon


class RegistryField(CamelModel):
    imk_id: int
    cvr: str | None = Field(default=None, pattern=r"^\d{8}$")
    marknr: str | None = None
    kystvand_id: int | None = None
    retention: float | None = None
    soil_id: int | None = None
    jbnr: int | None = None
    area_ha: float
    crop_rotation: str
    crop_history: dict[str, int | None]
    in_takeout_plan: bool = False
    udledningsgraense_kgn_ha: float = 0
    udledningskvote_mark_kgn: float = 0
    geometry: GeoJSONPolygon | GeoJSONMultiPolygon | dict[str, Any]


class RegistryFieldSummary(CamelModel):
    imk_id: int
    cvr: str | None = Field(default=None, pattern=r"^\d{8}$")
    marknr: str | None = None
    kystvand_id: int | None = None
    retention: float | None = None
    soil_id: int | None = None
    area_ha: float
    crop_rotation: str
    in_takeout_plan: bool = False
    udledningsgraense_kgn_ha: float = 0
    udledningskvote_mark_kgn: float = 0


class RegistryBounds(CamelModel):
    west: float
    south: float
    east: float
    north: float
