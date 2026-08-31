"""merge user membership and 2026 registry migrations

Revision ID: 20260828_0001
Revises: 20260825_0001, 20260827_0007
Create Date: 2026-08-28

The user/membership migration was already applied to development databases
before the 2026 registry branch was integrated. A merge revision lets Alembic
apply that branch to those databases without rewriting the applied revision's
parent.
"""

from collections.abc import Sequence


revision: str = "20260828_0001"
down_revision: str | Sequence[str] | None = ("20260825_0001", "20260827_0007")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
