"""Load crop norms, N fixation, and NUAR codes from the wide master CSV.

Source: Afgroedetabel2027_master.csv (one row per afgrødekode), built by
consolidating Afgrødetabel2027, the master workbook's Lang_lookup/
N_fixering_lookup/NUAR_koder sheets, and Bilag_1_tabel_1_med_P_noegle.csv.
Replaces the old xlsx-based loader; the three output tables
(afgroede_norm_lookup, afgroede_nfix_lookup, nuar_kode) are unchanged.
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

# Normgruppe (Kvælstoffiksering-kilden) -> de individuelle jb_nr den dækker.
# Samme grupper som JORDTYPE ovenfor, minus vandet-varianten (normgruppe 3 er
# udgået, ingen data for den i kilden).
NORMGRUPPE_JB_NR: dict[int, tuple[int, ...]] = {
    1: (1, 3),
    2: (2, 4, 10, 12),
    4: (5, 6),
    5: (7, 8, 9),
    6: (11,),
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

        for normgruppe, jb_nrs in NORMGRUPPE_JB_NR.items():
            nfix = _norm_cell(row, f"nfix_normgrp{normgruppe}", row_number=row_number)
            if nfix is None:
                continue
            for jb_nr in jb_nrs:
                nfix_rows.append((source_order, jb_nr, crop_code, "", nfix))
            source_order += 1

    if not norm_rows or not nfix_rows or not nuar_rows:
        raise ValueError("Master CSV must yield norm, N fixation, and NUAR rows")
    if len({row[0] for row in nuar_rows}) != len(nuar_rows):
        raise ValueError("Master CSV contains duplicate AfgroedeKode values")
    return norm_rows, nfix_rows, nuar_rows


def load_afgroede_normer(path: Path = CSV_PATH, database_url: str | None = None) -> None:
    norm_rows, nfix_rows, nuar_rows = parse_afgroede_normer(path)
    replace_tables(
        [
            (
                "afgroede_norm_lookup",
                (
                    "source_order", "jb_nr", "afgroedekode", "afgroede", "jb_gruppe", "vanding",
                    "udbytteenhed", "udbyttenorm", "udbyttenorm_alt", "n_norm", "p_norm",
                    "forfrugtsvaerdi", "indregn_ffv", "driftsform",
                ),
                norm_rows,
            ),
            (
                "afgroede_nfix_lookup",
                ("source_order", "jb_nr", "afgroedekode", "vanding", "nfix_kgn_ha"),
                nfix_rows,
            ),
            (
                "nuar_kode",
                (
                    "afgroedekode", "navn", "m", "w", "wc", "mp", "wp", "m_ambig",
                    "w_ambig", "wc_ambig", "mp_ambig", "wp_ambig", "er_hovedafgrode",
                    "grund6procent",
                ),
                nuar_rows,
            ),
        ],
        database_url=database_url,
    )
    print(
        f"Loaded {len(norm_rows):,} crop-norm rows, {len(nfix_rows):,} N-fixation rows, "
        f"and {len(nuar_rows):,} NUAR codes",
        flush=True,
    )


if __name__ == "__main__":
    load_afgroede_normer()
