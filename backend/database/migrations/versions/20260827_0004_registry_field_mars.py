"""add registry_field.omlaegningsplan_virkemiddel / omlaegningsplan_status

Revision ID: 20260827_0004
Revises: 20260827_0003
Create Date: 2026-08-27

Filled in by load_mars_projekter.py from Mars_data.gpkg's
marsprojekter_samlet layer (MARS environmental/land-use subsidy projects) —
a field touching several MARS projects gets all their distinct
virkemiddel/status values comma-separated; NULL when a field touches none.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260827_0004"
down_revision: str | None = "20260827_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registry_field",
        sa.Column("omlaegningsplan_virkemiddel", sa.Text(), nullable=True),
    )
    op.add_column(
        "registry_field",
        sa.Column("omlaegningsplan_status", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("registry_field", "omlaegningsplan_status")
    op.drop_column("registry_field", "omlaegningsplan_virkemiddel")
