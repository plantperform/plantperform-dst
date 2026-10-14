"""Test-only historical candidate schema and readers for migration fixtures.

Application metadata must never include this table. These helpers exercise
historical migrations and provide synthetic solver inputs to older tests.
"""

from time import monotonic

from sqlalchemy import Column, DateTime, ForeignKey, Index, MetaData, Table, Text, func, select
from sqlalchemy.dialects.postgresql import JSONB

from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.data.optimizer_inputs import parse_optimizer_input
from app.data.simulation_store import _row, merge_candidates

caches = Table(
    "simulation_field_candidates",
    MetaData(),
    Column("id", Text, primary_key=True),
    Column("simulation_id", Text, ForeignKey(setups.c.id, ondelete="CASCADE"), nullable=False),
    Column("field_id", Text, nullable=False),
    Column("data", JSONB, nullable=False),
    Column("optimizer_input", JSONB, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Index("ix_simulation_field_candidates_simulation_id", "simulation_id"),
    Index("ix_simulation_field_candidates_field_id", "field_id"),
    Index(
        "ix_simulation_field_candidates_simulation_field",
        "simulation_id",
        "field_id",
        unique=True,
    ),
)


def merge_setup_candidates(data, selected, setup):
    row = merge_candidates(data, setup.get("manual_candidate"))
    row = merge_candidates(row, selected)
    row = merge_candidates(row, setup.get("economics_candidate"))
    return merge_candidates(row, setup.get("fixed_candidate"))


def _candidates(session, simulation_id, *, compact=False, timings=None):
    started = monotonic()
    row = session.execute(
        select(setups.c.fields, setups.c.field_order, results.c.output["selected_candidates"])
        .join(results)
        .where(setups.c.id == simulation_id)
    ).one()
    selected = row[2] or {}
    column = caches.c.optimizer_input if compact else caches.c.data
    query = select(caches.c.field_id, column).where(caches.c.simulation_id == simulation_id)
    reads = monotonic() - started
    validation = 0.0
    candidates = []
    started = monotonic()
    rows = iter(session.execute(query.execution_options(yield_per=1)))
    while True:
        cached = next(rows, None)
        reads += monotonic() - started
        if cached is None:
            break
        started = monotonic()
        data = parse_optimizer_input(cached[1]) if compact else cached[1]
        candidates.append(
            merge_setup_candidates(
                data, selected.get(cached.field_id), row.fields.get(cached.field_id, {})
            )
        )
        validation += monotonic() - started
        started = monotonic()
    if timings is not None:
        timings.update(compact_candidate_reads=reads, candidate_validation=validation)
    positions = {field_id: i for i, field_id in enumerate(row.field_order)}
    return sorted(candidates, key=lambda c: (positions.get(c.field_id, len(positions)), c.field_id))


def _candidate_row(session, simulation_id, field_id):
    return session.execute(
        select(
            caches.c.data,
            results.c.output["selected_candidates"][field_id],
            setups.c.fields[field_id],
        )
        .select_from(caches.join(setups).join(results, results.c.simulation_id == setups.c.id))
        .where(
            caches.c.simulation_id == simulation_id,
            caches.c.field_id == field_id,
        )
    ).first()


def list_simulation_field_candidates(farm_id, simulation_id, email):
    with _sessions() as session:
        if _row(session, farm_id, simulation_id, email, ready=True) is None:
            return None
        return _candidates(session, simulation_id)


def get_simulation_field_candidates(farm_id, simulation_id, field_id, email):
    with _sessions() as session:
        if _row(session, farm_id, simulation_id, email, ready=True) is None:
            return None
        row = _candidate_row(session, simulation_id, field_id)
        return merge_setup_candidates(row[0], row[1], row[2] or {}) if row else None


def _sessions():
    from app.data.repository import SessionLocal

    return SessionLocal()
