"""create mars_projekt

Revision ID: 20260827_0006
Revises: 20260827_0005
Create Date: 2026-08-27

Permanent table for the MARS (Miljø- og Arealprojekter) subsidy-project
polygons, so they can be served as their own map layer (not just used to
compute registry_field.omlaegningsplan_* via overlay).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry

revision: str = "20260827_0006"
down_revision: str | None = "20260827_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mars_projekt",
        sa.Column("mars_id", sa.Text(), primary_key=True),
        sa.Column("titel", sa.Text(), nullable=True),
        sa.Column("sags_id", sa.Text(), nullable=True),
        sa.Column("areal_ha", sa.Float(), nullable=True),
        sa.Column("tilskudsordning", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=True),
        sa.Column("ansoeger", sa.Text(), nullable=True),
        sa.Column("ansoegningsrunde_aar", sa.Integer(), nullable=True),
        sa.Column("kvaelstofeffekt_t", sa.Float(), nullable=True),
        sa.Column("udtagningseffekt_ha", sa.Float(), nullable=True),
        sa.Column("skovrejsningseffekt_ha", sa.Float(), nullable=True),
        sa.Column("virkemiddel", sa.Text(), nullable=True),
        sa.Column("bemaerkning", sa.Text(), nullable=True),
        sa.Column("geom", Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=False),
    )
    op.create_index("ix_mars_projekt_geom", "mars_projekt", ["geom"], postgresql_using="gist")


def downgrade() -> None:
    op.drop_index("ix_mars_projekt_geom", table_name="mars_projekt", postgresql_using="gist")
    op.drop_table("mars_projekt")
