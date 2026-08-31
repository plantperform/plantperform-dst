"""add registry_field.markblok / journalnr

Revision ID: 20260827_0002
Revises: 20260827_0001
Create Date: 2026-08-27

Persisted so fields stay identifiable across future yearly reloads —
Markblok is confirmed stable year to year (>=96% overlap 2024/2025->2026),
and (Marknr, Journalnr, Markblok) is a fully unique triple in Marker_2026.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260827_0002"
down_revision: str | None = "20260827_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("registry_field", sa.Column("markblok", sa.Text(), nullable=True))
    op.add_column("registry_field", sa.Column("journalnr", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("registry_field", "journalnr")
    op.drop_column("registry_field", "markblok")
