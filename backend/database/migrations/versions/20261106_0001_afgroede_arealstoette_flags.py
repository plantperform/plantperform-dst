"""Add the harmoniareal and arealstøtte flags to afgroede.

The master table says per afgrødekode whether the area is harmoniareal
("Harmoni"), whether it is an eligible hectare ("Grundbetaling",
"Landbrugsareal", "Art. 4.4.C") and whether it is brak. The columns are filled
by `pixi run load-afgroeder`; until then every flag reads as false.

Revision ID: 20261106_0001
Revises: 20261104_0001
Create Date: 2026-11-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261106_0001"
down_revision: str | None = "20261104_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BOOLEAN_COLUMNS = ("harmoni", "grundbetaling", "landbrugsareal", "brak")


def upgrade() -> None:
    for name in BOOLEAN_COLUMNS:
        op.add_column(
            "afgroede",
            sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    op.add_column(
        "afgroede",
        sa.Column("art_4_4_c", sa.SmallInteger(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("afgroede", "art_4_4_c")
    for name in reversed(BOOLEAN_COLUMNS):
        op.drop_column("afgroede", name)
