"""add registry_field.kvotegivende

Revision ID: 20260828_0004
Revises: 20260828_0003
Create Date: 2026-08-28

Whether the field's 2026 afgrødekode is "kvotegivende areal" per Bilag 1
tabel 1 (database/data/raw/ANGJ-data/Bilag_1_tabel_1_Kvotegivende_areal_og_
aktivitet.csv) — used both as a map attribute and to determine which fields
count toward a farm's udledningskvote.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0004"
down_revision: str | None = "20260828_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registry_field",
        sa.Column("kvotegivende", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("registry_field", "kvotegivende")
