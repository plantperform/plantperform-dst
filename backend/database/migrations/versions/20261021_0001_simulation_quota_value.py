"""Store the latest kvote value curve ("Kvotehandel") per simulation.

progress holds the steps of a running curve, so the UI can show how far it has
come.

Revision ID: 20261021_0001
Revises: 20261019_0002
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20261021_0001"
down_revision = "20261019_0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "simulation_quota_value",
        sa.Column(
            "simulation_id",
            sa.Text(),
            sa.ForeignKey("simulation.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("status", sa.Text(), nullable=False, server_default="not_started"),
        sa.Column("run_id", sa.Text()),
        sa.Column("base_run_id", sa.Text()),
        sa.Column("requested_by", sa.Text()),
        sa.Column("parameters", JSONB(), nullable=False, server_default="{}"),
        sa.Column("input_revision", sa.Integer()),
        sa.Column("queued_at", sa.DateTime(timezone=True)),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("error", JSONB()),
        sa.Column("output", JSONB()),
        sa.Column("progress", JSONB()),
        sa.CheckConstraint(
            "status IN ('not_started','queued','in_progress','completed','failed')",
            name="ck_simulation_quota_value_status",
        ),
    )


def downgrade():
    op.drop_table("simulation_quota_value")
