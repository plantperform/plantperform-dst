from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from starlette.status import HTTP_204_NO_CONTENT

from app.api.v0.simulations import YearlySummaryEntryResponse
from app.auth import AuthenticatedUser, current_user
from app.data.repository import (
    detach_field,
    get_farm_historical_yearly_summary,
    get_field_historical_years,
    list_fields,
    upsert_field,
)
from app.domain.field import CreateFieldRequest, FieldRecord
from app.domain.rotation_candidate import RotationCandidateYearResult

router = APIRouter(prefix="/farms/{farm_id}/fields", tags=["farm fields"])
CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]


@router.get("", response_model=list[FieldRecord])
def get_farm_fields(
    farm_id: str,
    user: CurrentUser,
) -> list[FieldRecord]:
    fields = list_fields(farm_id, user.email)

    if fields is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    return fields


@router.post("", response_model=FieldRecord | list[FieldRecord])
def post_farm_fields(
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


@router.get(
    "/historical-yearly-summary",
    response_model=list[YearlySummaryEntryResponse],
)
def get_farm_historical_yearly_summary_route(
    farm_id: str,
    user: CurrentUser,
) -> list[YearlySummaryEntryResponse]:
    """Som simulations.py's yearly-summary, men for "Afgrødehistorik" —
    summeret pr. rigtigt kalenderår (2019-2026) på tværs af bedriftens egne
    marker i stedet for en simulerings kandidater."""
    summary = get_farm_historical_yearly_summary(farm_id, user.email)

    if summary is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    return [YearlySummaryEntryResponse(**entry) for entry in summary]


@router.get(
    "/{field_id}/historical-detail",
    response_model=list[RotationCandidateYearResult],
)
def get_farm_field_historical_detail(
    farm_id: str,
    field_id: str,
    user: CurrentUser,
) -> list[RotationCandidateYearResult]:
    """Markens egen ægte 8-positions historik (2019-2026) med fuld
    leaching_detail/db_detail pr. år — samme beregningsgennemgang
    ("Afgrødehistorik") som simulerings-kandidaters candidate-detail,
    men ud fra markens rigtige crop_history i stedet for et scenarie."""
    years = get_field_historical_years(farm_id, field_id, user.email)

    if years is None:
        raise HTTPException(status_code=404, detail="Bedrift eller mark ikke fundet")

    return years


@router.delete("/{field_id}", status_code=HTTP_204_NO_CONTENT)
def detach_farm_field(
    farm_id: str,
    field_id: str,
    user: CurrentUser,
) -> None:
    detached = detach_field(farm_id, field_id, user.email)

    if detached is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    if not detached:
        raise HTTPException(status_code=404, detail="Mark ikke fundet")
