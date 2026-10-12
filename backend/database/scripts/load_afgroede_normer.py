"""Parse crop norms, N fixation, and NUAR codes from the wide master CSV.

The consolidated load_afgroeder entry point writes all crop reference values
together into afgroede, afgroede_norm_lookup, and afgroede_nfix_lookup.
"""

from __future__ import annotations

from pathlib import Path

from database.scripts.runtime_lookup_loader import (
    integer,
    number,
    read_csv_rows,
    source_path,
    text,
)

CSV_PATH = source_path("Afgroedetabel2027_master.csv")
KONVENTIONEL = "Konventionel"
OEKOLOGISK = "Økologisk"

# Jordtype-gruppe (master-CSV kolonnenavn) -> de individuelle jb_nr den dækker
# og den vanding-værdi Lang_lookup brugte for samme gruppe.
JORDTYPE: dict[str, tuple[tuple[int, ...], str]] = {
    "grovsand": ((1, 3), "Uvandet"),
    "finsand": ((2, 4, 10, 12), "Uvandet"),
    "sandjord_vandet": ((1, 2, 3, 4), "Vandet"),
    "sandblandet_ler": ((5, 6), "Ikke særskilt vanding"),
    "lerjord": ((7, 8, 9), "Ikke særskilt vanding"),
    "humusjord": ((11,), "Ikke særskilt vanding"),
}
JORDTYPE_NAVN = {
    "grovsand": "JB 1 + 3",
    "finsand": "JB 2 + 4 og 10 + 12",
    "sandjord_vandet": "JB 1 - 4",
    "sandblandet_ler": "JB 5 - 6",
    "lerjord": "JB 7 - 9",
    "humusjord": "JB 11",
}
DRIFTSFORM_SUFFIX = {"konventionel": KONVENTIONEL, "okologisk": OEKOLOGISK}

# Normgruppe (Bilag 5, tabel 1) -> de individuelle jb_nr den dækker og deres
# vanding. Samme grupper og vanding-værdier som JORDTYPE ovenfor; normgruppe 3
# er vandet sandjord. lookup_nfix finder kun rækker med en af disse værdier.
NORMGRUPPE: dict[int, tuple[tuple[int, ...], str]] = {
    1: ((1, 3), "Uvandet"),
    2: ((2, 4, 10, 12), "Uvandet"),
    3: ((1, 2, 3, 4), "Vandet"),
    4: ((5, 6), "Ikke særskilt vanding"),
    5: ((7, 8, 9), "Ikke særskilt vanding"),
    6: ((11,), "Ikke særskilt vanding"),
}


def _norm_cell(row: dict[str, str], key: str, *, row_number: int) -> float | None:
    """Parse a wide norm-column cell, tolerating the odd stray text note.

    A handful of administrative codes (e.g. 499 "Lukket system") carry an
    explanatory note instead of a number in Lang_lookup; treat those cells
    as missing data rather than aborting the whole load.
    """
    try:
        return number(row.get(key, ""), field=key, row_number=row_number, required=False)
    except ValueError:
        return None


def parse_afgroede_normer(path: Path = CSV_PATH) -> tuple[list[tuple], list[tuple], list[tuple]]:
    """Parse the master CSV into the three table row-sets before DB writes."""
    rows = read_csv_rows(
        path,
        delimiter=",",
        required_columns={
            "AfgroedeKode", "Navn", "nuar_m", "nuar_w", "nuar_wc", "nuar_mp", "nuar_wp",
            "udbytteenhed", "indregn_ffv", "Hovedafgrøde", "Grund6Procent",
        },
    )

    norm_rows: list[tuple] = []
    nfix_rows: list[tuple] = []
    nuar_rows: list[tuple] = []
    source_order = 1

    for row_number, row in enumerate(rows, start=2):
        crop_code = integer(row["AfgroedeKode"], field="AfgroedeKode", row_number=row_number)
        navn = text(row["Navn"], field="Navn", row_number=row_number)

        er_hovedafgrode = (
            integer(
                row["Hovedafgrøde"], field="Hovedafgrøde", row_number=row_number,
            )
            == 1
        )
        grund6procent = (
            integer(
                row["Grund6Procent"], field="Grund6Procent", row_number=row_number,
            )
            == 1
        )
        nuar_rows.append(
            (
                crop_code,
                navn,
                integer(row["nuar_m"], field="nuar_m", row_number=row_number, required=False),
                integer(row["nuar_w"], field="nuar_w", row_number=row_number, required=False),
                integer(row["nuar_wc"], field="nuar_wc", row_number=row_number, required=False),
                integer(row["nuar_mp"], field="nuar_mp", row_number=row_number, required=False),
                integer(row["nuar_wp"], field="nuar_wp", row_number=row_number, required=False),
                False, False, False, False, False,  # *_ambig: unused by any consumer today
                er_hovedafgrode,
                grund6procent,
                *(
                    integer(
                        row.get(column, ""), field=column, row_number=row_number, required=False,
                    )
                    for column in (
                        "nuar_w_undtagelse",
                        "nuar_w_undtagelse_efter_graes",
                        "nuar_w_omploejning",
                    )
                ),
            )
        )

        udbytteenhed = text(
            row["udbytteenhed"], field="udbytteenhed", row_number=row_number, required=False,
        )
        indregn_ffv = (
            text(
                row["indregn_ffv"], field="indregn_ffv", row_number=row_number, required=False,
            ).lower()
            == "ja"
        )

        for jordtype, (jb_nrs, vanding) in JORDTYPE.items():
            for suffix, driftsform in DRIFTSFORM_SUFFIX.items():
                udbyttenorm = _norm_cell(
                    row, f"udbyttenorm_{jordtype}_{suffix}", row_number=row_number,
                )
                n_norm = _norm_cell(row, f"n_norm_{jordtype}_{suffix}", row_number=row_number)
                if udbyttenorm is None and n_norm is None:
                    continue  # ingen normdata for denne jordtype/driftsform-kombination
                p_norm = _norm_cell(row, f"p_norm_{jordtype}_{suffix}", row_number=row_number)
                forfrugtsvaerdi = _norm_cell(
                    row, f"forfrugtsvaerdi_{jordtype}_{suffix}", row_number=row_number,
                ) or 0.0
                common = (
                    crop_code, navn, JORDTYPE_NAVN[jordtype], vanding, udbytteenhed,
                    udbyttenorm, None, n_norm, p_norm, forfrugtsvaerdi, indregn_ffv, driftsform,
                )
                for jb_nr in jb_nrs:
                    norm_rows.append((source_order, jb_nr, *common))
                source_order += 1

        for normgruppe, (jb_nrs, vanding) in NORMGRUPPE.items():
            nfix = _norm_cell(row, f"nfix_normgrp{normgruppe}", row_number=row_number)
            if nfix is None:
                continue
            for jb_nr in jb_nrs:
                nfix_rows.append((source_order, jb_nr, crop_code, vanding, nfix))
            source_order += 1

    if not norm_rows or not nfix_rows or not nuar_rows:
        raise ValueError("Master CSV must yield norm, N fixation, and NUAR rows")
    if len({row[0] for row in nuar_rows}) != len(nuar_rows):
        raise ValueError("Master CSV contains duplicate AfgroedeKode values")
    return norm_rows, nfix_rows, nuar_rows


def load_afgroede_normer(path: Path = CSV_PATH, database_url: str | None = None) -> None:
    """Compatibility entry point; crop-code sources now reload together."""
    from database.scripts.load_afgroeder import load_afgroeder

    load_afgroeder(master_path=path, database_url=database_url)


if __name__ == "__main__":
    load_afgroede_normer()
