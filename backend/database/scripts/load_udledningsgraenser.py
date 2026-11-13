"""Set UdledgrKgNPerHa in the merged GeoPackage to each field's udledningsgrænse
(kg N/ha) as the PUMR 2027 requirements spec (table A, field A78) specifies it:
overlap the field with every cell of the limit map, take the overlap-area-weighted
mean of their Udledgr, and round to 2 decimals. The rounded value is the one the
field's udledningskvote is calculated from (field A24).

Run it whenever the GeoPackage or the limit map is replaced, before
`pixi run load-registry-data`, which loads UdledgrKgNPerHa into
registry_field.udledningsgraense_kgn_ha.

A field that overlaps no cell gets UdledgrKgNPerHa NULL: the spec gives no
fallback value. The registry loader stores NULL as 0, so the field gets no quota.

Sources: Udledningsgraenser_til_Udledningsbaseret_Markregulering_2027.shp (EPSG:25832,
cells of about 1 ha with Udledgr in kg N/ha, one decimal) from landbrugsgeodata.fvm.dk,
workspace Udledningsbaseret_mark_regulering, downloaded 2026-11-13 (the file is dated
2026-11-10; the portal replaces it without changing its name), and the merged
GeoPackage's PlantPerform layer. Foreloebige_udledningsgraenser_... is the preliminary
layer and is not the one to use.
"""

import time
from collections.abc import Callable
from pathlib import Path

import numpy as np
from pyogrio import read_dataframe

from database.scripts.merged_gpkg import (
    LAYER,
    MERGED_GPKG,
    RAW_DIR,
    add_columns,
    area_weighted,
    format_duration,
    overlaps,
    progress_printer,
    write_columns,
)

LIMIT_MAP = (
    RAW_DIR
    / "ANGJ-data"
    / "Udeledningsdata"
    / "UMR_2027"
    / "Udledningsgraenser_til_Udledningsbaseret_Markregulering_2027.shp"
)
LIMIT_COLUMN = "UdledgrKgNPerHa"
# Field A78: the value rounded to 2 decimals is the one the quota is calculated from.
LIMIT_DECIMALS = 2


def area_weighted_limit(
    fields: np.ndarray,
    cell_limits: np.ndarray,
    cell_polygons: np.ndarray,
    *,
    progress: Callable[[int, int], None] | None = None,
) -> np.ndarray:
    """Return each field's overlap-area-weighted mean cell limit, rounded to
    LIMIT_DECIMALS; NaN where the field overlaps no cell."""
    field_index, cell_index, area = overlaps(fields, cell_polygons, progress=progress)
    means = area_weighted(field_index, cell_limits[cell_index], area, len(fields))
    return np.round(means, LIMIT_DECIMALS)


def load_udledningsgraenser(gpkg_path: Path = MERGED_GPKG, map_path: Path = LIMIT_MAP) -> None:
    for path in (gpkg_path, map_path):
        if not path.exists():
            raise FileNotFoundError(f"Expected {path}")

    # A GeoPackage without the column gets an empty one to write into.
    add_columns(gpkg_path, {LIMIT_COLUMN: "REAL"})
    print(f"Reading fields from {gpkg_path.name}...", flush=True)
    fields = read_dataframe(str(gpkg_path), layer=LAYER, columns=[LIMIT_COLUMN], fid_as_index=True)
    print(f"Reading limit cells from {map_path.name}...", flush=True)
    limit_map = read_dataframe(str(map_path), columns=["Udledgr"])
    if limit_map.crs != fields.crs:
        limit_map = limit_map.to_crs(fields.crs)
    limit_map = limit_map[limit_map["Udledgr"].notna()]
    print(f"  {len(fields):,} fields, {len(limit_map):,} limit cells", flush=True)

    start = time.monotonic()
    limit = area_weighted_limit(
        fields.geometry.to_numpy(),
        limit_map["Udledgr"].to_numpy(dtype=np.float64),
        limit_map.geometry.to_numpy(),
        progress=progress_printer("overlaying"),
    )
    previous = fields[LIMIT_COLUMN].to_numpy(dtype=np.float64)
    changed = ~np.isclose(limit, previous, rtol=0, atol=1e-9, equal_nan=True)
    print(
        f"  computed in {format_duration(time.monotonic() - start)}: "
        f"{np.count_nonzero(np.isnan(limit)):,} fields overlap no limit cell and get NULL; "
        f"{np.count_nonzero(changed):,} values change",
        flush=True,
    )

    write_columns(gpkg_path, fields.index.to_numpy(), {LIMIT_COLUMN: limit})
    print(f"Updated {LIMIT_COLUMN} for {len(fields):,} features in {gpkg_path.name}", flush=True)


if __name__ == "__main__":
    load_udledningsgraenser()
