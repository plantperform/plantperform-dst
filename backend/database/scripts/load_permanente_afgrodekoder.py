"""Load permanent (ikke-omdrift) afgrødekoder into the runtime lookup table."""

from __future__ import annotations

from pathlib import Path

from database.scripts.runtime_lookup_loader import (
    integer,
    read_csv_rows,
    replace_tables,
    source_path,
    text,
)

CSV_PATH = source_path("Permanente_afgroder_ikke_omdrift.csv")


def parse_permanente_afgrodekoder(path: Path = CSV_PATH) -> list[tuple]:
    source_rows = read_csv_rows(
        path,
        delimiter=",",
        required_columns={"afgrode_kode", "afgrode_navn", "klassifikation"},
    )
    return [
        (
            integer(row["afgrode_kode"], field="afgrode_kode", row_number=row_number),
            text(row["afgrode_navn"], field="afgrode_navn", row_number=row_number),
        )
        for row_number, row in enumerate(source_rows, start=2)
        if row["klassifikation"].strip() == "Ikke-omdrift"
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
