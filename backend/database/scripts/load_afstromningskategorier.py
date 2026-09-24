"""Parse the authoritative P-runoff category lookup."""

from __future__ import annotations

from pathlib import Path

from database.scripts.runtime_lookup_loader import (
    integer,
    read_csv_rows,
    source_path,
    text,
)

CSV_PATH = source_path("Bilag_1_tabel_1_med_P_noegle.csv")


def parse_afstromningskategorier(path: Path = CSV_PATH) -> list[tuple]:
    rows = read_csv_rows(
        path,
        delimiter=";",
        required_columns={
            "Afgrødekode", "Navn", "P_afstrømningskategori", "P_afstrømningskategori_med_W",
        },
    )
    result = []
    for row_number, row in enumerate(rows, start=2):
        code = integer(row["Afgrødekode"], field="Afgrødekode", row_number=row_number)
        base = integer(
            row["P_afstrømningskategori"],
            field="P_afstrømningskategori",
            row_number=row_number,
        )
        alternate = integer(
            row["P_afstrømningskategori_med_W"],
            field="P_afstrømningskategori_med_W",
            row_number=row_number,
            required=False,
        )
        if base not in range(1, 9) or (alternate is not None and alternate not in range(1, 9)):
            raise ValueError(f"Invalid P-runoff category on row {row_number}")
        name = text(row["Navn"], field="Navn", row_number=row_number)
        result.append((code, name, base, alternate))
    if len({row[0] for row in result}) != len(result):
        raise ValueError("P-runoff source contains duplicate afgrødekoder")
    return result


def load_afstromningskategorier(path: Path = CSV_PATH, database_url: str | None = None) -> None:
    """Compatibility entry point; crop-code sources now reload together."""
    from database.scripts.load_afgroeder import load_afgroeder

    load_afgroeder(runoff_path=path, database_url=database_url)


if __name__ == "__main__":
    load_afstromningskategorier()
