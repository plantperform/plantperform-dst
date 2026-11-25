"""Role-aware sharing routes common to all three resource types."""

from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import AuthenticatedUser, current_user
from app.data import membership, repository
from app.domain.membership import (
    AddMembershipRequest,
    ChangeMembershipRole,
    Membership,
    MembershipEntry,
)

CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]


def require_farm_write_access(farm_id: str, request: Request, user: CurrentUser):
    if request.method in {"GET", "HEAD"}:
        return
    with repository.SessionLocal() as session:
        if not membership.farms.is_editor(session, farm_id, user.email):
            raise HTTPException(status_code=404, detail="Bedrift ikke fundet")


def _check(result):
    errors = {
        "not_found": (404, "Resource not found"),
        "user_not_found": (404, "Verified user not found"),
        "member_not_found": (404, "Member not found"),
        "already_member": (409, "User is already a member"),
        "last_member": (409, "At least one editor must remain"),
        "creator": (409, "Only the creator can remove or demote themselves"),
    }
    if result in errors:
        code, detail = errors[result]
        raise HTTPException(status_code=code, detail=detail)


def membership_router(
    store: membership.ResourceMemberships, validate: Callable[[str], None] | None = None
) -> APIRouter:
    def validate_resource(resource_id: str):
        if validate:
            validate(resource_id)

    router = APIRouter(
        prefix="/{resource_id}/memberships",
        dependencies=[Depends(current_user), Depends(validate_resource)],
    )

    @router.get("", response_model=list[MembershipEntry], response_model_exclude_none=True)
    def list_memberships(resource_id: str, user: CurrentUser):
        with repository.SessionLocal() as session:
            entries = store.list(session, resource_id, user.email)
        if entries is None:
            raise HTTPException(status_code=404, detail="Resource not found")
        return entries

    @router.post("", response_model=Membership, status_code=201)
    def add_membership(resource_id: str, request: AddMembershipRequest, user: CurrentUser):
        with repository.SessionLocal.begin() as session:
            _check(store.add(session, resource_id, user.email, request.email, request.role))
        return request

    @router.patch("/{email}", response_model=Membership)
    def update_membership(
        resource_id: str, email: str, request: ChangeMembershipRole, user: CurrentUser
    ):
        email = email.strip().lower()
        with repository.SessionLocal.begin() as session:
            _check(store.change(session, resource_id, user.email, email, request.role))
        return Membership(email=email, role=request.role)

    @router.delete("/{email}", status_code=204)
    def remove_membership(resource_id: str, email: str, user: CurrentUser):
        with repository.SessionLocal.begin() as session:
            _check(store.change(session, resource_id, user.email, email.strip().lower(), None))

    return router
