"""add marknr to registry_field

Revision ID: 20260603_0001
Revises: 20260505_0002
Create Date: 2026-06-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260603_0001"
down_revision: str | None = "20260505_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registry_field",
        sa.Column("marknr", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("registry_field", "marknr")
