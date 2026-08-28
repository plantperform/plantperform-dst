"""add users, email verification, refresh sessions, and farm membership

Revision ID: 20260825_0001
Revises: 20260821_0002
Create Date: 2026-08-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260825_0001"
down_revision: str | None = "20260821_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_user",
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("email"),
        sa.CheckConstraint("email = lower(email)", name="ck_app_user_email_lowercase"),
    )
    op.create_table(
        "farm_member",
        sa.Column("farm_id", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["farm_id"], ["farm.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["email"], ["app_user.email"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("farm_id", "email"),
    )
    op.create_index("ix_farm_member_email", "farm_member", ["email"])
    op.create_table(
        "email_verification_token",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["email"], ["app_user.email"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_email_verification_token_email",
        "email_verification_token",
        ["email"],
    )
    op.create_table(
        "auth_refresh_session",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("family_id", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["email"], ["app_user.email"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_auth_refresh_session_email", "auth_refresh_session", ["email"])
    op.create_index("ix_auth_refresh_session_family_id", "auth_refresh_session", ["family_id"])

    # The historical farms have no user identity. Assign them to the temporary
    # shared legacy account so their owners can log in and transfer their farms.
    op.execute(
        sa.text(
            """
            INSERT INTO app_user (email, password_hash, verified_at)
            VALUES (
                'legacy@legacy.com',
                '$argon2id$v=19$m=65536,t=3,p=1$D0CqN2/RVwt61wz+xY5Pqg$MBX+FbarqUpw12AsB27ns2yKyZCNAaqXCU0TfUittmE',
                now()
            )
            ON CONFLICT (email) DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO farm_member (farm_id, email)
            SELECT id, 'legacy@legacy.com' FROM farm
            ON CONFLICT (farm_id, email) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_auth_refresh_session_family_id", table_name="auth_refresh_session")
    op.drop_index("ix_auth_refresh_session_email", table_name="auth_refresh_session")
    op.drop_table("auth_refresh_session")
    op.drop_index("ix_email_verification_token_email", table_name="email_verification_token")
    op.drop_table("email_verification_token")
    op.drop_index("ix_farm_member_email", table_name="farm_member")
    op.drop_table("farm_member")
    op.drop_table("app_user")
