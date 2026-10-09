"""Store creation state on the simulation row.

Revision ID: 20261009_0001
Revises: 20261007_0001
"""

import sqlalchemy as sa
from alembic import op

revision = "20261009_0001"
down_revision = "20261007_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "simulation",
        sa.Column("creation_status", sa.Text(), nullable=False, server_default="done"),
    )
    op.create_check_constraint(
        "ck_simulation_creation_status",
        "simulation",
        "creation_status IN ('queued','running','done','failed')",
    )


def downgrade():
    op.drop_constraint("ck_simulation_creation_status", "simulation", type_="check")
    op.drop_column("simulation", "creation_status")
