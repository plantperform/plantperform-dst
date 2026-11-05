"""Add independently shared rotation groups without changing reference lookups."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20261104_0001"
down_revision = "20261102_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "saedskifte_rotation_group",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("driftsform", sa.Text()),
        sa.Column("variants", JSONB(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("length(trim(name)) > 0", name="ck_saedskifte_rotation_group_name"),
    )
    op.create_table(
        "saedskifte_rotation_group_member",
        sa.Column(
            "group_id",
            sa.Text(),
            sa.ForeignKey("saedskifte_rotation_group.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "email", sa.Text(), sa.ForeignKey("app_user.email", ondelete="CASCADE"), nullable=False
        ),
        sa.PrimaryKeyConstraint("group_id", "email"),
    )
    op.create_index(
        "ix_saedskifte_rotation_group_member_email", "saedskifte_rotation_group_member", ["email"]
    )


def downgrade():
    op.drop_table("saedskifte_rotation_group_member")
    op.drop_table("saedskifte_rotation_group")
