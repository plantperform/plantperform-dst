"""Supply a local database URL before importing database-backed modules in unit tests."""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://dst2:dst2@localhost:5432/dst2")
