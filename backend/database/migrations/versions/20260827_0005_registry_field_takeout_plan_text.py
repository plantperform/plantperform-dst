"""registry_field.in_takeout_plan: boolean -> text

Revision ID: 20260827_0005
Revises: 20260827_0004
Create Date: 2026-08-27

First-pass repurposing of the existing "omlægningsplan" ja/nej slot to carry
the MARS virkemiddel text directly (e.g. "Skovrejsning"), falling back to
the literal "nej" where a field has none — rather than adding a parallel
UI concept next to the already-wired-up omlaegningsplan_virkemiddel column.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260827_0005"
down_revision: str | None = "20260827_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "registry_field",
        "in_takeout_plan",
        type_=sa.Text(),
        server_default="nej",
        postgresql_using="CASE WHEN in_takeout_plan THEN 'ja' ELSE 'nej' END",
    )


def downgrade() -> None:
    op.alter_column(
        "registry_field",
        "in_takeout_plan",
        type_=sa.Boolean(),
        server_default=sa.false(),
        postgresql_using="in_takeout_plan != 'nej'",
    )
