"""add registry_field.oeko / oestoette / hoejeste_hnv

Revision ID: 20260827_0003
Revises: 20260827_0002
Create Date: 2026-08-27

Filled in by load_oekologi_hnv.py: oeko/oestoette are booleans (field
touches the Oekologiske Arealer / O-stoette polygon layer), hoejeste_hnv is
the max HNVscore (5-13) among the HNV_5_13_2025 polygons touching the field.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260827_0003"
down_revision: str | None = "20260827_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registry_field",
        sa.Column("oeko", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "registry_field",
        sa.Column("oestoette", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "registry_field",
        sa.Column("hoejeste_hnv", sa.SmallInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("registry_field", "hoejeste_hnv")
    op.drop_column("registry_field", "oestoette")
    op.drop_column("registry_field", "oeko")
