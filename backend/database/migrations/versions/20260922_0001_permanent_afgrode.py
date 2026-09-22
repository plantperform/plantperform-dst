"""create permanent_afgrode runtime lookup

Revision ID: 20260922_0001
Revises: 20260911_0001
Create Date: 2026-09-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260922_0001"
down_revision: str | None = "20260911_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "permanent_afgrode",
        sa.Column("afgroedekode", sa.Integer(), nullable=False, autoincrement=False),
        sa.Column("navn", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("afgroedekode"),
    )


def downgrade() -> None:
    op.drop_table("permanent_afgrode")
