from fastapi import APIRouter, HTTPException
from starlette.status import HTTP_204_NO_CONTENT

from app.data.repository import detach_field, list_fields, upsert_field
from app.domain.field import CreateFieldRequest, FieldRecord

router = APIRouter(prefix="/farms/{farm_id}/fields", tags=["farm fields"])


@router.get("", response_model=list[FieldRecord])
async def get_farm_fields(farm_id: str) -> list[FieldRecord]:
    fields = list_fields(farm_id)

    if fields is None:
        raise HTTPException(status_code=404, detail="Farm not found")

    return fields


@router.post("", response_model=FieldRecord | list[FieldRecord])
async def post_farm_fields(
    farm_id: str,
    request: CreateFieldRequest | list[CreateFieldRequest],
) -> FieldRecord | list[FieldRecord]:
    if isinstance(request, list):
        fields = [upsert_field(farm_id, field_request) for field_request in request]

        if any(field is None for field in fields):
            raise HTTPException(status_code=404, detail="Farm not found")

        return [field for field in fields if field is not None]

    field = upsert_field(farm_id, request)

    if field is None:
        raise HTTPException(status_code=404, detail="Farm not found")

    return field


@router.delete("/{field_id}", status_code=HTTP_204_NO_CONTENT)
async def detach_farm_field(farm_id: str, field_id: str) -> None:
    detached = detach_field(farm_id, field_id)

    if detached is None:
        raise HTTPException(status_code=404, detail="Farm not found")

    if not detached:
        raise HTTPException(status_code=404, detail="Field not found")
