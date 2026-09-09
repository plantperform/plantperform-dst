"""add registry field soil data and banned flag

Revision ID: 20260909_0001
Revises: 20260831_0001
Create Date: 2026-09-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260909_0001"
down_revision: str | None = "20260831_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registry_field",
        sa.Column("percolation_by_kategori", sa.JSON(), nullable=True),
    )
    op.add_column("registry_field", sa.Column("org_n_topsoil", sa.Float(), nullable=True))
    op.add_column("registry_field", sa.Column("s_soil", sa.Float(), nullable=True))
    op.add_column(
        "registry_field",
        sa.Column("banned", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("registry_field", "banned")
    op.drop_column("registry_field", "s_soil")
    op.drop_column("registry_field", "org_n_topsoil")
    op.drop_column("registry_field", "percolation_by_kategori")
