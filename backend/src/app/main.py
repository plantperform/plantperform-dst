import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app.api.v0.router import router as v0_router
from app.auth import configured_origins, validate_aws_region
from app.data.creation_store import recover_local_jobs
from app.data.optimization_store import recover_local_runs
from app.domain.creation import CreationNotReadyError
from app.services.optimization.jobs import is_production
from app.services.optimization.local import start_local_optimizer


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    logging.basicConfig(level=logging.INFO)
    if is_production():
        validate_aws_region()
        yield
    else:
        optimizer = start_local_optimizer()
        try:
            await run_in_threadpool(recover_local_runs)
            await run_in_threadpool(recover_local_jobs)
            yield
        finally:
            await run_in_threadpool(optimizer.close)


app = FastAPI(title="DST API", lifespan=lifespan)


@app.exception_handler(CreationNotReadyError)
async def creation_not_ready(_: Request, error: CreationNotReadyError):
    return JSONResponse(status_code=409, content={"detail": str(error)})


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
