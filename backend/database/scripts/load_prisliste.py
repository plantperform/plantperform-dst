"""Load the shared price list into the runtime lookup table."""

from __future__ import annotations

from pathlib import Path

from database.scripts.runtime_lookup_loader import (
    number,
    read_csv_rows,
    replace_tables,
    source_path,
    text,
)

CSV_PATH = source_path("Prisliste_2026.csv")


def parse_prisliste(path: Path = CSV_PATH) -> list[tuple]:
    source_rows = read_csv_rows(
        path,
        delimiter=";",
        required_columns={"post", "kategori", "type", "pris", "enhed"},
    )
    return [
        (
            row_number,
            text(row["post"], field="post", row_number=row_number),
            text(row["kategori"], field="kategori", row_number=row_number),
            text(row["type"], field="type", row_number=row_number),
            number(row["pris"], field="pris", row_number=row_number),
            text(row["enhed"], field="enhed", row_number=row_number),
        )
        for row_number, row in enumerate(source_rows, start=2)
    ]


def load_prisliste(path: Path = CSV_PATH, database_url: str | None = None) -> None:
    rows = parse_prisliste(path)
    replace_tables(
        [("prisliste", ("source_order", "post", "kategori", "type", "pris", "enhed"), rows)],
        database_url=database_url,
    )
    print(f"Loaded {len(rows):,} price-list rows", flush=True)


if __name__ == "__main__":
    load_prisliste()
