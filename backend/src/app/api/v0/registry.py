from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.data.db import get_db
from app.data.registry_repository import (
    get_registry_bounds,
    get_registry_field,
    get_registry_fields,
    get_registry_tile,
    search_registry_fields,
)
from app.data.repository import list_fields
from app.domain.registry import RegistryBounds, RegistryField, RegistryFieldSummary

router = APIRouter(prefix="/registry", tags=["registry"])
DbSession = Annotated[Session, Depends(get_db)]
OwnedByFarmId = Annotated[str | None, Query(alias="ownedByFarmId")]
FocusCvr = Annotated[str | None, Query(alias="focusCvr")]


@router.get("/fields/search", response_model=list[RegistryFieldSummary])
async def search_fields(
    db: DbSession,
    cvr: str | None = None,
    limit: int = 100,
) -> list[RegistryFieldSummary]:
    return search_registry_fields(db, cvr=cvr, limit=limit)


@router.get("/fields/bounds", response_model=RegistryBounds)
async def get_field_bounds(
    db: DbSession,
    cvr: str | None = None,
    imk_ids: str | None = Query(default=None, alias="imkIds"),
) -> RegistryBounds:
    parsed_imk_ids = [int(value) for value in imk_ids.split(",") if value] if imk_ids else []
    bounds = get_registry_bounds(db, cvr=cvr, imk_ids=parsed_imk_ids)

    if bounds is None:
        raise HTTPException(status_code=404, detail="No registry bounds found")

    return bounds


@router.get("/fields/bulk", response_model=list[RegistryField])
async def get_fields(
    db: DbSession,
    imk_ids: str = Query(alias="imkIds"),
) -> list[RegistryField]:
    parsed_imk_ids = [int(value) for value in imk_ids.split(",") if value]
    fields = get_registry_fields(db, parsed_imk_ids)

    if len(fields) != len(set(parsed_imk_ids)):
        raise HTTPException(status_code=404, detail="One or more registry fields were not found")

    return fields


@router.get("/fields/{imk_id}", response_model=RegistryField)
async def get_field(imk_id: int, db: DbSession) -> RegistryField:
    field = get_registry_field(db, imk_id)

    if field is None:
        raise HTTPException(status_code=404, detail="Registry field not found")

    return field


@router.get("/tiles/{z}/{x}/{y}.pbf")
async def get_tile(
    z: int,
    x: int,
    y: int,
    db: DbSession,
    cvr: str | None = None,
    focus_cvr: FocusCvr = None,
    owned_by_farm_id: OwnedByFarmId = None,
) -> Response:
    farm_fields = list_fields(owned_by_farm_id) if owned_by_farm_id is not None else []
    owned_imk_ids = [field.imk_id for field in (farm_fields or []) if field.imk_id is not None]
    tile = get_registry_tile(
        db,
        z=z,
        x=x,
        y=y,
        cvr=cvr,
        focus_cvr=focus_cvr,
        owned_imk_ids=owned_imk_ids,
    )
    return Response(
        content=tile,
        media_type="application/x-protobuf",
        headers={"Cache-Control": "public, max-age=7200"},
    )
