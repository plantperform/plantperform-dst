from typing import Any

from pydantic import Field

from app.domain.base import CamelModel
from app.domain.field import GeoJSONMultiPolygon, GeoJSONPolygon


class RegistryField(CamelModel):
    imk_id: int
    cvr: str | None = Field(default=None, pattern=r"^\d{8}$")
    marknr: str | None = None
    markblok: str | None = None
    journalnr: str | None = None
    kystvand_id: int | None = None
    kystvand_navn: str | None = None
    retention: float | None = None
    jbnr: int | None = None
    goedningsregion: str | None = None
    oeko: bool = False
    kvotegivende: bool = False
    area_ha: float
    crop_rotation: str
    crop_history: dict[str, int | None]
    in_takeout_plan: str = "nej"
    udledningsgraense_kgn_ha: float = 0
    udledningskvote_mark_kgn: float = 0
    geometry: GeoJSONPolygon | GeoJSONMultiPolygon | dict[str, Any]


class RegistryFieldSummary(CamelModel):
    imk_id: int
    cvr: str | None = Field(default=None, pattern=r"^\d{8}$")
    marknr: str | None = None
    kystvand_id: int | None = None
    kystvand_navn: str | None = None
    retention: float | None = None
    area_ha: float
    crop_rotation: str
    in_takeout_plan: str = "nej"
    udledningsgraense_kgn_ha: float = 0
    udledningskvote_mark_kgn: float = 0


class RegistryBounds(CamelModel):
    west: float
    south: float
    east: float
    north: float
