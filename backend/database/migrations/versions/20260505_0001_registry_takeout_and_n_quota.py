"""add registry takeout and nitrogen quota

Revision ID: 20260505_0001
Revises: 20260428_0001
Create Date: 2026-05-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260505_0001"
down_revision: str | None = "20260428_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registry_field",
        sa.Column("in_takeout_plan", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "registry_field",
        sa.Column("n_quota_kg_n", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("registry_field", "n_quota_kg_n")
    op.drop_column("registry_field", "in_takeout_plan")
