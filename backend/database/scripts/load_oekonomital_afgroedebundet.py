"""Load salgspris, halmudbytte, arbejdsmaengde and dyrkningsomkostning from
the consolidated, afgrødekode-bundne økonomi-CSV.

Splits rows by the CSV's own "kilde_tabel" column and writes each group to
its original table, unchanged from the six old per-file loaders this
replaces (Salgspriser_afgroedekoder.csv, Halmudbytte_afgroedekoder.csv,
Arbejdsmaengder_afgroedekoder.csv, Dyrkningsomkostninger_afgroedekoder.csv).
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

CSV_PATH = source_path("Oekonomital_afgroedebundet.csv")


def parse_oekonomital_afgroedebundet(
    path: Path = CSV_PATH,
) -> tuple[list[tuple], list[tuple], list[tuple], list[tuple]]:
    rows = read_csv_rows(
        path,
        delimiter=",",
        required_columns={
            "kilde_tabel", "afgroedekode", "driftsform", "jordbonitet", "kvalitet",
            "kategori", "behandling", "antal", "enhed", "beloeb", "beloeb_type",
        },
    )

    arbejdsmaengde_rows: list[tuple] = []
    dyrkningsomkostning_rows: list[tuple] = []
    halmudbytte_rows: list[tuple] = []
    salgspris_by_key: dict[tuple[int, str, str], dict] = {}

    for row_number, row in enumerate(rows, start=2):
        kilde_tabel = row["kilde_tabel"]
        afgroedekode = integer(
            row["afgroedekode"], field="afgroedekode", row_number=row_number,
        )
        driftsform = text(
            row["driftsform"], field="driftsform", row_number=row_number, required=False,
        )

        if kilde_tabel == "arbejdsmaengde":
            arbejdsmaengde_rows.append((
                row_number, afgroedekode, driftsform,
                text(row["jordbonitet"], field="jordbonitet", row_number=row_number),
                text(row["kvalitet"], field="kvalitet", row_number=row_number, required=False),
                text(row["kategori"], field="kategori", row_number=row_number),
                text(row["behandling"], field="behandling", row_number=row_number),
                number(row["antal"], field="antal", row_number=row_number),
            ))
        elif kilde_tabel == "dyrkningsomkostning":
            dyrkningsomkostning_rows.append((
                row_number, afgroedekode, driftsform,
                text(row["kategori"], field="kategori", row_number=row_number),
                text(row["behandling"], field="behandling", row_number=row_number),
                number(row["beloeb"], field="beloeb", row_number=row_number),
            ))
        elif kilde_tabel == "halmudbytte":
            halmudbytte_rows.append((
                row_number, afgroedekode,
                text(row["jordbonitet"], field="jordbonitet", row_number=row_number),
                number(row["antal"], field="antal", row_number=row_number),
            ))
        elif kilde_tabel == "salgspris":
            kvalitet = text(
                row["kvalitet"], field="kvalitet", row_number=row_number, required=False,
            )
            key = (afgroedekode, driftsform, kvalitet)
            entry = salgspris_by_key.setdefault(
                key,
                {"row_number": row_number, "enhed": "", "salgspris": 0.0, "halm_pris_kr_kg": 0.0},
            )
            beloeb = (
                number(row["beloeb"], field="beloeb", row_number=row_number, required=False)
                or 0.0
            )
            if row["beloeb_type"] == "salgspris":
                entry["salgspris"] = beloeb
                entry["enhed"] = text(
                    row["enhed"], field="enhed", row_number=row_number, required=False,
                )
            elif row["beloeb_type"] == "halm_pris_kr_kg":
                entry["halm_pris_kr_kg"] = beloeb

    salgspris_rows = [
        (
            entry["row_number"], afgroedekode, driftsform, kvalitet,
            entry["salgspris"], entry["enhed"], entry["halm_pris_kr_kg"],
        )
        for (afgroedekode, driftsform, kvalitet), entry in salgspris_by_key.items()
    ]

    return arbejdsmaengde_rows, dyrkningsomkostning_rows, halmudbytte_rows, salgspris_rows


def load_oekonomital_afgroedebundet(
    path: Path = CSV_PATH, database_url: str | None = None,
) -> None:
    arbejdsmaengde_rows, dyrkningsomkostning_rows, halmudbytte_rows, salgspris_rows = (
        parse_oekonomital_afgroedebundet(path)
    )
    replace_tables(
        [
            (
                "arbejdsmaengde",
                (
                    "source_order", "afgroedekode", "driftsform", "jordbonitet", "kvalitet",
                    "kategori", "behandling", "antal",
                ),
                arbejdsmaengde_rows,
            ),
            (
                "dyrkningsomkostning",
                (
                    "source_order", "afgroedekode", "driftsform", "kategori", "behandling",
                    "udgift_kr_ha",
                ),
                dyrkningsomkostning_rows,
            ),
            (
                "halmudbytte",
                ("source_order", "afgroedekode", "jordbonitet", "halm_udbytte_kg_ha"),
                halmudbytte_rows,
            ),
            (
                "salgspris",
                (
                    "source_order", "afgroedekode", "driftsform", "kvalitet", "salgspris",
                    "enhed", "halm_pris_kr_kg",
                ),
                salgspris_rows,
            ),
        ],
        database_url=database_url,
    )
    print(
        f"Loaded {len(arbejdsmaengde_rows):,} work quantities, "
        f"{len(dyrkningsomkostning_rows):,} fixed cultivation costs, "
        f"{len(halmudbytte_rows):,} straw yields, and {len(salgspris_rows):,} sales prices",
        flush=True,
    )


if __name__ == "__main__":
    load_oekonomital_afgroedebundet()
