from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from starlette.status import HTTP_204_NO_CONTENT

from app.api.v0.memberships import membership_router, require_farm_write_access
from app.auth import AuthenticatedUser, current_user
from app.data import farm_copy_store, membership
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
from app.domain.farm import CreateFarmRequest, Farm, KystvandoplandUdledning
from app.domain.farm_copy import (
    CopyFarmRequest,
    DuplicateFarmRequest,
    FarmCopyConflictError,
    FarmCopyLookup,
    FarmCopyNotFoundError,
    FarmCopyPreview,
)
from app.domain.membership import FarmMemberRequest, FarmMemberResponse
from app.domain.read_model import FarmView
from app.services.preparation_jobs import get_or_prepare_farm_view, retry_history

router = APIRouter(prefix="/farms", tags=["farms"])
CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]


router.include_router(membership_router(membership.farms))


@router.get("", response_model=list[Farm])
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


@router.post("/{farm_id}/duplicate", response_model=Farm, status_code=201)
def duplicate_farm(farm_id: str, request: DuplicateFarmRequest, user: CurrentUser):
    try:
        return farm_copy_store.duplicate_farm(farm_id, request.request_id, user.email)
    except FarmCopyNotFoundError as error:
        raise HTTPException(status_code=404, detail="Farm not found") from error
    except FarmCopyConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("/{farm_id}", response_model=Farm)
def get_farm_by_id(
    farm_id: str,
    user: CurrentUser,
) -> Farm:
    farm = get_farm(farm_id, user.email)

    if farm is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    return farm


@router.get("/{farm_id}/view", response_model=FarmView)
def get_farm_display(farm_id: str, user: CurrentUser, include_data: bool = True):
    view = get_or_prepare_farm_view(farm_id, user.email, include_data=include_data)
    if view is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")
    return view


@router.post(
    "/{farm_id}/history/retry",
    response_model=FarmView,
    status_code=200,
    dependencies=[Depends(require_farm_write_access)],
)
def retry_farm_history(farm_id: str, user: CurrentUser):
    view = retry_history(farm_id, user.email)
    if view is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")
    return view


@router.get("/{farm_id}/udledning-per-kystvandopland", response_model=list[KystvandoplandUdledning])
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
