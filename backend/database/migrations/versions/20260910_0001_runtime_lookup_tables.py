"""create runtime lookup tables

Revision ID: 20260910_0001
Revises: 20260909_0001
Create Date: 2026-09-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260910_0001"
down_revision: str | None = "20260909_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "saedskifte_rotation",
        sa.Column("saedskiftevariant", sa.SmallInteger(), nullable=False),
        sa.Column("variant", sa.SmallInteger(), nullable=False),
        sa.Column("rotation", sa.JSON(), nullable=False),
        sa.Column("driftsform", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("saedskiftevariant", "variant"),
    )
    op.create_table(
        "saedskifte_category",
        sa.Column("saedskiftevariant", sa.SmallInteger(), nullable=False),
        sa.Column("kategori", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("saedskiftevariant", "kategori"),
    )


def downgrade() -> None:
    op.drop_table("saedskifte_category")
    op.drop_table("saedskifte_rotation")
