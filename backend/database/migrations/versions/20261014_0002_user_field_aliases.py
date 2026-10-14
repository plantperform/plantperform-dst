"""Add personal field aliases independent of farms and simulation snapshots."""

import sqlalchemy as sa
from alembic import op

revision = "20261014_0002"
down_revision = "20261014_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "user_field_alias",
        sa.Column(
            "email", sa.Text(), sa.ForeignKey("app_user.email", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("field_key", sa.Text(), nullable=False),
        sa.Column("alias", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("email", "field_key"),
        sa.CheckConstraint("length(trim(alias)) > 0", name="ck_user_field_alias_nonempty"),
    )


def downgrade():
    op.drop_table("user_field_alias")
