"""Authenticated module lifecycle and the real reference assumption catalogue."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, field_validator

from app.api.v0.farms import FarmMemberRequest, FarmMemberResponse
from app.auth import AuthenticatedUser, current_user
from app.data import economics_store
from app.domain.base import CamelModel
from app.domain.economics import (
    STANDARD_ID,
    CreateEconomicsModuleRequest,
    EconomicsConflictError,
    EconomicsModule,
    EconomicsModuleNotFoundError,
    UpdateEconomicsModuleRequest,
)
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


@router.get("/economics-modules", response_model=list[EconomicsModule])
def get_modules(user: CurrentUser):
    return economics_store.list_modules(user.email)


@router.post("/economics-modules", response_model=EconomicsModule, status_code=201)
def post_module(request: CreateEconomicsModuleRequest, user: CurrentUser):
    return _call(economics_store.create_module, request, user.email)


@router.get("/economics-modules/{module_id}", response_model=EconomicsModule)
def get_module(module_id: str, user: CurrentUser):
    return _call(economics_store.get_module, module_id, user.email)


@router.patch("/economics-modules/{module_id}", response_model=EconomicsModule)
def patch_module(module_id: str, request: UpdateEconomicsModuleRequest, user: CurrentUser):
    return _call(economics_store.update_module, module_id, request, user.email, module_id=module_id)


@router.delete("/economics-modules/{module_id}", status_code=204)
def delete_module(module_id: str, user: CurrentUser):
    _call(economics_store.delete_module, module_id, user.email, module_id=module_id)


class DuplicateRequest(CamelModel):
    name: str | None = Field(default=None, min_length=1)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value):
        if value is None or not value.strip():
            raise ValueError("Give the economics module a name")
        return value.strip()


@router.post(
    "/economics-modules/{module_id}/duplicate", response_model=EconomicsModule, status_code=201
)
def duplicate_module(module_id: str, user: CurrentUser, request: DuplicateRequest | None = None):
    return _call(
        economics_store.duplicate_module, module_id, user.email, request.name if request else None
    )


@router.get("/economics-modules/{module_id}/members", response_model=list[FarmMemberResponse])
def get_members(module_id: str, user: CurrentUser):
    return [
        FarmMemberResponse(email=email)
        for email in _call(economics_store.list_members, module_id, user.email, module_id=module_id)
    ]


@router.post(
    "/economics-modules/{module_id}/members", response_model=FarmMemberResponse, status_code=201
)
def post_member(module_id: str, request: FarmMemberRequest, user: CurrentUser):
    result = _call(
        economics_store.add_member, module_id, user.email, request.email, module_id=module_id
    )
    if result == "user_not_found":
        raise HTTPException(status_code=404, detail="Verified user not found")
    if result == "already_member":
        raise HTTPException(status_code=409, detail="User is already a module member")
    return FarmMemberResponse(email=request.email)


@router.delete("/economics-modules/{module_id}/members/{email}", status_code=204)
def delete_member(module_id: str, email: str, user: CurrentUser):
    result = _call(
        economics_store.remove_member,
        module_id,
        user.email,
        email.strip().lower(),
        module_id=module_id,
    )
    if result == "last_member":
        raise HTTPException(status_code=409, detail="A module must have at least one member")
    if result == "member_not_found":
        raise HTTPException(status_code=404, detail="Module member not found")
