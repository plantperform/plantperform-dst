"""add grund6procent flag to nuar_kode

Revision ID: 20260928_0002
Revises: 20260928_0001
Create Date: 2026-09-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0002"
down_revision: str | None = "20260928_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "nuar_kode",
        sa.Column("grund6procent", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("nuar_kode", "grund6procent", server_default=None)


def downgrade() -> None:
    op.drop_column("nuar_kode", "grund6procent")
