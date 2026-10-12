"""Creation execution inputs travel with the queue message, never in job metadata."""

from typing import Literal
from uuid import NAMESPACE_URL, uuid5

from pydantic import Field, field_validator

from app.domain.base import CamelModel
from app.domain.simulation import CreateSimulationRequest


def creation_job_id(simulation_id: str, revision: int) -> str:
    return str(uuid5(NAMESPACE_URL, f"plantperform:creation:{simulation_id}:{revision}"))


def optimization_run_id(simulation_id: str, revision: int) -> str:
    return str(uuid5(NAMESPACE_URL, f"plantperform:creation-optimize:{simulation_id}:{revision}"))


class CreationJob(CamelModel):
    job_type: Literal["create_simulation"] = "create_simulation"
    farm_id: str = Field(min_length=1)
    simulation_id: str = Field(min_length=1)
    job_id: str = Field(min_length=1)
    requested_by: str = Field(min_length=1)
    expected_revision: int = Field(ge=0, strict=True)
    parameters: CreateSimulationRequest

    @field_validator("farm_id", "simulation_id", "job_id", "requested_by")
    @classmethod
    def require_nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Creation job identifiers and requester must not be blank")
        return value

    def envelope(self) -> dict:
        return self.model_dump(mode="json", by_alias=True, exclude={"parameters": {"request_id"}})
