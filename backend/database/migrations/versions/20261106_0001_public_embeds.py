"""Add viewer accounts and revocable public embed keys."""

import sqlalchemy as sa
from alembic import op

revision = "20261106_0001"
down_revision = "20261104_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("app_user", sa.Column("role", sa.Text(), nullable=False, server_default="editor"))
    op.create_check_constraint("ck_app_user_role", "app_user", "role IN ('editor', 'viewer')")
    op.create_table(
        "embed_key",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "email", sa.Text(), sa.ForeignKey("app_user.email", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("token_hash", sa.Text(), nullable=False, unique=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
    )
    op.create_index(
        "uq_embed_key_active_email",
        "embed_key",
        ["email"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )


def downgrade():
    op.drop_table("embed_key")
    op.drop_constraint("ck_app_user_role", "app_user", type_="check")
    op.drop_column("app_user", "role")
