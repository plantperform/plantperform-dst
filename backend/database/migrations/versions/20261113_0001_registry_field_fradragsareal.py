"""Add the fradragsareal to registry_field.

Revision ID: 20261113_0001
Revises: 20261106_0001
Create Date: 2026-11-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261113_0001"
down_revision: str | None = "20261106_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Hectares of the field on the PUMR A4 deduction layers. The quota is
    # calculated from the area without them. 0 is no deduction, which is also
    # what a GeoPackage without the Fradragsareal column gives.
    op.add_column(
        "registry_field",
        sa.Column("fradragsareal_ha", sa.Float(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("registry_field", "fradragsareal_ha")
