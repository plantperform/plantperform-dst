"""Atomically load all crop-code constants, norms, and N fixation data."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import psycopg

from database.scripts.load_afgroede_normer import XLSX_PATH, parse_afgroede_normer
from database.scripts.load_afstromningskategorier import CSV_PATH as RUNOFF_PATH
from database.scripts.load_afstromningskategorier import parse_afstromningskategorier
from database.scripts.load_permanente_afgrodekoder import CSV_PATH as PERMANENT_PATH
from database.scripts.load_permanente_afgrodekoder import parse_permanente_afgrodekoder
from database.scripts.runtime_lookup_loader import database_dsn, replace_tables

GPKG_PATH = (
    Path(__file__).resolve().parents[1] / "data" / "raw" / "V1_1_IMK2026_n604144_gpkg_merged.gpkg"
)

AFGROEDE_COLUMNS = (
    "afgroedekode",
    "navn",
    "norm_navn",
    "permanent",
    "has_nuar",
    "m",
    "w",
    "wc",
    "mp",
    "wp",
    "m_ambig",
    "w_ambig",
    "wc_ambig",
    "mp_ambig",
    "wp_ambig",
    "standard_kategori",
    "vinterdaekke_kategori",
    "udbytteenhed",
    "p_norm",
    "forfrugtsvaerdi",
    "indregn_ffv",
)
NORM_COLUMNS = (
    "source_order",
    "jb_nr",
    "afgroedekode",
    "jb_gruppe",
    "vanding",
    "udbyttenorm",
    "udbyttenorm_alt",
    "n_norm",
    "driftsform",
)
NFIX_COLUMNS = ("source_order", "jb_nr", "afgroedekode", "vanding", "nfix_kgn_ha")


def registry_codes(database_url: str | None = None) -> set[int]:
    with psycopg.connect(database_dsn(database_url)) as connection, connection.cursor() as cursor:
        cursor.execute("""
            SELECT DISTINCT value::integer
            FROM registry_field, LATERAL json_each_text(crop_history) AS history(year, value)
            WHERE value ~ '^[0-9]+$' AND value::integer > 0
        """)
        return {code for (code,) in cursor.fetchall()}


def registry_names(path: Path = GPKG_PATH) -> dict[int, str]:
    """Use the longest available registry label for codes absent from references."""
    if not path.exists():
        return {}
    result: dict[int, tuple[int, int, str]] = {}
    with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True)) as connection:
        for year in range(2016, 2027):
            rows = connection.execute(
                f'SELECT DISTINCT "Afg{year}", "Afg{year}txt" FROM "PlantPerform" '
                f'WHERE "Afg{year}" IS NOT NULL AND "Afg{year}txt" IS NOT NULL'
            )
            for raw_code, raw_name in rows:
                try:
                    code = int(raw_code)
                except (TypeError, ValueError):
                    continue
                name = str(raw_name).strip()
                if code <= 0 or not name or name == "0":
                    continue
                candidate = (len(name), year, name)
                if candidate > result.get(code, (0, 0, "")):
                    result[code] = candidate
    return {code: name for code, (_, _, name) in result.items()}


def build_afgroede_rows(
    norm_rows: list[tuple],
    nfix_rows: list[tuple],
    nuar_rows: list[tuple],
    runoff_rows: list[tuple],
    permanent_rows: list[tuple],
    history_codes: set[int],
    history_names: dict[int, str] | None = None,
) -> tuple[list[tuple], list[tuple]]:
    """Merge per-code sources and strip invariant columns from norm rows."""
    crops: dict[int, dict] = {}
    name_priority: dict[int, int] = {}

    def crop(code: int) -> dict:
        if code <= 0:
            raise ValueError(f"Invalid afgroedekode {code}; 0 means no crop")
        return crops.setdefault(
            code,
            {column: None for column in AFGROEDE_COLUMNS}
            | {
                "afgroedekode": code,
                "permanent": False,
                "has_nuar": False,
            },
        )

    def name_for(code: int, name: str | None, priority: int) -> None:
        if name and (code not in name_priority or priority > name_priority[code]):
            crop(code)["navn"] = name
            name_priority[code] = priority

    for code in sorted(history_codes):
        if code <= 0:
            continue
        crop(code)
        name_for(code, (history_names or {}).get(code), 0)

    norm_constants: dict[int, tuple] = {}
    conditional_norm_rows: list[tuple] = []
    for row in norm_rows:
        code = row[2]
        constants = (row[3], row[6], row[10], row[11], row[12])
        if code in norm_constants and norm_constants[code] != constants:
            raise ValueError(f"Nonconstant norm attributes for afgroedekode {code}")
        norm_constants[code] = constants
        conditional_norm_rows.append(tuple(row[index] for index in (0, 1, 2, 4, 5, 7, 8, 9, 13)))
    for code, (norm_name, unit, p_norm, predecessor, include_predecessor) in norm_constants.items():
        entry = crop(code)
        entry.update(
            {
                "norm_navn": norm_name,
                "udbytteenhed": unit,
                "p_norm": p_norm,
                "forfrugtsvaerdi": predecessor,
                "indregn_ffv": include_predecessor,
            }
        )
        name_for(code, norm_name, 1)

    for row in nfix_rows:
        crop(row[2])

    for code, name in permanent_rows:
        crop(code)["permanent"] = True
        name_for(code, name, 2)

    for code, name, standard, winter in runoff_rows:
        crop(code).update(
            {
                "standard_kategori": standard,
                "vinterdaekke_kategori": winter,
            }
        )
        name_for(code, name, 3)

    for row in nuar_rows:
        code = row[0]
        entry = crop(code)
        entry["has_nuar"] = True
        entry.update(
            dict(
                zip(
                    (
                        "m",
                        "w",
                        "wc",
                        "mp",
                        "wp",
                        "m_ambig",
                        "w_ambig",
                        "wc_ambig",
                        "mp_ambig",
                        "wp_ambig",
                    ),
                    row[2:],
                    strict=True,
                )
            )
        )
        name_for(code, row[1], 4)

    afgroede_rows = [
        tuple(crops[code][column] for column in AFGROEDE_COLUMNS) for code in sorted(crops)
    ]
    return afgroede_rows, conditional_norm_rows


def load_afgroeder(
    workbook_path: Path = XLSX_PATH,
    runoff_path: Path = RUNOFF_PATH,
    permanent_path: Path = PERMANENT_PATH,
    gpkg_path: Path = GPKG_PATH,
    database_url: str | None = None,
) -> None:
    norm_rows, nfix_rows, nuar_rows = parse_afgroede_normer(workbook_path)
    runoff_rows = parse_afstromningskategorier(runoff_path)
    permanent_rows = parse_permanente_afgrodekoder(permanent_path)
    history_names = registry_names(gpkg_path)
    history_codes = registry_codes(database_url)
    afgroede_rows, conditional_norm_rows = build_afgroede_rows(
        norm_rows,
        nfix_rows,
        nuar_rows,
        runoff_rows,
        permanent_rows,
        history_codes,
        history_names,
    )
    replace_tables(
        [
            ("afgroede", AFGROEDE_COLUMNS, afgroede_rows),
            ("afgroede_norm_lookup", NORM_COLUMNS, conditional_norm_rows),
            ("afgroede_nfix_lookup", NFIX_COLUMNS, nfix_rows),
        ],
        database_url=database_url,
    )
    print(
        f"Loaded {len(afgroede_rows):,} afgrøder, {len(conditional_norm_rows):,} "
        f"crop-norm rows, and {len(nfix_rows):,} N-fixation rows",
        flush=True,
    )


if __name__ == "__main__":
    load_afgroeder()
