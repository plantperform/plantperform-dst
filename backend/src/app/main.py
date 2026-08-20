from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v0.router import router as v0_router

app = FastAPI(title="DST API")

# We currently only allow the frontend on the same domain, and local development on localhost:5173.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v0_router, prefix="/api/v0")
