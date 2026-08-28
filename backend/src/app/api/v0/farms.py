from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, field_validator
from starlette.status import HTTP_204_NO_CONTENT

from app.auth import AuthenticatedUser, current_user
from app.data.repository import (
    add_farm_member,
    create_farm,
    delete_farm,
    get_farm,
    list_farm_members,
    list_farms,
    remove_farm_member,
    update_farm,
)
from app.domain.base import CamelModel
from app.domain.farm import CreateFarmRequest, Farm, UpdateFarmRequest

router = APIRouter(prefix="/farms", tags=["farms"])
CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]


class FarmMemberRequest(CamelModel):
    email: str = Field(min_length=3, max_length=320)

    @field_validator("email")
    @classmethod
    def normalize_member_email(cls, value: str) -> str:
        value = value.strip().lower()
        if value.count("@") != 1 or " " in value:
            raise ValueError("Enter a valid email address")
        return value


class FarmMemberResponse(CamelModel):
    email: str


@router.get("", response_model=list[Farm])
async def get_farms(user: CurrentUser) -> list[Farm]:
    return list_farms(user.email)


@router.post("", response_model=Farm)
async def post_farm(
    request: CreateFarmRequest,
    user: CurrentUser,
) -> Farm:
    return create_farm(request, user.email)


@router.get("/{farm_id}", response_model=Farm)
async def get_farm_by_id(
    farm_id: str,
    user: CurrentUser,
) -> Farm:
    farm = get_farm(farm_id, user.email)

    if farm is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    return farm


@router.patch("/{farm_id}", response_model=Farm)
async def patch_farm(
    farm_id: str,
    request: UpdateFarmRequest,
    user: CurrentUser,
) -> Farm:
    farm = update_farm(farm_id, request, user.email)

    if farm is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    return farm


@router.delete("/{farm_id}", status_code=HTTP_204_NO_CONTENT)
async def delete_farm_by_id(
    farm_id: str,
    user: CurrentUser,
) -> None:
    deleted = delete_farm(farm_id, user.email)

    if not deleted:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")


@router.get("/{farm_id}/members", response_model=list[FarmMemberResponse])
async def get_farm_members(
    farm_id: str,
    user: CurrentUser,
) -> list[FarmMemberResponse]:
    members = list_farm_members(farm_id, user.email)
    if members is None:
        raise HTTPException(status_code=404, detail="Farm not found")
    return [FarmMemberResponse(email=email) for email in members]


@router.post("/{farm_id}/members", response_model=FarmMemberResponse, status_code=201)
async def post_farm_member(
    farm_id: str,
    request: FarmMemberRequest,
    user: CurrentUser,
) -> FarmMemberResponse:
    result = add_farm_member(farm_id, user.email, request.email)
    if result == "farm_not_found":
        raise HTTPException(status_code=404, detail="Farm not found")
    if result == "user_not_found":
        raise HTTPException(status_code=404, detail="Verified user not found")
    if result == "already_member":
        raise HTTPException(status_code=409, detail="User is already a farm member")
    return FarmMemberResponse(email=request.email)


@router.delete("/{farm_id}/members/{member_email}", status_code=HTTP_204_NO_CONTENT)
async def delete_farm_member(
    farm_id: str,
    member_email: str,
    user: CurrentUser,
) -> None:
    result = remove_farm_member(farm_id, user.email, member_email.strip().lower())
    if result == "farm_not_found":
        raise HTTPException(status_code=404, detail="Farm not found")
    if result == "last_member":
        raise HTTPException(status_code=409, detail="A farm must have at least one member")
    if result == "member_not_found":
        raise HTTPException(status_code=404, detail="Farm member not found")
