FROM python:3.13-slim-bookworm
COPY optimizer/requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --only-binary=:all: -r /tmp/requirements.lock
COPY backend/pyproject.toml /tmp/backend/pyproject.toml
COPY backend/src /tmp/backend/src
COPY optimizer/pyproject.toml /tmp/optimizer/pyproject.toml
COPY optimizer/src /tmp/optimizer/src
RUN pip install --no-cache-dir --no-deps /tmp/backend /tmp/optimizer && rm -rf /tmp/backend /tmp/optimizer
ENV PYTHONUNBUFFERED=1 DB_POOL_SIZE=2 DB_MAX_OVERFLOW=0 OPTIMIZER_SOLVER_THREADS=4
CMD ["python", "-m", "optimizer"]
