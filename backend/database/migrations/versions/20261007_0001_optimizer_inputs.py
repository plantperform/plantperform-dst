"""Store compact optimizer inputs alongside immutable calculation details.

Revision ID: 20261007_0001
Revises: 20261005_0001
"""

import logging
import time

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20261007_0001"
down_revision = "20261005_0001"
branch_labels = None
depends_on = None
logger = logging.getLogger("alembic.runtime.migration")

# Derive one field at a time entirely inside PostgreSQL. Neither Python nor a
# simulation-wide JSONB aggregate needs to hold all the calculation details.
COMPACT_INPUT_SQL = """jsonb_build_object(
    'field_id', data->'field_id',
    'jbnr', data->'jbnr',
    'real_history', data->'real_history',
    'candidates', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'ref', c->'ref',
            'base_ref', c->'base_ref',
            'overrides', COALESCE(c->'overrides', '[]'::jsonb),
            'start_year', COALESCE(c->'start_year', '1'::jsonb),
            'active_len', c->'active_len',
            'avg_leaching_kg_n_ha', c->'avg_leaching_kg_n_ha',
            'avg_db_kr_ha', c->'avg_db_kr_ha',
            'avg_fen', c->'avg_fen',
            'years', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'year', y->'year',
                    'leaching_kg_n_ha', y->'leaching_kg_n_ha',
                    'db_kr_ha', y->'db_kr_ha'
                ) ORDER BY year_position)
                FROM jsonb_array_elements(c->'years') WITH ORDINALITY AS years(y, year_position)
            ), '[]'::jsonb)
        ) ORDER BY candidate_position)
        FROM jsonb_array_elements(data->'candidates')
             WITH ORDINALITY AS candidates(c, candidate_position)
    ), '[]'::jsonb)
)
"""


def upgrade():
    started = time.monotonic()
    logger.info("Optimizer inputs: adding compact input column")
    op.add_column("simulation_field_candidates", sa.Column("optimizer_input", JSONB()))
    connection = op.get_bind()
    logger.info("Optimizer inputs: backfilling candidate caches inside PostgreSQL")
    backfill_started = time.monotonic()
    updated = connection.execute(
        sa.text(
            "UPDATE simulation_field_candidates SET optimizer_input = " + COMPACT_INPUT_SQL
        )
    ).rowcount
    logger.info(
        "Optimizer inputs: backfilled %d candidate caches in %.1fs",
        updated, time.monotonic() - backfill_started,
    )
    logger.info("Optimizer inputs: enforcing non-null compact inputs")
    op.alter_column("simulation_field_candidates", "optimizer_input", nullable=False)
    logger.info("Optimizer inputs: conversion finished in %.1fs", time.monotonic() - started)


def downgrade():
    op.drop_column("simulation_field_candidates", "optimizer_input")
