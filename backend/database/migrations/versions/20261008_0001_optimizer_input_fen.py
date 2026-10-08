"""Keep yearly foderenheder in the compact optimizer inputs.

Års-optimering bounds FEN in every calendar year. The compact input omits
db_detail, where the yearly udbytte and its unit live, so each compact year
carries its own fen_fe_ha, derived with the same rule as avg_fen.

Revision ID: 20261008_0001
Revises: 20261007_0001
"""

import sqlalchemy as sa
from alembic import op

revision = "20261008_0001"
down_revision = "20261007_0001"
branch_labels = None
depends_on = None

# Compact candidates and years keep the order of the full data they were
# derived from, so they are paired with it by position. The full candidate
# list is expanded once per row: indexing into `data` for every year would
# decompress the large full document again each time. As in 20261007_0001,
# one field row at a time, entirely inside PostgreSQL.
ADD_FEN_SQL = """
UPDATE simulation_field_candidates SET optimizer_input = jsonb_set(
    optimizer_input,
    '{candidates}',
    COALESCE((
        SELECT jsonb_agg(jsonb_set(
            compact_candidate,
            '{years}',
            COALESCE((
                SELECT jsonb_agg(
                    compact_year || jsonb_build_object(
                        'fen_fe_ha',
                        CASE
                            WHEN full_year->'db_detail'->>'udbytteenhed' = 'FE/ha'
                            THEN COALESCE((full_year->'db_detail'->>'udbytte')::float8, 0)
                            ELSE 0
                        END
                    )
                    ORDER BY year_position
                )
                FROM jsonb_array_elements(compact_candidate->'years')
                     WITH ORDINALITY AS compact_years(compact_year, year_position)
                LEFT JOIN jsonb_array_elements(full_candidate->'years')
                     WITH ORDINALITY AS full_years(full_year, full_year_position)
                     ON full_year_position = year_position
            ), '[]'::jsonb)
        ) ORDER BY candidate_position)
        FROM jsonb_array_elements(optimizer_input->'candidates')
             WITH ORDINALITY AS compact_candidates(compact_candidate, candidate_position)
        LEFT JOIN jsonb_array_elements(data->'candidates')
             WITH ORDINALITY AS full_candidates(full_candidate, full_candidate_position)
             ON full_candidate_position = candidate_position
    ), '[]'::jsonb)
)
WHERE id = :id
"""

DROP_FEN_SQL = """
UPDATE simulation_field_candidates SET optimizer_input = jsonb_set(
    optimizer_input,
    '{candidates}',
    COALESCE((
        SELECT jsonb_agg(jsonb_set(
            compact_candidate,
            '{years}',
            COALESCE((
                SELECT jsonb_agg(compact_year - 'fen_fe_ha' ORDER BY year_position)
                FROM jsonb_array_elements(compact_candidate->'years')
                     WITH ORDINALITY AS years(compact_year, year_position)
            ), '[]'::jsonb)
        ) ORDER BY candidate_position)
        FROM jsonb_array_elements(optimizer_input->'candidates')
             WITH ORDINALITY AS candidates(compact_candidate, candidate_position)
    ), '[]'::jsonb)
)
WHERE id = :id
"""


def _update_each_row(statement: str) -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT id FROM simulation_field_candidates").execution_options(yield_per=1)
    )
    for row in rows:
        connection.execute(sa.text(statement), {"id": row.id})


def upgrade():
    _update_each_row(ADD_FEN_SQL)


def downgrade():
    _update_each_row(DROP_FEN_SQL)
