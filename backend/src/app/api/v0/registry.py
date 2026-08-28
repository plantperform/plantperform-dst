from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.auth import AuthenticatedUser, current_user
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
CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]
DbSession = Annotated[Session, Depends(get_db)]
OwnedByFarmId = Annotated[str | None, Query(alias="ownedByFarmId")]
FocusCvr = Annotated[str | None, Query(alias="focusCvr")]


@router.get("/fields/search", response_model=list[RegistryFieldSummary])
async def search_fields(
    db: DbSession,
    _: CurrentUser,
    cvr: str | None = None,
    limit: int = 100,
) -> list[RegistryFieldSummary]:
    return search_registry_fields(db, cvr=cvr, limit=limit)


@router.get("/fields/bounds", response_model=RegistryBounds)
async def get_field_bounds(
    db: DbSession,
    _: CurrentUser,
    cvr: str | None = None,
    imk_ids: str | None = Query(default=None, alias="imkIds"),
) -> RegistryBounds:
    parsed_imk_ids = [int(value) for value in imk_ids.split(",") if value] if imk_ids else []
    bounds = get_registry_bounds(db, cvr=cvr, imk_ids=parsed_imk_ids)

    if bounds is None:
        raise HTTPException(status_code=404, detail="Ingen registerudstrækning fundet")

    return bounds


@router.get("/fields/bulk", response_model=list[RegistryField])
async def get_fields(
    db: DbSession,
    _: CurrentUser,
    imk_ids: str = Query(alias="imkIds"),
) -> list[RegistryField]:
    parsed_imk_ids = [int(value) for value in imk_ids.split(",") if value]
    fields = get_registry_fields(db, parsed_imk_ids)

    if len(fields) != len(set(parsed_imk_ids)):
        raise HTTPException(
            status_code=404, detail="Én eller flere registermarker blev ikke fundet"
        )

    return fields


@router.get("/fields/{imk_id}", response_model=RegistryField)
async def get_field(
    imk_id: int,
    db: DbSession,
    _: CurrentUser,
) -> RegistryField:
    field = get_registry_field(db, imk_id)

    if field is None:
        raise HTTPException(status_code=404, detail="Registermark ikke fundet")

    return field


@router.get("/tiles/{z}/{x}/{y}.pbf")
async def get_tile(
    z: int,
    x: int,
    y: int,
    db: DbSession,
    user: CurrentUser,
    cvr: str | None = None,
    focus_cvr: FocusCvr = None,
    owned_by_farm_id: OwnedByFarmId = None,
) -> Response:
    if owned_by_farm_id is not None:
        farm_fields = list_fields(owned_by_farm_id, user.email)
        if farm_fields is None:
            raise HTTPException(status_code=404, detail="Farm not found")
    else:
        farm_fields = []
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
        headers={"Cache-Control": "private, max-age=7200"},
    )
