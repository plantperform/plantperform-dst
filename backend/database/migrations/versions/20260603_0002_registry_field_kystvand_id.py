"""add kystvand_id to registry_field

Revision ID: 20260603_0002
Revises: 20260603_0001
Create Date: 2026-06-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260603_0002"
down_revision: str | None = "20260603_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registry_field",
        sa.Column("kystvand_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_registry_field_kystvand_id",
        "registry_field",
        ["kystvand_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_registry_field_kystvand_id", table_name="registry_field")
    op.drop_column("registry_field", "kystvand_id")
