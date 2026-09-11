"""Load crop sales prices into the runtime lookup table."""

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

CSV_PATH = source_path("Salgspriser_afgroedekoder.csv")


def parse_salgspriser(path: Path = CSV_PATH) -> list[tuple]:
    source_rows = read_csv_rows(
        path,
        delimiter=",",
        required_columns={
            "afgroedekode", "driftsform", "kvalitet", "salgspris", "enhed", "halm_pris_kr_kg",
        },
    )
    return [
        (
            row_number,
            integer(row["afgroedekode"], field="afgroedekode", row_number=row_number),
            text(row["driftsform"], field="driftsform", row_number=row_number),
            text(row["kvalitet"], field="kvalitet", row_number=row_number, required=False),
            number(
                row["salgspris"], field="salgspris", row_number=row_number, required=False,
            )
            or 0.0,
            text(row["enhed"], field="enhed", row_number=row_number),
            number(
                row["halm_pris_kr_kg"],
                field="halm_pris_kr_kg",
                row_number=row_number,
                required=False,
            )
            or 0.0,
        )
        for row_number, row in enumerate(source_rows, start=2)
    ]


def load_salgspriser(path: Path = CSV_PATH, database_url: str | None = None) -> None:
    rows = parse_salgspriser(path)
    replace_tables(
        [
            (
                "salgspris",
                (
                    "source_order", "afgroedekode", "driftsform", "kvalitet", "salgspris", "enhed",
                    "halm_pris_kr_kg",
                ),
                rows,
            ),
        ],
        database_url=database_url,
    )
    print(f"Loaded {len(rows):,} sales prices", flush=True)


if __name__ == "__main__":
    load_salgspriser()
