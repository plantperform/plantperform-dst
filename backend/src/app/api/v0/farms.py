from fastapi import APIRouter, HTTPException
from starlette.status import HTTP_204_NO_CONTENT

from app.data.repository import create_farm, delete_farm, get_farm, list_farms, update_farm
from app.domain.farm import CreateFarmRequest, Farm, UpdateFarmRequest

router = APIRouter(prefix="/farms", tags=["farms"])


@router.get("", response_model=list[Farm])
async def get_farms() -> list[Farm]:
    return list_farms()


@router.post("", response_model=Farm)
async def post_farm(request: CreateFarmRequest) -> Farm:
    return create_farm(request)


@router.get("/{farm_id}", response_model=Farm)
async def get_farm_by_id(farm_id: str) -> Farm:
    farm = get_farm(farm_id)

    if farm is None:
        raise HTTPException(status_code=404, detail="Farm not found")

    return farm


@router.patch("/{farm_id}", response_model=Farm)
async def patch_farm(farm_id: str, request: UpdateFarmRequest) -> Farm:
    farm = update_farm(farm_id, request)

    if farm is None:
        raise HTTPException(status_code=404, detail="Farm not found")

    return farm


@router.delete("/{farm_id}", status_code=HTTP_204_NO_CONTENT)
async def delete_farm_by_id(farm_id: str) -> None:
    deleted = delete_farm(farm_id)

    if not deleted:
        raise HTTPException(status_code=404, detail="Farm not found")
