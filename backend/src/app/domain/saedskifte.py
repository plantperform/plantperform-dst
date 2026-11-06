"""User-owned rotation groups; standard rotations retain their lookup identities."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import ConfigDict, Field, field_validator, model_validator

from app.domain.base import CamelModel


def is_custom(group_id):
    try:
        UUID(str(group_id))
    except ValueError:
        return False
    return True


class RotationPosition(CamelModel):
    model_config = ConfigDict(extra="forbid")
    afgrode_kode: int = Field(gt=0, strict=True)
    allowed_udlaeg_koder: list[Annotated[int, Field(gt=0, strict=True)]] = Field(
        default_factory=list
    )

    @field_validator("allowed_udlaeg_koder")
    @classmethod
    def unique_codes(cls, codes):
        if any(code <= 0 for code in codes) or len(codes) != len(set(codes)):
            raise ValueError("Udlæg codes must be positive and unique")
        return sorted(codes)


class RotationVariant(CamelModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID = Field(default_factory=uuid4)
    positions: list[RotationPosition] = Field(min_length=1, max_length=8)


class CreateRotationGroupRequest(CamelModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1)
    driftsform: Literal["Konventionel", "Økologisk"] | None = None
    variants: list[RotationVariant] = Field(min_length=1)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value):
        if value is None or not value.strip():
            raise ValueError("Give the rotation group a name")
        return value.strip()

    @field_validator("variants")
    @classmethod
    def unique_variants(cls, variants):
        if variants is not None and len({v.id for v in variants}) != len(variants):
            raise ValueError("Variant IDs must be unique")
        return variants


class UpdateRotationGroupRequest(CreateRotationGroupRequest):
    expected_revision: int = Field(ge=0, strict=True)
    name: str | None = None
    variants: list[RotationVariant] | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def nonnull_changes(self):
        for key in self.model_fields_set - {"driftsform"}:
            if getattr(self, key) is None:
                raise ValueError(f"{key} cannot be null")
        return self


class RotationGroupSnapshot(CamelModel):
    id: str
    name: str
    revision: int = 0
    driftsform: Literal["Konventionel", "Økologisk"] | None = None
    variants: list[RotationVariant]


class RotationGroup(RotationGroupSnapshot):
    is_standard: bool = False
    can_copy: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DuplicateRotationGroupRequest(CamelModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value):
        return CreateRotationGroupRequest.trim_name(value)


class RotationGroupNotFoundError(Exception):
    pass


class RotationGroupConflictError(Exception):
    pass


class RotationDefinitionError(ValueError):
    pass
