"""rename farm.nitrogen_quota_kg -> farm.udledningskvote_kg_n

Renames the JSONB key in-place (rather than dropping the value) since this is
a manually-entered number with no source dataset to recompute it from.

Revision ID: 20260821_0002
Revises: 20260821_0001
Create Date: 2026-08-21
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260821_0002"
down_revision: str | None = "20260821_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE farm
        SET data = (data - 'nitrogen_quota_kg')
            || jsonb_build_object('udledningskvote_kg_n', data->'nitrogen_quota_kg')
        WHERE data ? 'nitrogen_quota_kg'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE farm
        SET data = (data - 'udledningskvote_kg_n')
            || jsonb_build_object('nitrogen_quota_kg', data->'udledningskvote_kg_n')
        WHERE data ? 'udledningskvote_kg_n'
        """
    )
