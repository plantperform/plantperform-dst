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
    """Udledningskvote og beregnet udledning for ét kystvandopland, for en
    bedrifts nuværende ("Aktuel") marker. Bekendtgørelsen opgør en bedrifts
    kvote og udledning PR. kystvandopland, ikke samlet — en bedrift med
    overskydende kvote i ét opland kan ikke bruge den til at dække en
    overskridelse i et andet, så kvote og udledning må aldrig lægges sammen
    på tværs af oplande. `kystvand_id`/`kystvand_navn` er None for marker
    uden et tilknyttet kystvandopland (fx manuelt tegnede marker uden
    imk_id, eller det ~0,02% af registret uden overlap)."""

    kystvand_id: int | None
    kystvand_navn: str | None
    udledningskvote_kg_n: float
    beregnet_udledning_kg_n: float
    overholder: bool
