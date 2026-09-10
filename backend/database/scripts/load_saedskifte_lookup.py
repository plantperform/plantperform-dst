"""Load the consolidated crop-rotation lookup into runtime database tables.

The source CSV remains an administration-time input under data/raw/ANGJ-data
and is deliberately excluded from Git and production backend artifacts. The
application reads the resulting saedskifte_rotation and saedskifte_category
tables instead.
"""

from __future__ import annotations

import csv
import json
import math
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "raw" / "ANGJ-data" / "Ny_sædskifte_lookup_sammenlagt.csv"
HEADER_ROWS_TO_SKIP = 4
EXPECTED_COLUMNS = 41

RawPosition = tuple[int | None, int | None, str | None]


@dataclass
class RotationRecord:
    saedskiftevariant: int
    variant: int
    rotation: tuple[RawPosition, ...]
    driftsform: str | None
    categories: set[str] = field(default_factory=set)


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def _parse_int(value: str | None, *, field_name: str, line_number: int) -> int:
    text = _clean_text(value)
    if text is None:
        raise ValueError(f"Missing {field_name} on CSV record ending at line {line_number}")
    try:
        number = float(text)
    except ValueError as error:
        raise ValueError(
            f"Invalid {field_name} {text!r} on CSV record ending at line {line_number}"
        ) from error
    if not math.isfinite(number) or not number.is_integer():
        raise ValueError(
            f"Invalid {field_name} {text!r} on CSV record ending at line {line_number}"
        )
    return int(number)


def _parse_optional_int(value: str | None, *, field_name: str, line_number: int) -> int | None:
    if _clean_text(value) is None:
        return None
    return _parse_int(value, field_name=field_name, line_number=line_number)


def parse_saedskifte_lookup(path: Path = CSV_PATH) -> dict[tuple[int, int], RotationRecord]:
    """Parse and fully validate the CSV without modifying the database."""
    records: dict[tuple[int, int], RotationRecord] = {}

    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.reader(source, delimiter=";")
        for _ in range(HEADER_ROWS_TO_SKIP):
            try:
                next(reader)
            except StopIteration as error:
                raise ValueError("Sædskifte lookup is missing its four header rows") from error

        for row in reader:
            if not any(_clean_text(value) is not None for value in row):
                continue
            if len(row) != EXPECTED_COLUMNS:
                raise ValueError(
                    f"Expected {EXPECTED_COLUMNS} columns on CSV record ending at line "
                    f"{reader.line_num}, got {len(row)}"
                )

            saedskiftevariant = _parse_int(
                row[1], field_name="saedskiftevariant", line_number=reader.line_num,
            )
            variant = _parse_int(row[2], field_name="variant", line_number=reader.line_num)
            rotation = tuple(
                (
                    _parse_optional_int(
                        row[3 + 4 * index],
                        field_name=f"afgr{index + 1}_kode",
                        line_number=reader.line_num,
                    ),
                    _parse_optional_int(
                        row[5 + 4 * index],
                        field_name=f"udl{index + 1}_kode",
                        line_number=reader.line_num,
                    ),
                    _clean_text(row[6 + 4 * index]),
                )
                for index in range(8)
            )
            category = _clean_text(row[38])
            key = (saedskiftevariant, variant)

            existing = records.get(key)
            if existing is None:
                existing = RotationRecord(
                    saedskiftevariant=saedskiftevariant,
                    variant=variant,
                    rotation=rotation,
                    driftsform=_clean_text(row[35]),
                )
                records[key] = existing
            elif existing.rotation != rotation:
                raise ValueError(
                    "Conflicting rotation sequence for "
                    f"saedskiftevariant {saedskiftevariant}, variant {variant} "
                    f"on CSV record ending at line {reader.line_num}"
                )
            elif existing.driftsform is None:
                existing.driftsform = _clean_text(row[35])

            if category is not None:
                existing.categories.add(category)

    if not records:
        raise ValueError("Sædskifte lookup contains no rotation records")
    return records


def _as_database_rotation(rotation: tuple[RawPosition, ...]) -> str:
    return json.dumps(
        [
            {
                "afgrode_kode": afgrode_kode,
                "udlaeg_kode": udlaeg_kode,
                "udlaeg_navn": udlaeg_navn,
            }
            for afgrode_kode, udlaeg_kode, udlaeg_navn in rotation
        ]
    )


def _database_rows(
    records: dict[tuple[int, int], RotationRecord],
) -> tuple[list[tuple[int, int, str, str | None]], list[tuple[int, str]]]:
    rotation_rows = [
        (
            record.saedskiftevariant,
            record.variant,
            _as_database_rotation(record.rotation),
            record.driftsform,
        )
        for _, record in sorted(records.items())
    ]
    category_rows = sorted(
        {
            (record.saedskiftevariant, category)
            for record in records.values()
            for category in record.categories
        }
    )
    return rotation_rows, category_rows


def load_saedskifte_lookup(
    path: Path = CSV_PATH,
    database_url: str | None = None,
) -> None:
    """Atomically replace the runtime rotation lookup tables from ``path``."""
    records = parse_saedskifte_lookup(path)
    load_dotenv(ROOT.parent / ".env")
    database_url = database_url or os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not configured")
    dsn = database_url.replace("postgresql+psycopg://", "postgresql://")

    rotation_rows, category_rows = _database_rows(records)

    start = time.monotonic()
    with psycopg.connect(dsn) as connection, connection.cursor() as cursor:
        cursor.execute("TRUNCATE saedskifte_category, saedskifte_rotation")
        cursor.executemany(
            """
            INSERT INTO saedskifte_rotation
                (saedskiftevariant, variant, rotation, driftsform)
            VALUES (%s, %s, %s::json, %s)
            """,
            rotation_rows,
        )
        cursor.executemany(
            """
            INSERT INTO saedskifte_category (saedskiftevariant, kategori)
            VALUES (%s, %s)
            """,
            category_rows,
        )

    elapsed = time.monotonic() - start
    print(
        f"Loaded {len(rotation_rows):,} rotations and {len(category_rows):,} categories "
        f"in {elapsed:.1f}s",
        flush=True,
    )


if __name__ == "__main__":
    load_saedskifte_lookup()
