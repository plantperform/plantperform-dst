"""Load crop work quantities into the runtime lookup table."""

from __future__ import annotations

from pathlib import Path

from database.scripts.runtime_lookup_loader import (
    integer,
    number,
    read_csv_rows,
    replace_tables,
    source_path,
    text,
)

CSV_PATH = source_path("Arbejdsmaengder_afgroedekoder.csv")


def parse_arbejdsmaengder(path: Path = CSV_PATH) -> list[tuple]:
    source_rows = read_csv_rows(
        path,
        delimiter=",",
        required_columns={
            "afgroedekode", "driftsform", "jordbonitet", "kvalitet", "kategori", "behandling",
            "antal",
        },
    )
    return [
        (
            row_number,
            integer(row["afgroedekode"], field="afgroedekode", row_number=row_number),
            text(row["driftsform"], field="driftsform", row_number=row_number),
            text(row["jordbonitet"], field="jordbonitet", row_number=row_number),
            text(row["kvalitet"], field="kvalitet", row_number=row_number, required=False),
            text(row["kategori"], field="kategori", row_number=row_number),
            text(row["behandling"], field="behandling", row_number=row_number),
            number(row["antal"], field="antal", row_number=row_number),
        )
        for row_number, row in enumerate(source_rows, start=2)
    ]


def load_arbejdsmaengder(path: Path = CSV_PATH, database_url: str | None = None) -> None:
    rows = parse_arbejdsmaengder(path)
    replace_tables(
        [
            (
                "arbejdsmaengde",
                (
                    "source_order", "afgroedekode", "driftsform", "jordbonitet", "kvalitet",
                    "kategori", "behandling", "antal",
                ),
                rows,
            ),
        ],
        database_url=database_url,
    )
    print(f"Loaded {len(rows):,} work quantities", flush=True)


if __name__ == "__main__":
    load_arbejdsmaengder()
