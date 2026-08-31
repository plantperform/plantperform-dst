from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.data.db import get_db
from app.data.mars_repository import get_mars_tile

router = APIRouter(prefix="/mars", tags=["mars"])
DbSession = Annotated[Session, Depends(get_db)]


@router.get("/tiles/{z}/{x}/{y}.pbf")
async def get_tile(z: int, x: int, y: int, db: DbSession) -> Response:
    tile = get_mars_tile(db, z=z, x=x, y=y)
    return Response(
        content=tile,
        media_type="application/x-protobuf",
        headers={"Cache-Control": "public, max-age=7200"},
    )
