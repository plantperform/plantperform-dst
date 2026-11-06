from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, field_validator
from starlette.status import HTTP_204_NO_CONTENT

from app.auth import AuthenticatedUser, current_user, viewer_read
from app.data import farm_copy_store, read_model_store
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
from app.domain.farm_copy import (
    CopyFarmRequest,
    FarmCopyConflictError,
    FarmCopyLookup,
    FarmCopyNotFoundError,
    FarmCopyPreview,
)
from app.domain.read_model import FarmView
from app.services.preparation_jobs import get_or_prepare_farm_view, retry_history

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
@viewer_read
def get_farms(user: CurrentUser) -> list[Farm]:
    return list_farms(user.email)


@router.post("", response_model=Farm)
def post_farm(
    request: CreateFarmRequest,
    user: CurrentUser,
) -> Farm:
    return create_farm(request, user.email)


@router.post("/copy/preview", response_model=FarmCopyPreview)
def preview_farm_copy(request: FarmCopyLookup, user: CurrentUser):
    try:
        return farm_copy_store.preview(request)
    except FarmCopyNotFoundError as error:
        raise HTTPException(
            status_code=404, detail="Ingen bedrift matcher navnet og ejeren. Ret oplysningerne."
        ) from error
    except FarmCopyConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/copy", response_model=Farm, status_code=201)
def copy_farm(request: CopyFarmRequest, user: CurrentUser):
    try:
        return farm_copy_store.copy_farm(request, user.email)
    except FarmCopyNotFoundError as error:
        raise HTTPException(
            status_code=404, detail="Ingen bedrift matcher navnet og ejeren. Ret oplysningerne."
        ) from error
    except FarmCopyConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("/{farm_id}", response_model=Farm)
@viewer_read
def get_farm_by_id(
    farm_id: str,
    user: CurrentUser,
) -> Farm:
    farm = get_farm(farm_id, user.email)

    if farm is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    return farm


@router.get("/{farm_id}/view", response_model=FarmView)
@viewer_read
def get_farm_display(farm_id: str, user: CurrentUser, include_data: bool = True):
    load = read_model_store.get_farm_view if user.role == "viewer" else get_or_prepare_farm_view
    view = load(farm_id, user.email, include_data=include_data)
    if view is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")
    if user.role == "viewer" and view["status"] == "queued":
        view = {**view, "status": "missing"}
    return view


@router.post("/{farm_id}/history/retry", response_model=FarmView, status_code=200)
def retry_farm_history(farm_id: str, user: CurrentUser):
    view = retry_history(farm_id, user.email)
    if view is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")
    return view


@router.get("/{farm_id}/udledning-per-kystvandopland", response_model=list[KystvandoplandUdledning])
@viewer_read
def get_farm_udledning(
    farm_id: str,
    user: CurrentUser,
) -> list[KystvandoplandUdledning]:
    """Udledningskvote and calculated udledning ("Aktuel") per kystvandopland,
    the bekendtgørelse's actual unit of accounting; see KystvandoplandUdledning."""
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
        raise HTTPException(status_code=409, detail="A farm must have at least one editor")
    if result == "member_not_found":
        raise HTTPException(status_code=404, detail="Farm member not found")
