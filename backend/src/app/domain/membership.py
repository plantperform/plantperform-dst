from typing import Literal

from pydantic import Field, field_validator

from app.domain.base import CamelModel

MembershipRole = Literal["editor", "viewer"]


class FarmMemberRequest(CamelModel):
    email: str = Field(min_length=3, max_length=320)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if value.count("@") != 1 or " " in value:
            raise ValueError("Enter a valid email address")
        return value


class FarmMemberResponse(CamelModel):
    email: str


class AddMembershipRequest(FarmMemberRequest):
    role: MembershipRole


class Membership(FarmMemberResponse):
    role: MembershipRole


class ChangeMembershipRole(CamelModel):
    role: MembershipRole


class MembershipForbidden(Exception):
    """The resource is accessible but this membership cannot perform the action."""
