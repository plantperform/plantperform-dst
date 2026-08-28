import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v0.router import router as v0_router
from app.auth import configured_origins, validate_aws_region


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if os.getenv("APP_ENV", "development").lower() == "production":
        validate_aws_region()
    yield


app = FastAPI(title="DST API", lifespan=lifespan)

allowed_origins = configured_origins()

# By default, only the configured public frontend origin is allowed. Local or
# multi-origin setups can provide CORS_ORIGINS explicitly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v0_router, prefix="/api/v0")
