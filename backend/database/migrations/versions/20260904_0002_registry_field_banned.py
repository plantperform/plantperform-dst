"""add registry_field.banned

Revision ID: 20260904_0002
Revises: 20260904_0001
Create Date: 2026-09-04

Marks fields that should not be selectable anywhere in the app (map tiles,
search, direct lookup) without deleting their row — explicit user decision
(2026-09-04): reversible ban over a destructive delete, since the source
file could regenerate these rows on a future full reload.

First (and currently only) use: the ~410 fields with no real percolation_by_
kategori/org_n_topsoil/s_soil (see migration 20260904_0001) — confirmed to be
almost entirely non-arable land (permanent græs uden norm, brak, miljøtilsagn,
natur/skov), not real sædskiftemarker, so the leaching model has nothing
meaningful to compute for them anyway.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260904_0002"
down_revision: str | None = "20260904_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registry_field",
        sa.Column("banned", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        """UPDATE registry_field
           SET banned = true
           WHERE org_n_topsoil IS NULL OR s_soil IS NULL
              OR (percolation_by_kategori->>'1') IS NULL"""
    )


def downgrade() -> None:
    op.drop_column("registry_field", "banned")
