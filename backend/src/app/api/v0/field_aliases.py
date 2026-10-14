from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth import AuthenticatedUser, current_user
from app.data.field_alias_store import list_aliases

router = APIRouter(prefix="/field-aliases", tags=["field aliases"])
CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]


@router.get("", response_model=dict[str, str])
def get_field_aliases(user: CurrentUser) -> dict[str, str]:
    return list_aliases(user.email)
