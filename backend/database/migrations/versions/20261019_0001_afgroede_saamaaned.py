"""Add the crop table's normal sowing month to afgroede.

Revision ID: 20261019_0001
Revises: 20261015_0001
Create Date: 2026-10-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261019_0001"
down_revision: str | None = "20261015_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("afgroede", sa.Column("saamaaned", sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("afgroede", "saamaaned")
