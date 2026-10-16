"""Economics modules belong to a farm, and every farm member can use them.

A module moves to the farm of the first simulation that selects or applied it.
Other farms using it get their own copy, and their simulations point to the copy.
Modules no simulation uses are removed.

Revision ID: 20261015_0002
Revises: 20261015_0001
"""

from uuid import uuid4

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20261015_0002"
down_revision = "20261015_0001"
branch_labels = None
depends_on = None

FOREIGN_KEY = "economics_module_farm_id_fkey"

modules = sa.table(
    "economics_module",
    sa.column("id", sa.Text),
    sa.column("farm_id", sa.Text),
    sa.column("name", sa.Text),
    sa.column("overrides", JSONB),
    sa.column("revision", sa.Integer),
)
setups = sa.table(
    "simulation",
    sa.column("id", sa.Text),
    sa.column("farm_id", sa.Text),
    sa.column("data", JSONB),
    sa.column("created_at", sa.DateTime(timezone=True)),
)


def _repoint(data, old_id, new_id):
    data = dict(data)
    if data.get("economics_module_id") == old_id:
        data["economics_module_id"] = new_id
    snapshot = data.get("economics_snapshot")
    if isinstance(snapshot, dict) and snapshot.get("source_id") == old_id:
        data["economics_snapshot"] = {**snapshot, "source_id": new_id}
    operation = data.get("economics_recalculation")
    captured = operation.get("snapshot") if isinstance(operation, dict) else None
    if isinstance(captured, dict) and captured.get("source_id") == old_id:
        data["economics_recalculation"] = {
            **operation,
            "snapshot": {**captured, "source_id": new_id},
        }
    return data


def upgrade():
    op.add_column("economics_module", sa.Column("farm_id", sa.Text(), nullable=True))
    connection = op.get_bind()
    for module in connection.execute(sa.select(modules)).all():
        uses = connection.execute(
            sa.select(setups.c.id, setups.c.farm_id, setups.c.data)
            .where(
                sa.or_(
                    setups.c.data["economics_module_id"].astext == module.id,
                    setups.c.data[("economics_snapshot", "source_id")].astext == module.id,
                )
            )
            .order_by(setups.c.created_at, setups.c.id)
        ).all()
        farm_ids = list(dict.fromkeys(use.farm_id for use in uses))
        if not farm_ids:
            connection.execute(sa.delete(modules).where(modules.c.id == module.id))
            continue
        connection.execute(
            sa.update(modules).where(modules.c.id == module.id).values(farm_id=farm_ids[0])
        )
        for farm_id in farm_ids[1:]:
            copy_id = str(uuid4())
            connection.execute(
                sa.insert(modules).values(
                    id=copy_id,
                    farm_id=farm_id,
                    name=module.name,
                    overrides=module.overrides,
                    revision=module.revision,
                )
            )
            for use in uses:
                if use.farm_id == farm_id:
                    connection.execute(
                        sa.update(setups)
                        .where(setups.c.id == use.id)
                        .values(data=_repoint(use.data, module.id, copy_id))
                    )
    op.alter_column("economics_module", "farm_id", nullable=False)
    op.create_foreign_key(
        FOREIGN_KEY, "economics_module", "farm", ["farm_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("ix_economics_module_farm_id", "economics_module", ["farm_id"])
    op.drop_table("economics_module_member")


def downgrade():
    op.create_table(
        "economics_module_member",
        sa.Column(
            "module_id",
            sa.Text(),
            sa.ForeignKey("economics_module.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "email", sa.Text(), sa.ForeignKey("app_user.email", ondelete="CASCADE"), nullable=False
        ),
        sa.PrimaryKeyConstraint("module_id", "email"),
    )
    op.create_index("ix_economics_module_member_email", "economics_module_member", ["email"])
    op.execute(
        "INSERT INTO economics_module_member (module_id, email) "
        "SELECT economics_module.id, farm_member.email FROM economics_module "
        "JOIN farm_member ON farm_member.farm_id = economics_module.farm_id"
    )
    op.drop_index("ix_economics_module_farm_id", table_name="economics_module")
    op.drop_constraint(FOREIGN_KEY, "economics_module", type_="foreignkey")
    op.drop_column("economics_module", "farm_id")
