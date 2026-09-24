"""add registry_field.paragraf3_natyp

Revision ID: 20260923_0001
Revises: 20260922_0001
Create Date: 2026-09-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260923_0001"
down_revision: str | None = "20260922_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registry_field", sa.Column("paragraf3_natyp", sa.Text(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("registry_field", "paragraf3_natyp")
