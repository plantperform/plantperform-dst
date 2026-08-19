"""add jbnr to registry_field

Revision ID: 20260817_0001
Revises: 20260606_0001
Create Date: 2026-08-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260817_0001"
down_revision: str | None = "20260606_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registry_field",
        sa.Column("jbnr", sa.SmallInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("registry_field", "jbnr")
