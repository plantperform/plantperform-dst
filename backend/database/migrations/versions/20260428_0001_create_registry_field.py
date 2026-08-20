"""create registry field

Revision ID: 20260428_0001
Revises:
Create Date: 2026-04-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry

revision: str = "20260428_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.create_table(
        "registry_field",
        sa.Column("imk_id", sa.BigInteger(), primary_key=True),
        sa.Column("cvr", sa.Text(), nullable=True),
        sa.Column("retention", sa.Float(), nullable=True),
        sa.Column("soil_id", sa.Integer(), nullable=True),
        sa.Column("area_ha", sa.Float(), nullable=False),
        sa.Column("crop_rotation", sa.Text(), nullable=False),
        sa.Column("crop_history", sa.JSON(), nullable=False),
        sa.Column("geom", Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=False),
    )
    op.create_index("ix_registry_field_geom", "registry_field", ["geom"], postgresql_using="gist")
    op.create_index("ix_registry_field_cvr", "registry_field", ["cvr"])


def downgrade() -> None:
    op.drop_index("ix_registry_field_cvr", table_name="registry_field")
    op.drop_index("ix_registry_field_geom", table_name="registry_field", postgresql_using="gist")
    op.drop_table("registry_field")
