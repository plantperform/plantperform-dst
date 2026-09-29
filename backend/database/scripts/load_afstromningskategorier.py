"""Load the authoritative P-runoff category lookup from the wide master CSV."""

from __future__ import annotations

from pathlib import Path

from database.scripts.runtime_lookup_loader import (
    integer,
    read_csv_rows,
    replace_tables,
    source_path,
)

CSV_PATH = source_path("Afgroedetabel2027_master.csv")


def parse_afstromningskategorier(path: Path = CSV_PATH) -> list[tuple]:
    rows = read_csv_rows(
        path,
        delimiter=",",
        required_columns={
            "AfgroedeKode", "nuar_afstromningskategori", "p_afstromningskategori_med_w",
        },
    )
    result = []
    for row_number, row in enumerate(rows, start=2):
        code = integer(row["AfgroedeKode"], field="AfgroedeKode", row_number=row_number)
        base = integer(
            row["nuar_afstromningskategori"],
            field="nuar_afstromningskategori",
            row_number=row_number,
            required=False,
        )
        if base is None:
            continue  # ingen afstromningskategori for denne afgrode i kilden
        alternate = integer(
            row["p_afstromningskategori_med_w"],
            field="p_afstromningskategori_med_w",
            row_number=row_number,
            required=False,
        )
        if base not in range(1, 9) or (alternate is not None and alternate not in range(1, 9)):
            raise ValueError(f"Invalid P-runoff category on row {row_number}")
        result.append((code, base, alternate))
    if len({row[0] for row in result}) != len(result):
        raise ValueError("Master CSV contains duplicate AfgroedeKode values")
    return result


def load_afstromningskategorier(path: Path = CSV_PATH, database_url: str | None = None) -> None:
    rows = parse_afstromningskategorier(path)
    replace_tables(
        [
            (
                "afstromningskategori",
                ("afgroedekode", "standard_kategori", "vinterdaekke_kategori"),
                rows,
            ),
        ],
        database_url=database_url,
    )
    print(f"Loaded {len(rows):,} P-runoff categories", flush=True)


if __name__ == "__main__":
    load_afstromningskategorier()
