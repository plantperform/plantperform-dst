"""Add the vinterplantedække W categories of Bilag 2, tables 7 and 8 to afgroede.

Revision ID: 20261009_0001
Revises: 20261007_0001
Create Date: 2026-10-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261009_0001"
down_revision: str = "20261008_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("afgroede", sa.Column("w_efteraar", sa.SmallInteger(), nullable=True))
    op.add_column(
        "afgroede", sa.Column("w_efteraar_efter_graes", sa.SmallInteger(), nullable=True),
    )
    op.add_column("afgroede", sa.Column("w_omploejning", sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("afgroede", "w_omploejning")
    op.drop_column("afgroede", "w_efteraar_efter_graes")
    op.drop_column("afgroede", "w_efteraar")
