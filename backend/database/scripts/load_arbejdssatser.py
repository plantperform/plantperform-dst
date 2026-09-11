"""Load work-rate reference data into the runtime lookup table."""

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

CSV_PATH = source_path("Arbejdssatser.csv")


def parse_arbejdssatser(path: Path = CSV_PATH) -> list[tuple]:
    source_rows = read_csv_rows(
        path,
        delimiter=",",
        required_columns={
            "behandling", "jordbonitet", "afgroedekode", "driftsform", "pris_kr_per_enhed",
        },
    )
    return [
        (
            row_number,
            text(row["behandling"], field="behandling", row_number=row_number),
            text(row["jordbonitet"], field="jordbonitet", row_number=row_number, required=False),
            integer(
                row["afgroedekode"],
                field="afgroedekode",
                row_number=row_number,
                required=False,
            ),
            text(row["driftsform"], field="driftsform", row_number=row_number, required=False),
            number(
                row["pris_kr_per_enhed"],
                field="pris_kr_per_enhed",
                row_number=row_number,
            ),
        )
        for row_number, row in enumerate(source_rows, start=2)
    ]


def load_arbejdssatser(path: Path = CSV_PATH, database_url: str | None = None) -> None:
    rows = parse_arbejdssatser(path)
    replace_tables(
        [
            (
                "arbejdssats",
                (
                    "source_order", "behandling", "jordbonitet", "afgroedekode", "driftsform",
                    "pris_kr_per_enhed",
                ),
                rows,
            ),
        ],
        database_url=database_url,
    )
    print(f"Loaded {len(rows):,} work rates", flush=True)


if __name__ == "__main__":
    load_arbejdssatser()
