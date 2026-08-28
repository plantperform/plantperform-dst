from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from starlette.status import HTTP_204_NO_CONTENT

from app.auth import AuthenticatedUser, current_user
from app.data.repository import detach_field, list_fields, upsert_field
from app.domain.field import CreateFieldRequest, FieldRecord

router = APIRouter(prefix="/farms/{farm_id}/fields", tags=["farm fields"])
CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]


@router.get("", response_model=list[FieldRecord])
async def get_farm_fields(
    farm_id: str,
    user: CurrentUser,
) -> list[FieldRecord]:
    fields = list_fields(farm_id, user.email)

    if fields is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    return fields


@router.post("", response_model=FieldRecord | list[FieldRecord])
async def post_farm_fields(
    farm_id: str,
    request: CreateFieldRequest | list[CreateFieldRequest],
    user: CurrentUser,
) -> FieldRecord | list[FieldRecord]:
    if isinstance(request, list):
        fields = [upsert_field(farm_id, field_request, user.email) for field_request in request]

        if any(field is None for field in fields):
            raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

        return [field for field in fields if field is not None]

    field = upsert_field(farm_id, request, user.email)

    if field is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    return field


@router.delete("/{field_id}", status_code=HTTP_204_NO_CONTENT)
async def detach_farm_field(
    farm_id: str,
    field_id: str,
    user: CurrentUser,
) -> None:
    detached = detach_field(farm_id, field_id, user.email)

    if detached is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    if not detached:
        raise HTTPException(status_code=404, detail="Mark ikke fundet")
