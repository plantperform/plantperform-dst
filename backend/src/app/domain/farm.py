from pydantic import Field

from app.domain.base import CamelModel
from app.domain.rotation import NamedRotation


class Farm(CamelModel):
    id: str
    name: str
    owner_name: str
    cvr: str | None = Field(default=None, pattern=r"^\d{8}$")
    rotation_library: list[NamedRotation] = Field(default_factory=list)


class CreateFarmRequest(CamelModel):
    name: str = Field(min_length=1)
    owner_name: str = Field(min_length=1)
    cvr: str | None = Field(default=None, pattern=r"^\d{8}$")


class KystvandoplandUdledning(CamelModel):
    """Udledningskvote and calculated udledning for a kystvandopland.

    This covers a bedrift's current ("Aktuel") marker. The bekendtgørelse calculates
    a bedrift's udledningskvote and udledning per kystvandopland, not as a
    combined total. Surplus udledningskvote in one opland cannot cover excess
    udledning in another, so the values must never be added across oplande.
    `kystvand_id` and `kystvand_navn` are None for marker without an associated
    kystvandopland, such as manually drawn marker without imk_id or the ~0.02% of the registry
    without an overlap.
    """

    kystvand_id: int | None
    kystvand_navn: str | None
    udledningskvote_kg_n: float
    beregnet_udledning_kg_n: float
    overholder: bool
