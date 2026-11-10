"""Authenticated rotation-group management; farm use is separate from membership."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.api.v0.farms import FarmMemberRequest, FarmMemberResponse
from app.auth import AuthenticatedUser, current_user
from app.data import saedskifte_store as store
from app.domain.saedskifte import (
    CreateRotationGroupRequest,
    DuplicateRotationGroupRequest,
    RotationGroup,
    RotationGroupNotFoundError,
    UpdateRotationGroupRequest,
)
from app.services.rotations import choices, custom, saedskifte_library
from app.services.rotations.choices import AfgrodeKodeOption

router = APIRouter(prefix="/saedskifte-rotations", tags=["sædskifte rotations"])
CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]


def _mutable(group_id):
    if not custom.is_custom(group_id):
        if group_id not in saedskifte_library.list_saedskifter():
            raise RotationGroupNotFoundError
        raise HTTPException(status_code=422, detail="Standard rotations are read-only")


@router.get("/afgrode-koder", response_model=list[AfgrodeKodeOption])
def crop_options(user: CurrentUser):
    return choices.list_afgrode_koder()


@router.get("/udlaeg-koder", response_model=list[AfgrodeKodeOption])
def udlaeg_options(
    user: CurrentUser,
    hovedafgrode_kode: int | None = None,
    driftsform: str | None = None,
    naeste_afgrode_kode: int | None = None,
):
    return choices.list_udlaeg_koder(hovedafgrode_kode, driftsform, naeste_afgrode_kode)


@router.get("", response_model=list[RotationGroup])
def list_groups(user: CurrentUser, standard: bool | None = None):
    return store.list_groups(user.email, standard)


@router.post("", response_model=RotationGroup, status_code=201)
def create_group(request: CreateRotationGroupRequest, user: CurrentUser):
    return store.create_group(request, user.email)


@router.get("/{group_id}", response_model=RotationGroup)
def get_group(group_id: str, user: CurrentUser):
    return store.get_group(group_id, user.email)


@router.patch("/{group_id}", response_model=RotationGroup)
def update_group(group_id: str, request: UpdateRotationGroupRequest, user: CurrentUser):
    _mutable(group_id)
    return store.update_group(group_id, request, user.email)


@router.delete("/{group_id}", status_code=204)
def delete_group(group_id: str, user: CurrentUser):
    _mutable(group_id)
    store.delete_group(group_id, user.email)


@router.post("/{group_id}/duplicate", response_model=RotationGroup, status_code=201)
def duplicate_group(
    group_id: str, user: CurrentUser, request: DuplicateRotationGroupRequest | None = None
):
    return store.duplicate_group(group_id, user.email, request.name if request else None)


@router.get("/{group_id}/members", response_model=list[FarmMemberResponse])
def list_members(group_id: str, user: CurrentUser):
    _mutable(group_id)
    return [FarmMemberResponse(email=email) for email in store.list_members(group_id, user.email)]


@router.post("/{group_id}/members", response_model=FarmMemberResponse, status_code=201)
def add_member(group_id: str, request: FarmMemberRequest, user: CurrentUser):
    _mutable(group_id)
    store.add_member(group_id, user.email, request.email)
    return FarmMemberResponse(email=request.email)


@router.delete("/{group_id}/members/{email}", status_code=204)
def remove_member(group_id: str, email: str, user: CurrentUser):
    _mutable(group_id)
    store.remove_member(group_id, user.email, email.strip().lower())
