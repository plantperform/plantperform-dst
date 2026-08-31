"""add registry_field.goedningsregion

Revision ID: 20260828_0002
Revises: 20260828_0001
Create Date: 2026-08-28

Assigns each registry field one of the 7 gødningsregioner (Sjælland, Fyn,
Østjylland, Nordjylland, Vestjylland, Lolland/Falster, Bornholm) via
centroid-in-region, with nearest-region fallback for the ~10.6% of fields
whose centroid fell just outside the simplified region polygons (see
database/data/raw/ANGJ-data/Marker 24-25-25/Goedningsregioner_midlertidig.gpkg).
This column was first added ad hoc directly against the running database;
this migration formalizes it so a fresh database gets the same column
(existing databases already have it populated and are unaffected by
upgrade(), which uses IF NOT EXISTS).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0002"
down_revision: str | None = "20260828_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE registry_field ADD COLUMN IF NOT EXISTS goedningsregion TEXT")


def downgrade() -> None:
    op.drop_column("registry_field", "goedningsregion")
