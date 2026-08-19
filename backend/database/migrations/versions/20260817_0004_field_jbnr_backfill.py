"""backfill field.jbnr from registry_field.jbnr

Revision ID: 20260817_0004
Revises: 20260817_0003
Create Date: 2026-08-17

FieldRecord gained a jbnr field (server-derived, same fallback logic as
services/soil/jbnr.py::FALLBACK_JBNR = 6). New/updated fields get it set by
repository.upsert_field(); this backfills existing rows so "JB nr." displays
a real value instead of "Ukendt" for fields created before this change.

JSONB keys are snake_case (repository._dump() does not use by_alias=True).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260817_0004"
down_revision: str | None = "20260817_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FALLBACK_JBNR = 6


def upgrade() -> None:
    op.execute(
        f"""
        UPDATE field
        SET data = jsonb_set(
            data,
            '{{jbnr}}',
            to_jsonb(COALESCE(
                (SELECT rf.jbnr FROM registry_field rf
                 WHERE rf.imk_id = (field.data->>'imk_id')::bigint),
                {FALLBACK_JBNR}
            ))
        )
        """
    )
    op.execute(
        f"""
        UPDATE simulation_field
        SET data = jsonb_set(
            data,
            '{{jbnr}}',
            to_jsonb(COALESCE(
                (SELECT rf.jbnr FROM registry_field rf
                 WHERE rf.imk_id = (simulation_field.data->>'imk_id')::bigint),
                {FALLBACK_JBNR}
            ))
        )
        """
    )


def downgrade() -> None:
    op.execute("UPDATE field SET data = data - 'jbnr'")
    op.execute("UPDATE simulation_field SET data = data - 'jbnr'")
