"""Add the afgrødetabel's mellemafgrøde and tidlig såning flags to afgroede.

Revision ID: 20261009_0002
Revises: 20261009_0001
Create Date: 2026-10-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261009_0002"
down_revision: str | None = "20261009_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "afgroede",
        sa.Column(
            "mellemafgroede_mulig", sa.Boolean(), nullable=False, server_default=sa.false(),
        ),
    )
    op.add_column(
        "afgroede",
        sa.Column(
            "tidlig_saaning_mulig", sa.Boolean(), nullable=False, server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("afgroede", "tidlig_saaning_mulig")
    op.drop_column("afgroede", "mellemafgroede_mulig")
