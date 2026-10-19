"""Keep the work-rate unit and each price's source from the økonomi CSVs.

Revision ID: 20261015_0001
Revises: 20261014_0002
"""

import sqlalchemy as sa
from alembic import op

revision = "20261015_0001"
down_revision = "20261014_0002"
branch_labels = None
depends_on = None

COLUMNS = (
    ("salgspris", "kilde"),
    ("salgspris", "halm_kilde"),
    ("arbejdssats", "enhed"),
    ("arbejdssats", "kilde"),
    ("dyrkningsomkostning", "kilde"),
    ("prisliste", "kilde"),
)


def upgrade():
    for table, column in COLUMNS:
        op.add_column(table, sa.Column(column, sa.Text(), nullable=True))


def downgrade():
    for table, column in reversed(COLUMNS):
        op.drop_column(table, column)
