"""add centroid and sample_bucket to registry_field for zoomed-out point tiles

Revision ID: 20260606_0001
Revises: 20260603_0002
Create Date: 2026-06-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260606_0001"
down_revision: str | None = "20260603_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registry_field",
        sa.Column("sample_bucket", sa.SmallInteger(), nullable=True),
    )
    op.execute("ALTER TABLE registry_field ADD COLUMN centroid geometry(Point, 4326)")

    # Backfill existing rows. ST_PointOnSurface guarantees a representative point
    # inside the polygon; the hashed bucket (0..1023) gives spatially-uniform
    # decimation for the zoomed-out point tiles.
    op.execute("UPDATE registry_field SET centroid = ST_PointOnSurface(geom)")
    op.execute("UPDATE registry_field SET sample_bucket = (hashtext(imk_id::text) & 1023)")

    op.create_index(
        "ix_registry_field_centroid",
        "registry_field",
        ["centroid"],
        postgresql_using="gist",
    )
    op.create_index(
        "ix_registry_field_sample_bucket",
        "registry_field",
        ["sample_bucket"],
    )


def downgrade() -> None:
    op.drop_index("ix_registry_field_sample_bucket", table_name="registry_field")
    op.drop_index("ix_registry_field_centroid", table_name="registry_field")
    op.drop_column("registry_field", "centroid")
    op.drop_column("registry_field", "sample_bucket")
