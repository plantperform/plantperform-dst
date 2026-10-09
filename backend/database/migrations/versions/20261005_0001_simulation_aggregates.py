"""Consolidate setup and latest results, retaining per-field candidate storage.

Run with simulation writes paused. The conversion and verification are transactional.
"""

import logging
import time
from copy import deepcopy

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20261005_0001"
down_revision = "20260930_0001"
branch_labels = None
depends_on = None
OUTPUT_KEYS = ("crop_rotation", "rotation_id", "db2", "n_load", "leaching", "fen")
CANDIDATE_INDEX = "ix_simulation_field_candidates_simulation_field"
logger = logging.getLogger("alembic.runtime.migration")

# Return only the selected evaluation, keeping unselected calculation details
# inside PostgreSQL and avoiding a cache download/query for every field.
FIELDS_WITH_SELECTED_CANDIDATES_SQL = """
SELECT sf.id, sf.data, selected.candidate AS selected_candidate
FROM simulation_field AS sf
LEFT JOIN LATERAL (
    SELECT candidate.value AS candidate
    FROM simulation_field_candidates AS cache
    CROSS JOIN LATERAL jsonb_array_elements(cache.data->'candidates')
        WITH ORDINALITY AS candidate(value, position)
    WHERE cache.simulation_id = sf.simulation_id
      AND cache.field_id = sf.id
      AND sf.data->>'rotation_id' <> ''
      AND (
          (candidate.value #>> '{ref,saedskiftevariant}') || ':' ||
          (candidate.value #>> '{ref,variant}') || ':' ||
          (candidate.value #>> '{ref,n_norm_pct}')
      ) = sf.data->>'rotation_id'
    ORDER BY candidate.position
    LIMIT 1
) AS selected ON TRUE
WHERE sf.simulation_id = :simulation_id
ORDER BY sf.created_at, sf.id
"""


def candidate_id(candidate):
    ref = candidate["ref"]
    return f"{ref['saedskiftevariant']}:{ref['variant']}:{ref['n_norm_pct']}"


