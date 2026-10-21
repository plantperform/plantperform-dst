"""Persistent checkpoints shared by the two registry loading commands."""

from __future__ import annotations

import argparse
import hashlib
import sys
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb

CHECKPOINT_TABLE = "registry_data_load_checkpoint"
CHECKPOINT_VERSION = 1
DEFAULT_BATCH_SIZE = 10_000
FULL_COMMAND = "load-registry-data"
MERGED_COMMAND = "load-registry-from-merged-gpkg"
MERGED_STEP = "merged-gpkg"
STAGING_TABLE = "registry_merged_load"
LOCK_KEY = (1920365428, 20261021)


class CheckpointError(RuntimeError):
    """Progress cannot safely be resumed without an explicit restart."""


def file_signature(path: Path) -> tuple[int, int, int]:
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns


class LoadRun:
    def __init__(self, connection: psycopg.Connection, command: str) -> None:
        self.connection = connection
        self.command = command
        self.state: dict = {}
        self.source_signatures: dict[Path, tuple[int, int, int]] = {}

    def start(self, paths: Iterable[Path], metadata: dict, *, restart: bool = False) -> None:
        previous = self.connection.execute(
            f"SELECT state FROM {CHECKPOINT_TABLE} WHERE singleton"
        ).fetchone()
        unfinished = previous is not None and not previous[0].get("complete", False)
        if unfinished and not restart:
            old = previous[0]
            if old.get("command") != self.command:
                raise CheckpointError(
                    f"An unfinished run belongs to pixi run {old.get('command')}. "
                    f"Resume that command, or use pixi run {self.command} --restart."
                )
            if old.get("version") != CHECKPOINT_VERSION:
                raise CheckpointError("Incompatible checkpoint format; use --restart.")

        print("Checking source file fingerprints...", flush=True)
        fingerprints = {}
        for path in sorted(set(paths)):
            before = file_signature(path)
            with path.open("rb") as source:
                fingerprints[str(path.resolve())] = hashlib.file_digest(
                    source, "sha256"
                ).hexdigest()
            if file_signature(path) != before:
                raise CheckpointError(f"Source changed while hashing: {path}; use --restart.")
            self.source_signatures[path] = before
        manifest = {"files": fingerprints, **metadata}
        if unfinished and not restart:
            self.state = previous[0]
            if self.state.get("sources") != manifest:
                raise CheckpointError("Source files or layer metadata changed; use --restart.")
            print(f"Resuming {self.command} (run {self.state['run_id']})", flush=True)
            return

        self.state = {
            "version": CHECKPOINT_VERSION,
            "run_id": str(uuid4()),
            "command": self.command,
            "sources": manifest,
            "complete": False,
            "completed_steps": [],
            "phase": "new",
            "next_offset": 0,
            "loaded": 0,
            "skipped_no_geom": 0,
            "skipped_dup_imk_id": 0,
        }
        # An old staging table without a matching checkpoint is never resumable.
        with self.connection.transaction():
            self.connection.execute(f"DROP TABLE IF EXISTS {STAGING_TABLE}")
            self.connection.execute(
                f"""INSERT INTO {CHECKPOINT_TABLE} (singleton, state)
                    VALUES (true, %s)
                    ON CONFLICT (singleton) DO UPDATE
                    SET state = EXCLUDED.state, updated_at = now()""",
                (Jsonb(self.state),),
            )
        print(f"Starting {self.command} (run {self.state['run_id']})", flush=True)

    def check_sources(self) -> None:
        for path, signature in self.source_signatures.items():
            if not path.exists() or file_signature(path) != signature:
                raise CheckpointError(f"Source changed during loading: {path}; use --restart.")

    def save(self, **changes: object) -> None:
        self.state.update(changes)
        result = self.connection.execute(
            f"""UPDATE {CHECKPOINT_TABLE} SET state = %s, updated_at = now()
                WHERE singleton AND state->>'run_id' = %s""",
            (Jsonb(self.state), self.state["run_id"]),
        )
        if result.rowcount != 1:
            raise CheckpointError("The load checkpoint is missing or was replaced; use --restart.")

    def mark_step(self, name: str) -> None:
        self.save(completed_steps=[*self.state["completed_steps"], name])

    def finish(self) -> None:
        self.check_sources()
        self.save(complete=True)


@contextmanager
def open_load_run(dsn: str, command: str) -> Iterator[LoadRun]:
    # This session also performs COPY/finalization, so its lock cannot outlive
    # a lost loading connection. Closing the session releases the advisory lock.
    with psycopg.connect(dsn, autocommit=True, connect_timeout=10) as connection:
        locked = connection.execute("SELECT pg_try_advisory_lock(%s, %s)", LOCK_KEY).fetchone()[0]
        if not locked:
            raise CheckpointError("Another registry loader is running; wait for it to finish.")
        connection.execute(
            f"""CREATE TABLE IF NOT EXISTS {CHECKPOINT_TABLE} (
                singleton boolean PRIMARY KEY CHECK (singleton),
                state jsonb NOT NULL,
                updated_at timestamptz NOT NULL DEFAULT now()
            )"""
        )
        yield LoadRun(connection, command)


def positive_batch_size(value: str) -> int:
    result = int(value)
    if result <= 0:
        raise argparse.ArgumentTypeError("batch size must be positive")
    return result


def run_cli(command: str, load: Callable[..., None]) -> None:
    parser = argparse.ArgumentParser(description="Load registry data, resuming interrupted work.")
    parser.add_argument("--restart", action="store_true", help="discard saved progress and reload")
    parser.add_argument("--batch-size", type=positive_batch_size, default=DEFAULT_BATCH_SIZE)
    args = parser.parse_args()
    try:
        load(restart=args.restart, batch_size=args.batch_size)
    except (Exception, KeyboardInterrupt) as error:
        print(f"Load stopped: {error or 'interrupted'}", file=sys.stderr, flush=True)
        print(
            "If the tunnel disconnected, reopen it. "
            f"Rerun pixi run {command} to resume saved progress.",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(130 if isinstance(error, KeyboardInterrupt) else 1) from error
