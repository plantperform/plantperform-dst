"""Add the historical secondary crops to registry_field.

Revision ID: 20261013_0002
Revises: 20261013_0001
Create Date: 2026-10-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261013_0002"
down_revision: str | None = "20261013_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registry_field",
        sa.Column("secondary_crop_history", sa.JSON(), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("registry_field", "secondary_crop_history")
