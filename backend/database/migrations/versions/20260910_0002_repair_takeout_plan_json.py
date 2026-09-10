"""repair legacy in_takeout_plan values in saved field JSON

Revision ID: 20260910_0002
Revises: 20260910_0001
Create Date: 2026-09-10

The earlier 20260827_0007 migration repaired boolean in_takeout_plan values
only in field.data. Existing simulation_field snapshots can still carry those
booleans and fail FieldRecord validation. This forward-only repair covers both
tables and both historical JSON key spellings.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260910_0002"
down_revision: str | None = "20260910_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("field", "simulation_field")
KEYS = ("in_takeout_plan", "inTakeoutPlan")


def _convert_boolean_takeout_plan(table: str, key: str) -> None:
    op.execute(
        f"""
        UPDATE {table}
        SET data = jsonb_set(
            data,
            '{{{key}}}',
            to_jsonb(CASE WHEN (data->>'{key}')::boolean THEN 'ja' ELSE 'nej' END)
        )
        WHERE jsonb_typeof(data->'{key}') = 'boolean'
        """
    )


def upgrade() -> None:
    for table in TABLES:
        for key in KEYS:
            _convert_boolean_takeout_plan(table, key)


def downgrade() -> None:
    # This migration is intentionally data-forward-only. Converting arbitrary
    # strings back to booleans would corrupt the MARS virkemiddel text.
    pass
