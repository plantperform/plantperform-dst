from enum import StrEnum
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.domain.base import CamelModel
from app.domain.rotation_candidate import RotationYear

type Position = tuple[float, float]
type LinearRing = list[Position]


def default_allowed_rotation_ids() -> list[str]:
    """Tom liste = ingen begrænsning (alle beregnede kandidater kan vælges af
    Optimér). Et ikke-tomt sæt låser marken til netop disse kandidat-ref-id'er
    (jf. Fase 10 — "Rediger manuelt" og den tilhørende lås-knap)."""
    return []


def validate_rotation_ids(value: list[str]) -> list[str]:
    if len(set(value)) != len(value):
        raise ValueError("Allowed rotations must be unique")
    return value


class GeoJSONPolygon(CamelModel):
    type: Literal["Polygon"] = "Polygon"
    coordinates: list[LinearRing]


class GeoJSONMultiPolygon(CamelModel):
    type: Literal["MultiPolygon"] = "MultiPolygon"
    coordinates: list[list[LinearRing]]


class Soil(StrEnum):
    SAND = "SAND"
    CLAY = "CLAY"


class Crop(StrEnum):
    CEREAL_WINTER = "CEREAL_WINTER"
    CEREAL_SPRING = "CEREAL_SPRING"
    CEREAL_LEGUME_MIX = "CEREAL_LEGUME_MIX"
    GRASS_CLOVER = "GRASS_CLOVER"
    GRASS_SEED = "GRASS_SEED"
    FALLOW = "FALLOW"
    BEET = "BEET"
    MAIZE_POTATO = "MAIZE_POTATO"
    RAPE = "RAPE"
    CEREAL_WINTER_AFTER_GRASS = "CEREAL_WINTER_AFTER_GRASS"
    MAIZE_AFTER_GRASS = "MAIZE_AFTER_GRASS"
    CEREAL_SPRING_AFTER_GRASS = "CEREAL_SPRING_AFTER_GRASS"
    CEREAL_VEG_BEAN = "CEREAL_VEG_BEAN"


class Measure(StrEnum):
    PRECISION_FARMING = "PRECISION_FARMING"
    COVER_CROP = "COVER_CROP"
    EARLY_SOWING = "EARLY_SOWING"


class FieldMeasures(CamelModel):
    precision_farming: bool = False
    cover_crop_years: list[int] = Field(default_factory=list)
    early_sowing_years: list[int] = Field(default_factory=list)

    @field_validator("cover_crop_years", "early_sowing_years")
    @classmethod
    def validate_unique_years(cls, value: list[int]) -> list[int]:
        if any(year < 0 for year in value):
            raise ValueError("Measure years cannot be negative")
        if len(set(value)) != len(value):
            raise ValueError("Measure years must be unique")
        return sorted(value)


def crop_allows_early_sowing(crop: Crop) -> bool:
    return crop in {Crop.CEREAL_WINTER, Crop.CEREAL_WINTER_AFTER_GRASS}


def crop_allows_cover_crop(crop_rotation: list[Crop], index: int) -> bool:
    if not crop_rotation:
        return False
    next_crop = crop_rotation[(index + 1) % len(crop_rotation)]
    return next_crop not in {Crop.CEREAL_WINTER, Crop.CEREAL_WINTER_AFTER_GRASS}


def validate_measures_for_rotation(
    measures: FieldMeasures,
    crop_rotation: list[RotationYear],
) -> FieldMeasures:
    """Grænse-tjek kun. Den grove Crop-enums crop_allows_cover_crop/
    crop_allows_early_sowing-eligibility-tjek er droppet her — virkemidler
    hører nu til som kandidat-versioner genereret ved "Opret scenarie" (jf.
    planens beslutning 7), ikke en efterfølgende per-mark-godkendelse."""
    crop_count = len(crop_rotation)
    if any(year >= crop_count for year in measures.cover_crop_years):
        raise ValueError("Cover crop year is outside the crop rotation")
    if any(year >= crop_count for year in measures.early_sowing_years):
        raise ValueError("Early sowing year is outside the crop rotation")

    return measures


_SOIL_BY_REGISTRY_ID: dict[int, Soil] = {
    10: Soil.SAND,
    11: Soil.CLAY,
    20: Soil.CLAY,
}

# NLES 13-class aggregation. Code 0 ("NotInNLESAgg") and missing values are
# intentionally absent here; parse_crop_rotation falls back to CEREAL_WINTER
# until the agronomic mapping for these is decided.
_CROP_BY_REGISTRY_ID: dict[int, Crop] = {
    1: Crop.CEREAL_WINTER,
    2: Crop.CEREAL_SPRING,
    3: Crop.CEREAL_LEGUME_MIX,
    4: Crop.GRASS_CLOVER,
    5: Crop.GRASS_SEED,
    6: Crop.FALLOW,
    7: Crop.BEET,
    8: Crop.MAIZE_POTATO,
    9: Crop.RAPE,
    10: Crop.CEREAL_WINTER_AFTER_GRASS,
    11: Crop.MAIZE_AFTER_GRASS,
    12: Crop.CEREAL_SPRING_AFTER_GRASS,
    13: Crop.CEREAL_VEG_BEAN,
}


