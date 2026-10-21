"""Run registry migrations and loaders in order, resuming unfinished work."""

from __future__ import annotations

import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path

from database.scripts import (
    load_afgroeder,
    load_goedningsregioner,
    load_historisk_goedningsfordeling,
    load_kvotegivende_areal,
    load_kystvandoplande,
    load_mars_projekter,
    load_oekonomital_afgroedebundet,
    load_oekonomital_generelle_satser,
    load_saedskifte_lookup,
)
from database.scripts.load_registry_from_merged_gpkg import (
    MERGED_GPKG,
    StageReporter,
    format_duration,
    load_merged_run,
    merged_source_metadata,
)
from database.scripts.registry_load_checkpoint import (
    DEFAULT_BATCH_SIZE,
    FULL_COMMAND,
    MERGED_STEP,
    LoadRun,
    open_load_run,
    run_cli,
)
from database.scripts.runtime_lookup_loader import database_dsn

BACKEND = Path(__file__).resolve().parents[2]
# Stable names are persisted in the checkpoint. Keep this order in sync with
# the documented pipeline; the GeoPackage loader always precedes these steps.
LOADERS: tuple[tuple[str, Callable[[], None]], ...] = (
    ("kystvandoplande", load_kystvandoplande.load_kystvandoplande),
    ("goedningsregioner", load_goedningsregioner.load_goedningsregioner),
    ("mars-projekter", load_mars_projekter.load_mars_projekter),
    (
        "historisk-goedningsfordeling",
        load_historisk_goedningsfordeling.load_historisk_goedningsfordeling,
    ),
    ("saedskifte-lookup", load_saedskifte_lookup.load_saedskifte_lookup),
    ("afgroeder", load_afgroeder.load_afgroeder),
    ("oekonomital-afgroedebundet", load_oekonomital_afgroedebundet.load_oekonomital_afgroedebundet),
    (
        "oekonomital-generelle-satser",
        load_oekonomital_generelle_satser.load_oekonomital_generelle_satser,
    ),
    ("kvotegivende-areal", load_kvotegivende_areal.load_kvotegivende_areal),
)


def source_paths() -> list[Path]:
    catchments = load_kystvandoplande.SHP_PATH
    return [
        MERGED_GPKG,
        catchments,
        *catchments.parent.glob(f"{catchments.stem}.*"),
        load_mars_projekter.GPKG_PATH,
        load_historisk_goedningsfordeling.CSV_PATH,
        load_saedskifte_lookup.CSV_PATH,
        load_afgroeder.MASTER_PATH,
        load_oekonomital_afgroedebundet.CSV_PATH,
        load_oekonomital_generelle_satser.CSV_PATH,
    ]


def migrate() -> None:
    with StageReporter("Applying database migrations"):
        subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "database/alembic.ini", "upgrade", "head"],
            cwd=BACKEND,
            check=True,
        )


def run_steps(run: LoadRun, *, batch_size: int = DEFAULT_BATCH_SIZE) -> None:
    # Recheck migrations even when resuming. Alembic already tracks its progress.
    migrate()
    run.check_sources()
    if MERGED_STEP in run.state["completed_steps"]:
        print("Skipping completed loader: merged-gpkg", flush=True)
    else:
        load_merged_run(run, batch_size=batch_size)
    for name, load in LOADERS:
        if name in run.state["completed_steps"]:
            print(f"Skipping completed loader: {name}", flush=True)
            continue
        # Also check that the session holding the advisory lock is still alive
        # before starting work on a downstream loader's independent connection.
        run.connection.execute("SELECT 1")
        run.check_sources()
        with StageReporter(f"Loading {name}"):
            load()
        run.check_sources()
        run.mark_step(name)
    run.finish()


def load_registry_data(*, restart: bool = False, batch_size: int = DEFAULT_BATCH_SIZE) -> None:
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")
    start = time.monotonic()
    metadata = {**merged_source_metadata(), "steps": [MERGED_STEP, *[name for name, _ in LOADERS]]}
    with open_load_run(database_dsn(), FULL_COMMAND) as run:
        run.start(source_paths(), metadata, restart=restart)
        run_steps(run, batch_size=batch_size)
    print(f"Done in {format_duration(time.monotonic() - start)}", flush=True)


if __name__ == "__main__":
    run_cli(FULL_COMMAND, load_registry_data)
