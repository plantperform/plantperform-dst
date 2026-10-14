"""Preserve selected legacy reports, then remove persisted alternatives.

Run with simulation writes paused and legacy creation jobs drained. Only reports
referenced by current fields or the saved result are copied. The migration and
table removal are transactional; downgrade recreates an empty cache.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20261014_0001"
down_revision = "20261013_0001"
branch_labels = None
depends_on = None


def _candidate_id(candidate):
    ref = (candidate or {}).get("ref", {})
    return ":".join(str(ref.get(key, "")) for key in ("saedskiftevariant", "variant", "n_norm_pct"))


def upgrade():
    connection = op.get_bind()
    simulations = sa.table("simulation", sa.column("id", sa.Text()), sa.column("fields", JSONB()))
    results = sa.table(
        "simulation_result",
        sa.column("simulation_id", sa.Text()),
        sa.column("output", JSONB()),
        sa.column("result_revision", sa.Integer()),
    )
    # Keyset iteration keeps memory proportional to a single selected plan.
    # PostgreSQL extracts one winning report; alternative arrays stay on server.
    last_id = None
    while True:
        query = (
            sa.select(
                simulations.c.id, simulations.c.fields, results.c.output, results.c.result_revision
            )
            .select_from(
                simulations.outerjoin(results, results.c.simulation_id == simulations.c.id)
            )
            .order_by(simulations.c.id)
            .limit(1)
        )
        if last_id is not None:
            query = query.where(simulations.c.id > last_id)
        row = connection.execute(query).first()
        if row is None:
            break
        last_id = row.id
        fields, output = row.fields, row.output or {}
        previous = {
            field["id"]: field for field in (output.get("response") or {}).get("fields", [])
        }
        selected = output.setdefault("selected_candidates", {})
        fields_changed = output_changed = False
        for field_id in dict.fromkeys([*fields, *previous]):
            setup = fields.get(field_id, {})
            baseline = setup.get("baseline", {})
            rotation_id = previous.get(field_id, baseline).get("rotation_id")
            if setup.get("baseline_revision", -1) > (
                row.result_revision if row.result_revision is not None else -1
            ):
                rotation_id = baseline.get("rotation_id", rotation_id)
            if setup.get("allowed_rotation_ids"):
                rotation_id = setup.get("fixed", {}).get("rotation_id", rotation_id)
            if field_id not in fields:
                rotation_id = None
            saved_id = previous.get(field_id, {}).get("rotation_id")
            overlays = [
                setup.get(key)
                for key in ("fixed_candidate", "economics_candidate", "manual_candidate")
            ]
            overlays.append(selected.get(field_id))
            needs_current = rotation_id and not any(
                _candidate_id(c) == rotation_id for c in overlays
            )
            needs_saved = saved_id and field_id not in selected
            for reference in dict.fromkeys(
                ref
                for ref in (
                    rotation_id if needs_current else None,
                    saved_id if needs_saved else None,
                )
                if ref
            ):
                candidate = connection.execute(
                    sa.text("""
                        SELECT candidate.value
                        FROM simulation_field_candidates AS cache
                        CROSS JOIN LATERAL jsonb_array_elements(cache.data->'candidates')
                            WITH ORDINALITY AS candidate(value, position)
                        WHERE cache.simulation_id = :simulation_id AND cache.field_id = :field_id
                          AND (candidate.value #>> '{ref,saedskiftevariant}') || ':' ||
                              (candidate.value #>> '{ref,variant}') || ':' ||
                              (candidate.value #>> '{ref,n_norm_pct}') = :reference
                        ORDER BY candidate.position LIMIT 1
                    """),
                    dict(simulation_id=row.id, field_id=field_id, reference=reference),
                ).scalar_one_or_none()
                if candidate is None:
                    continue
                if (
                    needs_current
                    and reference == rotation_id
                    and not (needs_saved and reference == saved_id)
                ):
                    setup["manual_candidate"] = candidate
                    fields_changed = True
                if needs_saved and reference == saved_id:
                    selected[field_id] = candidate
                    output_changed = True
        if fields_changed:
            connection.execute(
                simulations.update().where(simulations.c.id == row.id).values(fields=fields)
            )
        if output_changed:
            connection.execute(
                results.update().where(results.c.simulation_id == row.id).values(output=output)
            )
    op.drop_table("simulation_field_candidates")


def downgrade():
    # The discarded alternatives cannot be recovered; the chosen reports remain.
    op.create_table(
        "simulation_field_candidates",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "simulation_id",
            sa.Text(),
            sa.ForeignKey("simulation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("field_id", sa.Text(), nullable=False),
        sa.Column("data", JSONB(), nullable=False),
        sa.Column("optimizer_input", JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    for suffix, columns, unique in (
        ("simulation_id", ["simulation_id"], False),
        ("field_id", ["field_id"], False),
        ("simulation_field", ["simulation_id", "field_id"], True),
    ):
        op.create_index(
            f"ix_simulation_field_candidates_{suffix}",
            "simulation_field_candidates",
            columns,
            unique=unique,
        )
