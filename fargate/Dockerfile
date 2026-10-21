FROM python:3.13-slim-bookworm
COPY fargate/requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --only-binary=:all: -r /tmp/requirements.lock
COPY backend/pyproject.toml /tmp/backend/pyproject.toml
COPY backend/src /tmp/backend/src
COPY fargate/pyproject.toml /tmp/fargate/pyproject.toml
COPY fargate/src /tmp/fargate/src
RUN pip install --no-cache-dir --no-deps /tmp/backend /tmp/fargate && rm -rf /tmp/backend /tmp/fargate
ENV PYTHONUNBUFFERED=1 DB_POOL_SIZE=2 DB_MAX_OVERFLOW=0 OPTIMIZER_SOLVER_THREADS=4
CMD ["python", "-m", "plantperform_fargate"]
