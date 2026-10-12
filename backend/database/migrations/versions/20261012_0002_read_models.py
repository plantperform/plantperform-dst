"""Store worker-prepared farm and simulation views.

Revision ID: 20261012_0002
Revises: 20261012_0001
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20261012_0002"
down_revision = "20261012_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("farm", sa.Column("revision", sa.Integer(), nullable=False, server_default="0"))
    for owner in ("farm", "simulation"):
        name = f"{owner}_read_model"
        op.create_table(
            name,
            sa.Column(
                f"{owner}_id",
                sa.Text(),
                sa.ForeignKey(f"{owner}.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("input_revision", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("view_version", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("generation", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
            sa.Column("data", JSONB()),
            sa.Column("prepared", JSONB(), nullable=False, server_default="{}"),
            sa.Column("error", JSONB()),
            sa.CheckConstraint(
                "status IN ('queued','running','done','failed')", name=f"ck_{name}_status"
            ),
        )
    op.create_table(
        "field_historical_detail",
        sa.Column(
            "field_id", sa.Text(), sa.ForeignKey("field.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("input_revision", sa.Integer(), nullable=False),
        sa.Column("years", JSONB(), nullable=False),
    )
    # Populate identity/state only. First full view loads queue worker preparation.
    op.execute(
        "INSERT INTO farm_read_model (farm_id, input_revision) SELECT id, revision FROM farm"
    )
    op.execute(
        "INSERT INTO simulation_read_model (simulation_id, input_revision) "
        "SELECT id, revision FROM simulation"
    )


def downgrade():
    op.drop_table("field_historical_detail")
    op.drop_table("simulation_read_model")
    op.drop_table("farm_read_model")
    op.drop_column("farm", "revision")
