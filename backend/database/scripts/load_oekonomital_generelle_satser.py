"""Load arbejdssats and prisliste from the consolidated, non-afgrødekode-
bundne økonomi-CSV.

Splits rows by the CSV's own "kilde_tabel" column and writes each group to
its original table, unchanged from the two old per-file loaders this
replaces (Arbejdssatser.csv, Prisliste_2026.csv).
"""

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

CSV_PATH = source_path("Oekonomital_generelle_satser.csv")


def parse_oekonomital_generelle_satser(path: Path = CSV_PATH) -> tuple[list[tuple], list[tuple]]:
    rows = read_csv_rows(
        path,
        delimiter=",",
        required_columns={
            "kilde_tabel", "afgroedekode", "driftsform", "jordbonitet", "kategori", "post",
            "pris", "enhed", "type",
        },
    )

    arbejdssats_rows: list[tuple] = []
    prisliste_rows: list[tuple] = []

    for row_number, row in enumerate(rows, start=2):
        kilde_tabel = row["kilde_tabel"]
        if kilde_tabel == "arbejdssats":
            arbejdssats_rows.append((
                row_number,
                text(row["post"], field="post", row_number=row_number),
                text(
                    row["jordbonitet"], field="jordbonitet", row_number=row_number, required=False,
                ),
                integer(
                    row["afgroedekode"], field="afgroedekode", row_number=row_number,
                    required=False,
                ),
                text(
                    row["driftsform"], field="driftsform", row_number=row_number, required=False,
                ),
                number(row["pris"], field="pris", row_number=row_number),
            ))
        elif kilde_tabel == "prisliste_2026":
            prisliste_rows.append((
                row_number,
                text(row["post"], field="post", row_number=row_number),
                text(row["kategori"], field="kategori", row_number=row_number),
                text(row["type"], field="type", row_number=row_number),
                number(row["pris"], field="pris", row_number=row_number),
                text(row["enhed"], field="enhed", row_number=row_number),
            ))

    return arbejdssats_rows, prisliste_rows


def load_oekonomital_generelle_satser(
    path: Path = CSV_PATH, database_url: str | None = None,
) -> None:
    arbejdssats_rows, prisliste_rows = parse_oekonomital_generelle_satser(path)
    replace_tables(
        [
            (
                "arbejdssats",
                (
                    "source_order", "behandling", "jordbonitet", "afgroedekode", "driftsform",
                    "pris_kr_per_enhed",
                ),
                arbejdssats_rows,
            ),
            (
                "prisliste",
                ("source_order", "post", "kategori", "type", "pris", "enhed"),
                prisliste_rows,
            ),
        ],
        database_url=database_url,
    )
    print(
        f"Loaded {len(arbejdssats_rows):,} work rates and {len(prisliste_rows):,} price-list rows",
        flush=True,
    )


if __name__ == "__main__":
    load_oekonomital_generelle_satser()
