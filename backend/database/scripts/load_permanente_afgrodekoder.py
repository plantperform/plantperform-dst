"""Load permanent (ikke-omdrift) afgrødekoder from the wide master CSV."""

from __future__ import annotations

from pathlib import Path

from database.scripts.runtime_lookup_loader import (
    integer,
    read_csv_rows,
    replace_tables,
    source_path,
    text,
)

CSV_PATH = source_path("Afgroedetabel2027_master.csv")


def parse_permanente_afgrodekoder(path: Path = CSV_PATH) -> list[tuple]:
    source_rows = read_csv_rows(
        path,
        delimiter=",",
        required_columns={"AfgroedeKode", "Navn", "er_permanent_afgroede"},
    )
    return [
        (
            integer(row["AfgroedeKode"], field="AfgroedeKode", row_number=row_number),
            text(row["Navn"], field="Navn", row_number=row_number),
        )
        for row_number, row in enumerate(source_rows, start=2)
        if row["er_permanent_afgroede"].strip() == "Ja"
    ]


def load_permanente_afgrodekoder(path: Path = CSV_PATH, database_url: str | None = None) -> None:
    rows = parse_permanente_afgrodekoder(path)
    replace_tables(
        [
            ("permanent_afgrode", ("afgroedekode", "navn"), rows),
        ],
        database_url=database_url,
    )
    print(f"Loaded {len(rows):,} permanente afgrødekoder", flush=True)


if __name__ == "__main__":
    load_permanente_afgrodekoder()
