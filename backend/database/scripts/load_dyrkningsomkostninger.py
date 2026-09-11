"""Load fixed crop cultivation costs into the runtime lookup table."""

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

CSV_PATH = source_path("Dyrkningsomkostninger_afgroedekoder.csv")


def parse_dyrkningsomkostninger(path: Path = CSV_PATH) -> list[tuple]:
    source_rows = read_csv_rows(
        path,
        delimiter=",",
        required_columns={"afgroedekode", "driftsform", "kategori", "behandling", "udgift_kr_ha"},
    )
    return [
        (
            row_number,
            integer(row["afgroedekode"], field="afgroedekode", row_number=row_number),
            text(row["driftsform"], field="driftsform", row_number=row_number),
            text(row["kategori"], field="kategori", row_number=row_number),
            text(row["behandling"], field="behandling", row_number=row_number),
            number(row["udgift_kr_ha"], field="udgift_kr_ha", row_number=row_number),
        )
        for row_number, row in enumerate(source_rows, start=2)
    ]


def load_dyrkningsomkostninger(path: Path = CSV_PATH, database_url: str | None = None) -> None:
    rows = parse_dyrkningsomkostninger(path)
    replace_tables(
        [
            (
                "dyrkningsomkostning",
                (
                    "source_order", "afgroedekode", "driftsform", "kategori", "behandling",
                    "udgift_kr_ha",
                ),
                rows,
            ),
        ],
        database_url=database_url,
    )
    print(f"Loaded {len(rows):,} fixed cultivation costs", flush=True)


if __name__ == "__main__":
    load_dyrkningsomkostninger()
