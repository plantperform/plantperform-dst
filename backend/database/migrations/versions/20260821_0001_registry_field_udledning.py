"""replace n_quota_kg_n with udledningsgraense/-kvote on registry_field

Revision ID: 20260821_0001
Revises: 20260817_0004
Create Date: 2026-08-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260821_0001"
down_revision: str | None = "20260817_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # No overlap with the udledningsgraense source layer means the field's
    # limit is 0, not unknown — the ETL (load_udledningsgraenser.py) fills
    # every row, matched or not, so these columns are never NULL.
    op.add_column(
        "registry_field",
        sa.Column(
            "udledningsgraense_kgn_ha", sa.Float(), nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "registry_field",
        sa.Column(
            "udledningskvote_mark_kgn", sa.Float(), nullable=False, server_default="0"
        ),
    )
    op.drop_column("registry_field", "n_quota_kg_n")


def downgrade() -> None:
    op.add_column(
        "registry_field",
        sa.Column("n_quota_kg_n", sa.Float(), nullable=True),
    )
    op.drop_column("registry_field", "udledningskvote_mark_kgn")
    op.drop_column("registry_field", "udledningsgraense_kgn_ha")
