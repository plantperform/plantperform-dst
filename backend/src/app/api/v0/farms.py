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
    get_farm_udledning_per_kystvandopland,
    list_farm_members,
    list_farms,
    remove_farm_member,
)
from app.domain.base import CamelModel
from app.domain.farm import CreateFarmRequest, Farm, KystvandoplandUdledning

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
def get_farms(user: CurrentUser) -> list[Farm]:
    return list_farms(user.email)


@router.post("", response_model=Farm)
def post_farm(
    request: CreateFarmRequest,
    user: CurrentUser,
) -> Farm:
    return create_farm(request, user.email)


@router.get("/{farm_id}", response_model=Farm)
def get_farm_by_id(
    farm_id: str,
    user: CurrentUser,
) -> Farm:
    farm = get_farm(farm_id, user.email)

    if farm is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    return farm


@router.get("/{farm_id}/udledning-per-kystvandopland", response_model=list[KystvandoplandUdledning])
def get_farm_udledning(
    farm_id: str,
    user: CurrentUser,
) -> list[KystvandoplandUdledning]:
    """Udledningskvote og beregnet udledning ("Aktuel") pr. kystvandopland —
    bekendtgørelsens faktiske opgørelsesenhed, jf. KystvandoplandUdledning."""
    result = get_farm_udledning_per_kystvandopland(farm_id, user.email)

    if result is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    return result


@router.delete("/{farm_id}", status_code=HTTP_204_NO_CONTENT)
def delete_farm_by_id(
    farm_id: str,
    user: CurrentUser,
) -> None:
    deleted = delete_farm(farm_id, user.email)

    if not deleted:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")


@router.get("/{farm_id}/members", response_model=list[FarmMemberResponse])
def get_farm_members(
    farm_id: str,
    user: CurrentUser,
) -> list[FarmMemberResponse]:
    members = list_farm_members(farm_id, user.email)
    if members is None:
        raise HTTPException(status_code=404, detail="Farm not found")
    return [FarmMemberResponse(email=email) for email in members]


@router.post("/{farm_id}/members", response_model=FarmMemberResponse, status_code=201)
def post_farm_member(
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
def delete_farm_member(
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
