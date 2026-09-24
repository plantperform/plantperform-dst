"""create paragraf3_omraade

Revision ID: 20260923_0002
Revises: 20260923_0001
Create Date: 2026-09-23

Permanent table for the §3 (protected-nature) polygons, so they can be
served as their own map layer — same pattern as mars_projekt
(20260827_0006) — instead of only being used to compute
registry_field.paragraf3_natyp via overlay.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry

revision: str = "20260923_0002"
down_revision: str | None = "20260923_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "paragraf3_omraade",
        sa.Column("fid", sa.Text(), primary_key=True),
        sa.Column("natyp_navn", sa.Text(), nullable=True),
        sa.Column("geom", Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=False),
    )
    op.create_index(
        "ix_paragraf3_omraade_geom", "paragraf3_omraade", ["geom"], postgresql_using="gist"
    )


def downgrade() -> None:
    op.drop_index(
        "ix_paragraf3_omraade_geom", table_name="paragraf3_omraade", postgresql_using="gist"
    )
    op.drop_table("paragraf3_omraade")
