from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.data.db import get_db
from app.data.paragraf3_repository import get_paragraf3_tile

router = APIRouter(prefix="/paragraf3", tags=["paragraf3"])
DbSession = Annotated[Session, Depends(get_db)]


@router.get("/tiles/{z}/{x}/{y}.pbf")
def get_tile(z: int, x: int, y: int, db: DbSession) -> Response:
    tile = get_paragraf3_tile(db, z=z, x=x, y=y)
    return Response(
        content=tile,
        media_type="application/x-protobuf",
        headers={"Cache-Control": "public, max-age=7200"},
    )
