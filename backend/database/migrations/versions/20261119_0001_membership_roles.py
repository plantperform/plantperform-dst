"""Give each resource membership an editor or viewer role."""

import sqlalchemy as sa
from alembic import op

revision = "20261119_0001"
down_revision = "20261113_0001"
branch_labels = None
depends_on = None

TABLES = ("farm_member", "economics_module_member", "saedskifte_rotation_group_member")


def upgrade():
    for table in TABLES:
        op.add_column(table, sa.Column("role", sa.Text(), nullable=False, server_default="editor"))
        op.create_check_constraint(f"ck_{table}_role", table, "role IN ('editor', 'viewer')")


def downgrade():
    for table in TABLES:
        op.drop_constraint(f"ck_{table}_role", table, type_="check")
        op.drop_column(table, "role")
