"""Shared validation and database replacement helpers for lookup loaders.

Each source file has its own loader module.  This module only keeps the
transaction and primitive parsing behavior consistent between those modules.
"""

from __future__ import annotations

import csv
import os
from collections.abc import Iterable, Sequence
from pathlib import Path

import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
ANGJ_DATA_DIR = ROOT / "data" / "raw" / "ANGJ-data"

TableLoad = tuple[str, tuple[str, ...], Sequence[tuple]]


def source_path(filename: str) -> Path:
    return ANGJ_DATA_DIR / filename


def read_csv_rows(
    path: Path,
    *,
    delimiter: str,
    required_columns: Iterable[str],
) -> list[dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(f"Expected {path}")
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source, delimiter=delimiter)
        columns = set(reader.fieldnames or ())
        missing = set(required_columns) - columns
        if missing:
            raise ValueError(f"{path.name} is missing columns: {', '.join(sorted(missing))}")
        rows = list(reader)
    if not rows:
        raise ValueError(f"{path.name} contains no data rows")
    return rows


def text(value: object, *, field: str, row_number: int, required: bool = True) -> str:
    result = str(value).strip() if value is not None else ""
    if required and not result:
        raise ValueError(f"Missing {field} on row {row_number}")
    return result


def integer(value: object, *, field: str, row_number: int, required: bool = True) -> int | None:
    raw = text(value, field=field, row_number=row_number, required=required)
    if not raw:
        return None
    try:
        number = float(raw.replace(",", "."))
    except ValueError as error:
        raise ValueError(f"Invalid {field} {raw!r} on row {row_number}") from error
    if not number.is_integer():
        raise ValueError(f"Invalid {field} {raw!r} on row {row_number}")
    return int(number)


def number(value: object, *, field: str, row_number: int, required: bool = True) -> float | None:
    raw = text(value, field=field, row_number=row_number, required=required)
    if not raw:
        return None
    try:
        return float(raw.replace(",", "."))
    except ValueError as error:
        raise ValueError(f"Invalid {field} {raw!r} on row {row_number}") from error


def database_dsn(database_url: str | None = None) -> str:
    load_dotenv(ROOT.parent / ".env")
    url = database_url or os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not configured")
    return url.replace("postgresql+psycopg://", "postgresql://")


def replace_tables(loads: Sequence[TableLoad], *, database_url: str | None = None) -> None:
    """Atomically replace the explicitly supplied lookup tables.

    Callers must finish parsing and validation before invoking this function,
    ensuring a malformed source does not alter a populated database.
    """
    if not loads:
        raise ValueError("At least one table must be supplied")
    if any(not rows for _, _, rows in loads):
        empty_tables = [table for table, _, rows in loads if not rows]
        raise ValueError(
            f"Refusing to replace lookup tables with no rows: {', '.join(empty_tables)}",
        )

    table_names = ", ".join(table for table, _, _ in loads)
    with psycopg.connect(database_dsn(database_url)) as connection, connection.cursor() as cursor:
        cursor.execute(f"TRUNCATE {table_names}")
        for table, columns, rows in loads:
            placeholders = ", ".join("%s" for _ in columns)
            cursor.executemany(
                f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})",
                rows,
            )
        connection.commit()
