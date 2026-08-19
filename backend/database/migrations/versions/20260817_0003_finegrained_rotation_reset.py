"""reset crop_rotation to fine-grained RotationYear shape, truncate simulations

Revision ID: 20260817_0003
Revises: 20260817_0002
Create Date: 2026-08-17

FieldRecord.crop_rotation changes type from list[Crop] (coarse enum strings)
to list[RotationYear] (real afgrødekode objects) — a breaking JSONB shape
change. Per explicit product decision, nothing from the old model needs to
carry over (all current data is test/dev data): existing field rows have
their crop_rotation reset to an empty list rather than migrated, and all
existing simulations are dropped entirely (they must be recreated under the
new "Nyt scenarie" kategori/N-norm%-flow anyway, which didn't exist yet when
they were created).

JSONB keys are snake_case (repository._dump() does not use by_alias=True).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260817_0003"
down_revision: str | None = "20260817_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("TRUNCATE TABLE simulation, simulation_field, simulation_field_candidates CASCADE")
    op.execute(
        "UPDATE field SET data = jsonb_set("
        "  jsonb_set(data, '{crop_rotation}', '[]'::jsonb),"
        "  '{measures}', '{\"precision_farming\": false, \"cover_crop_years\": [], "
        "\"early_sowing_years\": []}'::jsonb"
        ") || '{\"db2\": 0, \"n_load\": 0, \"leaching\": 0}'::jsonb"
    )


def downgrade() -> None:
    # Ikke reversibel — de nulstillede/slettede data (gamle Crop-baserede
    # rotationer, simuleringer) er ikke bevaret nogen steder.
    raise NotImplementedError(
        "This migration is not reversible: old crop_rotation values and all "
        "simulations were discarded, not preserved."
    )
