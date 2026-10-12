"""Set the merged GeoPackage's per-field NLES5 soil inputs as the draft 2027
executive order on discharge-based field regulation (bekendtgørelse om
udledningsbaseret markregulering) specifies them:

- orgNtopsoil2024 (NT): the value of the map of organic N in the topsoil that
  covers the largest part of the field (§ 29(6)).
- The eight P columns: per runoff category, the percolation value that covers
  the largest part of the field (§ 32(3)).
- S_soil2024 (S): exp(-0.001849 · clay percentage) (Bilag 2, equation 7), with
  the clay percentage of the field's soil type JB_Kode from Bilag 2, table 14
  (§ 34(4)).

Both maps mark the areas without data with 0, on the same polygons: N
category "0" and all eight P values 0. Those areas count as having no value,
so a field partly in them takes its value from the rest of the field, and a
field entirely in them gets NULL, which load_registry_from_merged_gpkg marks
as banned. A tie for the largest part goes to the higher value, as the PUMR
requirements spec does for Klimagrid.

Run it whenever the GeoPackage or the maps are replaced, before
`pixi run load-registry-data`.

Sources: Organisk kvaelstof i overjorden 2027.shp (N_vaerdi) and
Afstroemningsvaerdier 2027.shp (EPSG:25832), and the merged GeoPackage's
PlantPerform layer.
"""

import time
from pathlib import Path

import numpy as np
from pyogrio import read_dataframe

from app.services.nles5.engine import S_func
from database.scripts.merged_gpkg import (
    LAYER,
    MERGED_GPKG,
    RAW_DIR,
    dominant,
    format_duration,
    overlaps,
    write_columns,
)

MAP_DIR = RAW_DIR / "ANGJ-data" / "Udeledningsdata" / "UMR_2027"
N_MAP = MAP_DIR / "Organisk kvaelstof i overjorden 2027.shp"
P_MAP = MAP_DIR / "Afstroemningsvaerdier 2027.shp"
N_COLUMN = "orgNtopsoil2024"
S_COLUMN = "S_soil2024"
# Map column -> GeoPackage column, in runoff category order 1-8. The map's
# names are cut at the shapefile limit of 10 characters.
P_COLUMNS = {
    "P_vaarbygu": "P_vaarbygudl",
    "P_graes": "P_graes",
    "P_vaarbyg": "P_vaarbyg",
    "P_vhvede": "p_Vhvede",
    "P_vraps": "p_Vraps",
    "P_majs": "P_majs",
    "P_kart": "P_kart",
    "P_roer": "P_roer",
}
# Bilag 2, table 14: the set clay percentage per JB number.
CLAY_PCT_BY_JB = {1: 5, 2: 5, 3: 6, 4: 7, 5: 12, 6: 12, 7: 17, 8: 27, 11: 9, 12: 9}


def dominant_values(
    fields: np.ndarray, map_values: dict[str, np.ndarray], map_polygons: np.ndarray
) -> dict[str, np.ndarray]:
    """Return, per map column, each field's value covering the largest part
    of it. A value of 0 marks an area without data and counts as no value."""
    field_index, map_index, area = overlaps(fields, map_polygons)
    return {
        column: dominant(
            field_index, np.where(values == 0, np.nan, values)[map_index], area, len(fields)
        )
        for column, values in map_values.items()
    }


def soil_effect(jb_codes: np.ndarray) -> np.ndarray:
    """Return S for each field's soil type. The GeoPackage stores JB_Kode as
    REAL; 4.0 finds the table's 4 like 4 does."""
    unknown = sorted({code for code in jb_codes if code not in CLAY_PCT_BY_JB}, key=str)
    if unknown:
        raise ValueError(f"No clay percentage in Bilag 2, table 14 for JB_Kode {unknown}")
    return np.array([S_func(CLAY_PCT_BY_JB[code]) for code in jb_codes])


def read_map(
    path: Path, columns: list[str], crs: object
) -> tuple[dict[str, np.ndarray], np.ndarray]:
    frame = read_dataframe(str(path), columns=columns).to_crs(crs)
    # Polygons without data in any column cannot win anywhere; skip their overlaps.
    frame = frame[(frame[columns] != 0).any(axis=1)]
    values = {column: frame[column].to_numpy(dtype=np.float64) for column in columns}
    return values, frame.geometry.to_numpy()


def report(name: str, new: np.ndarray, previous: np.ndarray) -> None:
    changed = ~np.isclose(new, previous, rtol=0, atol=1e-9, equal_nan=True)
    print(
        f"  {name:<16} NULL {np.count_nonzero(np.isnan(new)):>6,}, "
        f"changed {np.count_nonzero(changed):>7,}, "
        f"mean {np.nanmean(previous):.4f} -> {np.nanmean(new):.4f}",
        flush=True,
    )


def load_nles5_soil_inputs(
    gpkg_path: Path = MERGED_GPKG, n_map_path: Path = N_MAP, p_map_path: Path = P_MAP
) -> None:
    for path in (gpkg_path, n_map_path, p_map_path):
        if not path.exists():
            raise FileNotFoundError(f"Expected {path}")

    print(f"Reading fields from {gpkg_path.name}...", flush=True)
    columns = ["JB_Kode", N_COLUMN, *P_COLUMNS.values(), S_COLUMN]
    fields = read_dataframe(str(gpkg_path), layer=LAYER, columns=columns, fid_as_index=True)
    geometries = fields.geometry.to_numpy()

    start = time.monotonic()
    print(f"Overlapping {len(fields):,} fields with {n_map_path.name}...", flush=True)
    n_values, n_polygons = read_map(n_map_path, ["N_vaerdi"], fields.crs)
    updates = {N_COLUMN: dominant_values(geometries, n_values, n_polygons)["N_vaerdi"]}

    print(f"Overlapping {len(fields):,} fields with {p_map_path.name}...", flush=True)
    p_values, p_polygons = read_map(p_map_path, list(P_COLUMNS), fields.crs)
    for column, values in dominant_values(geometries, p_values, p_polygons).items():
        updates[P_COLUMNS[column]] = values

    updates[S_COLUMN] = soil_effect(fields["JB_Kode"].to_numpy())
    print(f"  computed in {format_duration(time.monotonic() - start)}:", flush=True)
    for column, values in updates.items():
        report(column, values, fields[column].to_numpy(dtype=np.float64))
    banned = np.any([np.isnan(values) for values in updates.values()], axis=0)
    print(f"  fields with a NULL input, banned on load: {np.count_nonzero(banned):,}", flush=True)

    write_columns(gpkg_path, fields.index.to_numpy(), updates)
    print(f"Updated {len(updates)} columns for {len(fields):,} features in {gpkg_path.name}")


if __name__ == "__main__":
    load_nles5_soil_inputs()
