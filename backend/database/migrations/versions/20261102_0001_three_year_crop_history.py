"""Recalculate every farm's crop history, now for 2024-2026, on its next load.

Revision ID: 20261102_0001
Revises: 20261019_0002
Create Date: 2026-11-02
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261102_0001"
down_revision: str | None = "20261019_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE farm SET revision = revision + 1")


def downgrade() -> None:
    op.execute("UPDATE farm SET revision = revision + 1")
