"""Authenticated module lifecycle, the real reference assumption catalogue and crop budgets."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import Field, field_validator

from app.auth import AuthenticatedUser, current_user
from app.data import economics_store
from app.domain.base import CamelModel
from app.domain.economics import (
    STANDARD_ID,
    CreateEconomicsModuleRequest,
    CropBudgets,
    EconomicsConflictError,
    EconomicsModule,
    EconomicsModuleNotFoundError,
    UpdateEconomicsModuleRequest,
)
from app.services.economics.budget import farm_budgets
from app.services.economics.overrides import assumptions

router = APIRouter(tags=["economics"])
CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]


def _call(action, *args, module_id=None):
    if module_id == STANDARD_ID:
        raise HTTPException(status_code=422, detail="Standard economics is immutable")
    try:
        return action(*args)
    except EconomicsModuleNotFoundError as error:
        raise HTTPException(status_code=404, detail="Economics module not found") from error
    except EconomicsConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/economics/assumptions")
def get_assumptions(user: CurrentUser):
    return assumptions()


@router.get("/farms/{farm_id}/economics/budgets", response_model=CropBudgets)
def get_farm_budgets(
    farm_id: str,
    user: CurrentUser,
    farming_system: Annotated[
        Literal["Konventionel", "Økologisk"], Query(alias="farmingSystem")
    ] = "Konventionel",
    simulation_id: Annotated[str | None, Query(alias="simulationId")] = None,
):
    budgets = farm_budgets(farm_id, user.email, farming_system, simulation_id)
    if budgets is None:
        raise HTTPException(status_code=404, detail="Bedrift eller simulering ikke fundet")
    return budgets


MODULES = "/farms/{farm_id}/economics-modules"


@router.get(MODULES, response_model=list[EconomicsModule])
def get_modules(farm_id: str, user: CurrentUser):
    return _call(economics_store.list_modules, farm_id, user.email)


@router.post(MODULES, response_model=EconomicsModule, status_code=201)
def post_module(farm_id: str, request: CreateEconomicsModuleRequest, user: CurrentUser):
    return _call(economics_store.create_module, farm_id, request, user.email)


@router.get(MODULES + "/{module_id}", response_model=EconomicsModule)
def get_module(farm_id: str, module_id: str, user: CurrentUser):
    return _call(economics_store.get_module, farm_id, module_id, user.email)


@router.patch(MODULES + "/{module_id}", response_model=EconomicsModule)
def patch_module(
    farm_id: str, module_id: str, request: UpdateEconomicsModuleRequest, user: CurrentUser
):
    return _call(
        economics_store.update_module, farm_id, module_id, request, user.email, module_id=module_id
    )


@router.delete(MODULES + "/{module_id}", status_code=204)
def delete_module(farm_id: str, module_id: str, user: CurrentUser):
    _call(economics_store.delete_module, farm_id, module_id, user.email, module_id=module_id)


class DuplicateRequest(CamelModel):
    name: str | None = Field(default=None, min_length=1)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value):
        if value is None or not value.strip():
            raise ValueError("Give the economics module a name")
        return value.strip()


@router.post(MODULES + "/{module_id}/duplicate", response_model=EconomicsModule, status_code=201)
def duplicate_module(
    farm_id: str, module_id: str, user: CurrentUser, request: DuplicateRequest | None = None
):
    return _call(
        economics_store.duplicate_module,
        farm_id,
        module_id,
        user.email,
        request.name if request else None,
    )
