"""add registry_field.kystvand_navn

Revision ID: 20260831_0001
Revises: 20260828_0004
Create Date: 2026-08-31

The Kystvandoplande_VP3_II_2025.shp source (load_kystvandoplande.py) already
carries a "KystvandNa" name column (e.g. "Sejerø Bugt") alongside the
numeric KystvandID we load into kystvand_id — it was never read. Needed to
label the per-kystvandopland udledningskvote breakdown with a real name
instead of a bare id.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260831_0001"
down_revision: str | None = "20260828_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE registry_field ADD COLUMN IF NOT EXISTS kystvand_navn TEXT")


def downgrade() -> None:
    op.drop_column("registry_field", "kystvand_navn")
