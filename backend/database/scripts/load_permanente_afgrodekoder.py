"""Parse permanent (ikke-omdrift) afgrødekoder."""

from __future__ import annotations

from pathlib import Path

from database.scripts.runtime_lookup_loader import (
    integer,
    read_csv_rows,
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
    rows = [
        (
            integer(row["afgrode_kode"], field="afgrode_kode", row_number=row_number),
            text(row["afgrode_navn"], field="afgrode_navn", row_number=row_number),
        )
        for row_number, row in enumerate(source_rows, start=2)
        if row["klassifikation"].strip() == "Ikke-omdrift"
    ]
    if len({row[0] for row in rows}) != len(rows):
        raise ValueError("Permanent crop source contains duplicate afgrødekoder")
    return rows


def load_permanente_afgrodekoder(path: Path = CSV_PATH, database_url: str | None = None) -> None:
    """Compatibility entry point; crop-code sources now reload together."""
    from database.scripts.load_afgroeder import load_afgroeder

    load_afgroeder(permanent_path=path, database_url=database_url)


if __name__ == "__main__":
    load_permanente_afgrodekoder()
