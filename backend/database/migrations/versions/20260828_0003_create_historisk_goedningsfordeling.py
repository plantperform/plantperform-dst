"""create historisk_goedningsfordeling

Revision ID: 20260828_0003
Revises: 20260828_0002
Create Date: 2026-08-28

Permanent lookup table for the historical (2025+2026 average) fertilizer
distribution reference (Bilag 3), keyed by region x driftsform x
afgroedekode x jb_nr x n_type ('mineralsk' -> MNCS, 'organisk' -> G0).
Used to reconstruct real N-input history for fields (the "Aktuel" per-field
figures and the 2027/2028 rotation-scenario lookback), instead of a
scenario-level fertilizer-slider assumption.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0003"
down_revision: str | None = "20260828_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "historisk_goedningsfordeling",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("region", sa.Text(), nullable=False),
        sa.Column("driftsform", sa.Text(), nullable=False),
        sa.Column("afgroedekode", sa.Integer(), nullable=False),
        sa.Column("jb_nr", sa.SmallInteger(), nullable=False),
        sa.Column("n_type", sa.Text(), nullable=False),
        sa.Column("vaerdi", sa.Float(), nullable=False),
    )
    op.create_index(
        "ix_historisk_goedningsfordeling_lookup",
        "historisk_goedningsfordeling",
        ["region", "driftsform", "afgroedekode", "jb_nr", "n_type"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_historisk_goedningsfordeling_lookup", table_name="historisk_goedningsfordeling"
    )
    op.drop_table("historisk_goedningsfordeling")
