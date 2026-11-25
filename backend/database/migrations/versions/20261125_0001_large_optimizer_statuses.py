"""Allow queued and running optimizations on the large worker."""

from alembic import op

revision = "20261125_0001"
down_revision = "20261124_0001"
branch_labels = None
depends_on = None


def _set_status_constraint(statuses):
    op.drop_constraint("ck_simulation_result_status", "simulation_result", type_="check")
    op.create_check_constraint(
        "ck_simulation_result_status", "simulation_result", f"status IN ({statuses})"
    )


def upgrade():
    _set_status_constraint(
        "'not_started','queued','in_progress','queued_large','in_progress_large',"
        "'completed','infeasible','failed','outdated'"
    )


def downgrade():
    # PostgreSQL validates the constraint and rejects downgrade while large runs are active.
    _set_status_constraint(
        "'not_started','queued','in_progress','completed','infeasible','failed','outdated'"
    )
