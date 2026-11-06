"""Parse the harmoniareal and arealstøtte flags per afgrødekode from the master CSV."""

from __future__ import annotations

from pathlib import Path

from database.scripts.runtime_lookup_loader import (
    integer,
    read_csv_rows,
    source_path,
)

CSV_PATH = source_path("Afgroedetabel2027_master.csv")


def parse_afgroede_stoette(path: Path = CSV_PATH) -> list[tuple[int, bool, bool, bool, int, bool]]:
    """Return (afgroedekode, harmoni, grundbetaling, landbrugsareal, art_4_4_c, brak).

    The master columns hold 0 or 1 (Art. 4.4.C also 2). A blank cell reads as
    0, the same as a flag that does not apply.
    """
    source_rows = read_csv_rows(
        path,
        delimiter=",",
        required_columns={
            "AfgroedeKode", "Harmoni", "Grundbetaling", "Landbrugsareal", "Art. 4.4.C", "brak",
        },
    )

    def flag(row: dict[str, str], column: str, row_number: int) -> int:
        return integer(row[column], field=column, row_number=row_number, required=False) or 0

    rows = []
    for row_number, row in enumerate(source_rows, start=2):
        art_4_4_c = flag(row, "Art. 4.4.C", row_number)
        if art_4_4_c not in (0, 1, 2):
            raise ValueError(f"Art. 4.4.C must be 0, 1 or 2 on row {row_number}")
        rows.append(
            (
                integer(row["AfgroedeKode"], field="AfgroedeKode", row_number=row_number),
                flag(row, "Harmoni", row_number) == 1,
                flag(row, "Grundbetaling", row_number) == 1,
                flag(row, "Landbrugsareal", row_number) == 1,
                art_4_4_c,
                flag(row, "brak", row_number) == 1,
            )
        )
    if len({row[0] for row in rows}) != len(rows):
        raise ValueError("Arealstøtte source contains duplicate afgrødekoder")
    return rows
