from fastapi import APIRouter

from app.api.v0.auth import router as auth_router
from app.api.v0.farm_fields import router as farm_fields_router
from app.api.v0.farms import router as farms_router
from app.api.v0.healthz import router as healthz_router
from app.api.v0.registry import router as registry_router
from app.api.v0.rotation_candidates import router as rotation_candidates_router
from app.api.v0.simulations import router as simulations_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(healthz_router)
router.include_router(farms_router)
router.include_router(farm_fields_router)
router.include_router(registry_router)
router.include_router(rotation_candidates_router)
router.include_router(simulations_router)
