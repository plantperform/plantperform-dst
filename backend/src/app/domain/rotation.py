from pydantic import Field

from app.domain.base import CamelModel
from app.domain.field import Crop


class NamedRotation(CamelModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    crops: list[Crop] = Field(min_length=1)
