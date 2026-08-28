"""merge kortdata and auth migration heads

Revision ID: 20260828_0001
Revises: 20260827_0007, 20260825_0001
Create Date: 2026-08-28

The kortdata migration chain (registry_field 2026 dataset, MARS) and the
auth/farm-membership chain both branch from 20260821_0002 independently, so
they need an explicit merge point before either branch's history can be
rebased onto the other without leaving multiple heads.
"""

from collections.abc import Sequence

revision: str = "20260828_0001"
down_revision: str | None = ("20260827_0007", "20260825_0001")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
