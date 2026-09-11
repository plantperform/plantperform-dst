"""Load straw yields into the runtime lookup table."""

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

CSV_PATH = source_path("Halmudbytte_afgroedekoder.csv")


def parse_halmudbytte(path: Path = CSV_PATH) -> list[tuple]:
    source_rows = read_csv_rows(
        path,
        delimiter=",",
        required_columns={"afgroedekode", "jordbonitet", "halm_udbytte_kg_ha"},
    )
    return [
        (
            row_number,
            integer(row["afgroedekode"], field="afgroedekode", row_number=row_number),
            text(row["jordbonitet"], field="jordbonitet", row_number=row_number),
            number(
                row["halm_udbytte_kg_ha"],
                field="halm_udbytte_kg_ha",
                row_number=row_number,
            ),
        )
        for row_number, row in enumerate(source_rows, start=2)
    ]


def load_halmudbytte(path: Path = CSV_PATH, database_url: str | None = None) -> None:
    rows = parse_halmudbytte(path)
    replace_tables(
        [
            (
                "halmudbytte",
                ("source_order", "afgroedekode", "jordbonitet", "halm_udbytte_kg_ha"),
                rows,
            ),
        ],
        database_url=database_url,
    )
    print(f"Loaded {len(rows):,} straw yields", flush=True)


if __name__ == "__main__":
    load_halmudbytte()
