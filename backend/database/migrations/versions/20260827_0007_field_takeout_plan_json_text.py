"""field.data->inTakeoutPlan: boolean -> text (JSONB)

Revision ID: 20260827_0007
Revises: 20260827_0006
Create Date: 2026-08-27

registry_field.in_takeout_plan (a real column) was converted from boolean to
text in 20260827_0005, but saved FieldRecord blobs in field.data are JSONB
with no schema to migrate automatically — old rows still carry the raw
boolean and fail Pydantic validation (expects str) on read. Converts only
the rows still holding a JSON boolean; already-text rows are left alone.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260827_0007"
down_revision: str | None = "20260827_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE field
        SET data = jsonb_set(
            data,
            '{in_takeout_plan}',
            to_jsonb(CASE WHEN (data->>'in_takeout_plan')::boolean THEN 'ja' ELSE 'nej' END)
        )
        WHERE jsonb_typeof(data->'in_takeout_plan') = 'boolean'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE field
        SET data = jsonb_set(
            data,
            '{in_takeout_plan}',
            to_jsonb((data->>'in_takeout_plan') != 'nej')
        )
        WHERE jsonb_typeof(data->'in_takeout_plan') = 'string'
        """
    )
