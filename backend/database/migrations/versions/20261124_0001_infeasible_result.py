"""Allow proven infeasibility as a terminal simulation result."""

from alembic import op

revision = "20261124_0001"
down_revision = "20261119_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("ck_simulation_result_status", "simulation_result", type_="check")
    op.create_check_constraint(
        "ck_simulation_result_status",
        "simulation_result",
        "status IN ('not_started','queued','in_progress','completed',"
        "'infeasible','failed','outdated')",
    )


def downgrade():
    op.execute("UPDATE simulation_result SET status = 'failed' WHERE status = 'infeasible'")
    op.drop_constraint("ck_simulation_result_status", "simulation_result", type_="check")
    op.create_check_constraint(
        "ck_simulation_result_status",
        "simulation_result",
        "status IN ('not_started','queued','in_progress','completed','failed','outdated')",
    )