def parse_soil_id(value: int | None) -> Soil:
    if value is None:
        raise ValueError("Soil id is required")

    soil = _SOIL_BY_REGISTRY_ID.get(value)
    if soil is None:
        raise ValueError(f"Unsupported soil id {value}")

    return soil


def parse_crop_rotation(value: str | None) -> list[Crop]:
    if value is None or not value.strip():
        return []

    parts = [part.strip() for part in value.strip().split("_")]

    # TODO: Stop substituting CEREAL_WINTER for unknown / NotInNLESAgg / missing
    # registry crop ids. Empty positions in Rot_vec (e.g. "2_2_1_1__4_8") and the
    # explicit "0" NotInNLESAgg code both fall through to CEREAL_WINTER until
    # agronomic guidance is settled.
    crops: list[Crop] = []
    for part in parts:
        if not part or not part.isdecimal():
            crops.append(Crop.CEREAL_WINTER)
            continue
        crops.append(_CROP_BY_REGISTRY_ID.get(int(part), Crop.CEREAL_WINTER))

    return crops


class FieldRecord(CamelModel):
    id: str
    farm_id: str
    imk_id: int | None = None
    kystvand_id: int | None = None
    retention: float | None = None
    soil: Soil
    jbnr: int | None = None
    crop_rotation: list[RotationYear] = Field(default_factory=list)
    # Sat af optimeringen (candidate ref id, fx "315:4:100") — bruges til at slå
    # den fulde beregningsdetalje (leaching_detail/db_detail) op i
    # simulation_field_candidates. None indtil marken er blevet optimeret.
    rotation_id: str | None = None
    measures: FieldMeasures = Field(default_factory=FieldMeasures)
    allowed_rotation_ids: list[str] = Field(default_factory=default_allowed_rotation_ids)
    db2: float
    n_load: float
    leaching: float
    # Foderenheder (FEN) — kun meningsfuldt for FE-noterede afgrøder (helsæd/
    # græs). Sat af optimeringen sammen med db2/n_load/leaching, 0 indtil
    # marken er blevet optimeret. Default (ikke required) så eksisterende
    # markrækker uden dette felt stadig kan indlæses uden migration.
    fen: float = 0
    name: str
    area_ha: float
    in_takeout_plan: bool = False
    udledningsgraense_kgn_ha: float = 0
    udledningskvote_mark_kgn: float = 0
    geometry: GeoJSONPolygon | GeoJSONMultiPolygon | None = None


class CreateFieldRequest(CamelModel):
    imk_id: int | None = None
    kystvand_id: int | None = None
    retention: float | None = None
    soil: Soil
    crop_rotation: list[RotationYear] = Field(default_factory=list)
    measures: FieldMeasures = Field(default_factory=FieldMeasures)
    allowed_rotation_ids: list[str] = Field(default_factory=default_allowed_rotation_ids)
    name: str
    area_ha: float
    in_takeout_plan: bool = False
    udledningsgraense_kgn_ha: float = 0
    udledningskvote_mark_kgn: float = 0
    geometry: GeoJSONPolygon | GeoJSONMultiPolygon | None = None

    # Ingen "mindst ét år"-krav længere — marker oprettes typisk uden sædskifte
    # (fx importeret fra kortet) og får først et rigtigt sædskifte ved
    # "Opret scenarie" + "Optimér".

    @field_validator("allowed_rotation_ids")
    @classmethod
    def validate_allowed_rotation_ids(cls, value: list[str]) -> list[str]:
        return validate_rotation_ids(value)

    @model_validator(mode="after")
    def validate_measures(self) -> "CreateFieldRequest":
        validate_measures_for_rotation(self.measures, self.crop_rotation)
        return self


class UpdateFieldRequest(CamelModel):
    imk_id: int | None = None
    kystvand_id: int | None = None
    retention: float | None = None
    soil: Soil | None = None
    crop_rotation: list[RotationYear] | None = None
    rotation_id: str | None = None
    measures: FieldMeasures | None = None
    allowed_rotation_ids: list[str] | None = None
    # Kun sat af optimeringen (jf. beslutning i Fase 5) — erstatter den
    # tidligere automatiske genberegning-ved-hvert-opslag, som byggede på den
    # nu-udgåede grove Crop-baserede metrics.py.
    db2: float | None = None
    n_load: float | None = None
    leaching: float | None = None
    fen: float | None = None
    name: str | None = None
    area_ha: float | None = None
    in_takeout_plan: bool | None = None
    udledningsgraense_kgn_ha: float | None = None
    udledningskvote_mark_kgn: float | None = None
    geometry: GeoJSONPolygon | GeoJSONMultiPolygon | None = None

    @field_validator("allowed_rotation_ids")
    @classmethod
    def validate_allowed_rotation_ids(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value

        return validate_rotation_ids(value)

    @model_validator(mode="after")
    def validate_soil(self) -> "UpdateFieldRequest":
        if "soil" in self.model_fields_set and self.soil is None:
            raise ValueError("Soil is required")

        return self
