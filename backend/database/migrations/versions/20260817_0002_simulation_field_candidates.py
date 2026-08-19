"""add simulation_field_candidates table

Revision ID: 20260817_0002
Revises: 20260817_0001
Create Date: 2026-08-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260817_0002"
down_revision: str | None = "20260817_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "simulation_field_candidates",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "simulation_id",
            sa.Text(),
            sa.ForeignKey("simulation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("field_id", sa.Text(), nullable=False),
        sa.Column("data", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_simulation_field_candidates_simulation_id",
        "simulation_field_candidates",
        ["simulation_id"],
    )
    op.create_index(
        "ix_simulation_field_candidates_field_id",
        "simulation_field_candidates",
        ["field_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_simulation_field_candidates_field_id", table_name="simulation_field_candidates")
    op.drop_index("ix_simulation_field_candidates_simulation_id", table_name="simulation_field_candidates")
    op.drop_table("simulation_field_candidates")
