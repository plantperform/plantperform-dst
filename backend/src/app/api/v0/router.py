from fastapi import APIRouter, Depends

from app.api.v0.auth import router as auth_router
from app.api.v0.economics import router as economics_router
from app.api.v0.farm_fields import router as farm_fields_router
from app.api.v0.farms import router as farms_router
from app.api.v0.field_aliases import router as field_aliases_router
from app.api.v0.healthz import router as healthz_router
from app.api.v0.mars import router as mars_router
from app.api.v0.registry import router as registry_router
from app.api.v0.rotation_candidates import router as rotation_candidates_router
from app.api.v0.saedskifte import router as saedskifte_router
from app.api.v0.simulations import router as simulations_router
from app.auth import current_user

router = APIRouter()
router.include_router(auth_router)
router.include_router(healthz_router)
router.include_router(mars_router)


def include_protected(child: APIRouter):
    # New handlers inherit authentication and deny viewers unless explicitly reviewed.
    router.include_router(child, dependencies=[Depends(current_user)])


include_protected(economics_router)
include_protected(farms_router)
include_protected(farm_fields_router)
include_protected(field_aliases_router)
include_protected(registry_router)
include_protected(rotation_candidates_router)
include_protected(simulations_router)
include_protected(saedskifte_router)