def upgrade():
    started = time.monotonic()
    logger.info("Simulation aggregates: preparing schema and candidate index")
    for name, datatype, default in (
        ("revision", sa.Integer(), "0"),
        ("fields", JSONB(), "{}"),
        ("field_order", JSONB(), "[]"),
    ):
        op.add_column(
            "simulation", sa.Column(name, datatype, nullable=False, server_default=default)
        )
    op.create_table(
        "simulation_result",
        sa.Column(
            "simulation_id",
            sa.Text(),
            sa.ForeignKey("simulation.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("status", sa.Text(), nullable=False, server_default="not_started"),
        sa.Column("run_id", sa.Text()),
        sa.Column("kind", sa.Text()),
        sa.Column("requested_by", sa.Text()),
        sa.Column("parameters", JSONB(), nullable=False, server_default="{}"),
        sa.Column("input_revision", sa.Integer()),
        sa.Column("result_revision", sa.Integer()),
        *[
            sa.Column(name, sa.DateTime(timezone=True))
            for name in (
                "queued_at",
                "published_at",
                "started_at",
                "finished_at",
                "lease_expires_at",
            )
        ],
        sa.Column("lease_token", sa.Text()),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", JSONB()),
        sa.Column("output", JSONB()),
        sa.CheckConstraint(
            "status IN ('not_started','queued','in_progress','completed','failed','outdated')",
            name="ck_simulation_result_status",
        ),
    )
    op.create_index(
        "ix_simulation_result_active", "simulation_result", ["status", "lease_expires_at"]
    )
    op.create_index(
        CANDIDATE_INDEX, "simulation_field_candidates", ["simulation_id", "field_id"], unique=True
    )
    bind = op.get_bind()
    metadata = sa.MetaData()
    setup = sa.Table("simulation", metadata, autoload_with=bind)
    result = sa.Table("simulation_result", metadata, autoload_with=bind)
    old_candidates = sa.Table("simulation_field_candidates", metadata, autoload_with=bind)
    candidate_count = bind.execute(
        sa.select(sa.func.count()).select_from(old_candidates)
    ).scalar_one()
    ids = bind.execute(sa.select(setup.c.id)).scalars().all()
    logger.info("Simulation aggregates: schema prepared in %.1fs", time.monotonic() - started)
    logger.info(
        "Simulation aggregates: converting %d simulations, preserving %d candidate caches",
        len(ids), candidate_count,
    )
    conversion_started = last_progress = time.monotonic()
    field_query = sa.text(FIELDS_WITH_SELECTED_CANDIDATES_SQL).columns(
        id=sa.Text(), data=JSONB(), selected_candidate=JSONB(),
    )
    for position, simulation_id in enumerate(ids, start=1):
        rows = bind.execute(
            field_query, {"simulation_id": simulation_id},
        ).all()
        fields = {}
        for row in rows:
            data = row.data
            field = {key: deepcopy(value) for key, value in data.items() if key not in OUTPUT_KEYS}
            values = {key: deepcopy(data.get(key)) for key in OUTPUT_KEYS}
            values["fen"] = values["fen"] or 0
            if data.get("allowed_rotation_ids"):
                field["fixed"] = values
            elif not data.get("rotation_id"):
                field["baseline"] = values
            fields[row.id] = field
        order = [row.id for row in rows]
        selected = {}
        for row in rows:
            candidate = row.selected_candidate
            if candidate is None:
                continue
            selected[row.id] = candidate
            if fields[row.id].get("allowed_rotation_ids"):
                fields[row.id]["fixed_candidate"] = candidate
        stored = bind.execute(
            setup.update()
            .where(setup.c.id == simulation_id)
            .values(fields=fields, field_order=order)
            .returning(setup.c.fields, setup.c.field_order)
        ).one()
        has_output = any(row.data.get("rotation_id") for row in rows)
        complete = has_output and all(row.data.get("rotation_id") for row in rows)
        output = (
            {
                "response": {
                    "status": "FEASIBLE",
                    "fields": [row.data for row in rows],
                    "assignments": [
                        {"field_id": row.id, "rotation_id": row.data["rotation_id"]}
                        for row in rows
                        if row.data.get("rotation_id")
                    ],
                    "objective_db2": sum(row.data.get("db2", 0) for row in rows),
                    "total_n_load_kg": sum(row.data.get("n_load", 0) for row in rows),
                    "total_leaching_kg": sum(row.data.get("leaching", 0) for row in rows),
                    "total_fen": sum(row.data.get("fen", 0) for row in rows),
                },
                "selected_candidates": selected,
                "fields_before": [],
            }
            if has_output
            else None
        )
        bind.execute(
            result.insert().values(
                simulation_id=simulation_id,
                status="completed" if complete else "outdated" if has_output else "not_started",
                kind="optimize" if has_output else None,
                result_revision=0 if has_output else None,
                output=output,
            )
        )
        if stored.fields != fields or stored.field_order != order:
            raise RuntimeError(f"Simulation migration verification failed: {simulation_id}")
        now = time.monotonic()
        if position == len(ids) or now - last_progress >= 5:
            logger.info(
                "Simulation aggregates: converted %d/%d simulations in %.1fs",
                position, len(ids), now - conversion_started,
            )
            last_progress = now
    logger.info("Simulation aggregates: verifying row counts and removing legacy field table")
    if bind.execute(sa.select(sa.func.count()).select_from(result)).scalar_one() != len(ids):
        raise RuntimeError("Simulation result migration count mismatch")
    if (
        bind.execute(sa.select(sa.func.count()).select_from(old_candidates)).scalar_one()
        != candidate_count
    ):
        raise RuntimeError("Simulation candidate migration count mismatch")
    op.drop_table("simulation_field")
    logger.info("Simulation aggregates: conversion finished in %.1fs", time.monotonic() - started)


def downgrade():
    op.create_table(
        "simulation_field",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "simulation_id",
            sa.Text(),
            sa.ForeignKey("simulation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("data", JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_simulation_field_simulation_id", "simulation_field", ["simulation_id"])
    bind = op.get_bind()
    metadata = sa.MetaData()
    setup = sa.Table("simulation", metadata, autoload_with=bind)
    result = sa.Table("simulation_result", metadata, autoload_with=bind)
    fields = sa.Table("simulation_field", metadata, autoload_with=bind)
    candidates = sa.Table("simulation_field_candidates", metadata, autoload_with=bind)
    for row in bind.execute(
        sa.select(setup, result.c.output, result.c.result_revision).join(result)
    ).all():
        output = row.output or {}
        previous = {f["id"]: f for f in output.get("response", {}).get("fields", [])}
        for field_id in row.field_order:
            data = deepcopy(row.fields[field_id])
            baseline = data.pop("baseline", {})
            fixed = data.pop("fixed", {})
            data.pop("fixed_candidate", None)
            data.pop("manual_candidate", None)
            baseline_revision = data.pop("baseline_revision", -1)
            values = {
                "crop_rotation": [],
                "rotation_id": None,
                "db2": 0,
                "n_load": 0,
                "leaching": 0,
                "fen": 0,
                **baseline,
            }
            values.update(
                {key: previous[field_id].get(key, values[key]) for key in OUTPUT_KEYS}
                if field_id in previous
                else {}
            )
            if baseline_revision > (row.result_revision if row.result_revision is not None else -1):
                values.update(baseline)
            values.update(fixed if data.get("allowed_rotation_ids") else {})
            bind.execute(
                fields.insert().values(id=field_id, simulation_id=row.id, data={**data, **values})
            )
        query = sa.select(candidates.c.id, candidates.c.field_id, candidates.c.data).where(
            candidates.c.simulation_id == row.id
        )
        for cached in bind.execute(query.execution_options(yield_per=1)):
            data = deepcopy(cached.data)
            setup_field = row.fields.get(cached.field_id, {})
            for overlay in (
                setup_field.get("manual_candidate"),
                output.get("selected_candidates", {}).get(cached.field_id),
                setup_field.get("fixed_candidate"),
            ):
                if overlay:
                    data["candidates"] = [
                        c for c in data["candidates"] if candidate_id(c) != candidate_id(overlay)
                    ] + [overlay]
            if data != cached.data:
                bind.execute(
                    candidates.update()
                    .where(candidates.c.id == cached.id)
                    .values(data=data, updated_at=sa.func.now())
                )
    op.drop_index(CANDIDATE_INDEX, table_name="simulation_field_candidates")
    op.drop_table("simulation_result")
    for column in ("field_order", "fields", "revision"):
        op.drop_column("simulation", column)
