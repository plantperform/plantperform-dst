from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from app.domain.base import CamelModel
from app.domain.farm import Farm

COPY_CVR = "12345678"
COPY_SOURCE_EMAIL = "mowv@icoel.dk"


class FarmCopyLookup(CamelModel):
    cvr: Literal["12345678"]
    name: str = Field(min_length=1)
    owner_name: str = Field(min_length=1)

    @field_validator("cvr", mode="before")
    @classmethod
    def require_copy_cvr(cls, value):
        if value != COPY_CVR:
            raise ValueError("Kopiering kræver CVR 12345678.")
        return value

    @field_validator("name", "owner_name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Bedriftens navn og ejerens navn skal udfyldes.")
        return value


class CopyFarmRequest(FarmCopyLookup):
    source_farm_id: str = Field(min_length=1)
    request_id: UUID


class FarmCopyPreview(CamelModel):
    source_farm: Farm
    field_count: int
    area_ha: float
    simulation_count: int
    saved_result_count: int
    has_unfinished_calculations: bool


class FarmCopyNotFoundError(Exception):
    pass


class FarmCopyConflictError(Exception):
    pass
