"""Set RetTot in the merged GeoPackage to each field's retention (%) as the
PUMR 2027 requirements spec (table A, field A22) and the draft 2027 executive
order (§ 13(3)) specify it: overlap the field with every polygon of the
retention map, take the overlap-area-weighted mean of their RetTot, and round
to 2 decimals. The rounded value is the one the N load calculation uses.

Run it whenever the GeoPackage or the retention map is replaced, before
`pixi run load-registry-data`, which loads RetTot into registry_field.retention.

A field that overlaps no retention polygon gets RetTot NULL: the spec gives no
fallback value.

Sources: Kvaelstofretention_UMR_2027.shp (EPSG:25832, polygons with RetTot in
percent) and the merged GeoPackage's PlantPerform layer.
"""

import time
from pathlib import Path

import numpy as np
from pyogrio import read_dataframe

from database.scripts.merged_gpkg import (
    LAYER,
    MERGED_GPKG,
    RAW_DIR,
    area_weighted,
    format_duration,
    overlaps,
    write_columns,
)

RETENTION_MAP = (
    RAW_DIR / "ANGJ-data" / "Udeledningsdata" / "UMR_2027" / "Kvaelstofretention_UMR_2027.shp"
)
# Field A22: the value rounded to 2 decimals is the one the calculation uses.
RETENTION_DECIMALS = 2


def area_weighted_retention(
    fields: np.ndarray, map_values: np.ndarray, map_polygons: np.ndarray
) -> np.ndarray:
    """Return each field's overlap-area-weighted mean map value, rounded to
    RETENTION_DECIMALS; NaN where the field overlaps no map polygon."""
    field_index, map_index, area = overlaps(fields, map_polygons)
    means = area_weighted(field_index, map_values[map_index], area, len(fields))
    return np.round(means, RETENTION_DECIMALS)


def load_retentionskort(gpkg_path: Path = MERGED_GPKG, map_path: Path = RETENTION_MAP) -> None:
    for path in (gpkg_path, map_path):
        if not path.exists():
            raise FileNotFoundError(f"Expected {path}")

    print(f"Reading fields from {gpkg_path.name}...", flush=True)
    fields = read_dataframe(str(gpkg_path), layer=LAYER, columns=["RetTot"], fid_as_index=True)
    print(f"Reading retention polygons from {map_path.name}...", flush=True)
    retention_map = read_dataframe(str(map_path), columns=["RetTot"]).to_crs(fields.crs)
    retention_map = retention_map[retention_map["RetTot"].notna()]
    print(f"  {len(fields):,} fields, {len(retention_map):,} retention polygons", flush=True)

    start = time.monotonic()
    retention = area_weighted_retention(
        fields.geometry.to_numpy(),
        retention_map["RetTot"].to_numpy(dtype=np.float64),
        retention_map.geometry.to_numpy(),
    )
    previous = fields["RetTot"].to_numpy(dtype=np.float64)
    changed = ~np.isclose(retention, previous, rtol=0, atol=1e-9, equal_nan=True)
    print(
        f"  computed in {format_duration(time.monotonic() - start)}: "
        f"{np.count_nonzero(np.isnan(retention)):,} fields overlap no retention polygon "
        f"and get NULL; {np.count_nonzero(changed):,} values change",
        flush=True,
    )

    write_columns(gpkg_path, fields.index.to_numpy(), {"RetTot": retention})
    print(f"Updated RetTot for {len(fields):,} features in {gpkg_path.name}", flush=True)


if __name__ == "__main__":
    load_retentionskort()
