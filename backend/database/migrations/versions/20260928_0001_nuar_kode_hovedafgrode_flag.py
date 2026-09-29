"""add er_hovedafgrode flag to nuar_kode

Revision ID: 20260928_0001
Revises: 20260922_0001
Create Date: 2026-09-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0001"
down_revision: str | None = "20260922_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "nuar_kode",
        sa.Column("er_hovedafgrode", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.alter_column("nuar_kode", "er_hovedafgrode", server_default=None)


def downgrade() -> None:
    op.drop_column("nuar_kode", "er_hovedafgrode")
