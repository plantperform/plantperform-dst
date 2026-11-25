"""Record who created each farm; an existing farm with a single editor gets that editor."""

import sqlalchemy as sa
from alembic import op

revision = "20261125_0001"
down_revision = "20261124_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "farm",
        sa.Column(
            "created_by",
            sa.Text(),
            sa.ForeignKey("app_user.email", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.execute(
        """
        UPDATE farm SET created_by = sole.email
        FROM (
            SELECT farm_id, min(email) AS email FROM farm_member
            WHERE role = 'editor'
            GROUP BY farm_id HAVING count(*) = 1
        ) AS sole
        WHERE farm.id = sole.farm_id
        """
    )


def downgrade():
    op.drop_column("farm", "created_by")
