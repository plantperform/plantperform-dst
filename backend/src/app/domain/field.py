from enum import StrEnum
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.domain.base import CamelModel

type Position = tuple[float, float]
type LinearRing = list[Position]


def default_allowed_rotation_ids() -> list[str]:
    from app.domain.rotation_library import default_allowed_rotation_ids as get_default

    return get_default()


def validate_rotation_ids(value: list[str]) -> list[str]:
    from app.domain.rotation_library import validate_allowed_rotation_ids

    return validate_allowed_rotation_ids(value)


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
    crop_rotation: list[Crop],
) -> FieldMeasures:
    crop_count = len(crop_rotation)
    if any(year >= crop_count for year in measures.cover_crop_years):
        raise ValueError("Cover crop year is outside the crop rotation")
    if any(year >= crop_count for year in measures.early_sowing_years):
        raise ValueError("Early sowing year is outside the crop rotation")

    for year in measures.cover_crop_years:
        if not crop_allows_cover_crop(crop_rotation, year):
            raise ValueError(
                "Cover crop cannot be used before winter cereal or winter cereal after grass"
            )

    for year in measures.early_sowing_years:
        if not crop_allows_early_sowing(crop_rotation[year]):
            raise ValueError(
                "Early sowing can only be used for winter cereal or winter cereal after grass"
            )

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
    crop_rotation: list[Crop] = Field(default_factory=list)
    measures: FieldMeasures = Field(default_factory=FieldMeasures)
    allowed_rotation_ids: list[str] = Field(default_factory=default_allowed_rotation_ids)
    db2: float
    n_load: float
    leaching: float
    name: str
    area_ha: float
    in_takeout_plan: bool = False
    n_quota_kg_n: float | None = None
    geometry: GeoJSONPolygon | GeoJSONMultiPolygon | None = None


class CreateFieldRequest(CamelModel):
    imk_id: int | None = None
    kystvand_id: int | None = None
    retention: float | None = None
    soil: Soil
    crop_rotation: list[Crop] = Field(default_factory=list)
    measures: FieldMeasures = Field(default_factory=FieldMeasures)
    allowed_rotation_ids: list[str] = Field(default_factory=default_allowed_rotation_ids)
    name: str
    area_ha: float
    in_takeout_plan: bool = False
    n_quota_kg_n: float | None = None
    geometry: GeoJSONPolygon | GeoJSONMultiPolygon | None = None

    @field_validator("crop_rotation")
    @classmethod
    def validate_crop_rotation(cls, value: list[Crop]) -> list[Crop]:
        if not value:
            raise ValueError("Crop rotation must contain at least one crop")

        return value

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
    crop_rotation: list[Crop] | None = None
    measures: FieldMeasures | None = None
    allowed_rotation_ids: list[str] | None = None
    name: str | None = None
    area_ha: float | None = None
    in_takeout_plan: bool | None = None
    n_quota_kg_n: float | None = None
    geometry: GeoJSONPolygon | GeoJSONMultiPolygon | None = None

    @field_validator("crop_rotation")
    @classmethod
    def validate_crop_rotation(cls, value: list[Crop] | None) -> list[Crop] | None:
        if value is None:
            return value

        if not value:
            raise ValueError("Crop rotation must contain at least one crop")

        return value

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
