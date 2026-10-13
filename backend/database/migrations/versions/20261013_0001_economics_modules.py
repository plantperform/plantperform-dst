"""Shared economics modules; simulations keep their own snapshots in existing JSONB.

Revision ID: 20261013_0001
Revises: 20261012_0002
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20261013_0001"
down_revision = "20261012_0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "economics_module",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("overrides", JSONB(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("length(trim(name)) > 0", name="ck_economics_module_name"),
    )
    op.create_table(
        "economics_module_member",
        sa.Column(
            "module_id",
            sa.Text(),
            sa.ForeignKey("economics_module.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "email", sa.Text(), sa.ForeignKey("app_user.email", ondelete="CASCADE"), nullable=False
        ),
        sa.PrimaryKeyConstraint("module_id", "email"),
    )
    op.create_index("ix_economics_module_member_email", "economics_module_member", ["email"])


def downgrade():
    op.drop_table("economics_module_member")
    op.drop_table("economics_module")
