from pydantic import Field

from app.domain.base import CamelModel
from app.domain.rotation import NamedRotation


class Farm(CamelModel):
    id: str
    name: str
    owner_name: str
    cvr: str | None = Field(default=None, pattern=r"^\d{8}$")
    nitrogen_quota_kg: float = Field(ge=0)
    rotation_library: list[NamedRotation] = Field(default_factory=list)


class CreateFarmRequest(CamelModel):
    name: str = Field(min_length=1)
    owner_name: str = Field(min_length=1)
    cvr: str | None = Field(default=None, pattern=r"^\d{8}$")
    nitrogen_quota_kg: float = Field(default=0, ge=0)


class UpdateFarmRequest(CamelModel):
    nitrogen_quota_kg: float = Field(ge=0)
