"""drop registry_field.soil_id — superseded by jbnr

Revision ID: 20260827_0001
Revises: 20260821_0002
Create Date: 2026-08-27

registry_field.soil_id (a crude SAND/CLAY-derived flag) is no longer read by
any live code path: field creation and the optimisation engine both already
use the real JB-nummer (registry_field.jbnr) instead. Dropping it here rather
than leaving it unused.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260827_0001"
down_revision: str | None = "20260821_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("registry_field", "soil_id")


def downgrade() -> None:
    op.add_column(
        "registry_field",
        sa.Column("soil_id", sa.Integer(), nullable=True),
    )
