"""Set RetTot in the merged GeoPackage to each field's retention (%) as the
PUMR 2027 requirements spec (table A, field A22) and the draft 2027 executive
order (§ 13(3)) specify it: overlap the field with every polygon of the
retention map, take the overlap-area-weighted mean of their retention, and round
to 2 decimals. The rounded value is the one the N load calculation uses.

Run it whenever the GeoPackage or the retention map is replaced, before
`pixi run load-registry-data`, which loads RetTot into registry_field.retention.

A field that overlaps no retention polygon gets RetTot NULL: the spec gives no
fallback value.

Source: the MiljøGIS layer vandprojekter:kvaelstofretention, 4,239,419 polygons
(MultiPolygon, EPSG:25832) downloaded on 2026-11-19 from the WFS 2.0 service
https://wfs2-miljoegis.mim.dk/vandprojekter/ows (GeoServer, no login; GetFeature with
outputFormat=application/json, 50,000 features per call with startIndex), and kept as
a GeoPackage with a spatial index in
ANGJ-data/Udeledningsdata/MiljoeGIS_kvaelstofretention/kvaelstofretention.gpkg. The
layer has one attribute, `ret_tot`, a FRACTION with 8 decimals (0.59965177), not a
percentage, so it is multiplied by 100 here and RetTot stays in percent. The download
also stores the WFS feature id (kvaelstofretention.<n>) as `wfs_id`; it is not read.
The service rewrites the layer without notice, so note the download date here when
the file is replaced.

Why this layer and not Kvaelstofretention_UMR_2027.shp from landbrugsgeodata.fvm.dk,
which this script read before: that shapefile only has coarse values such as 60 and
72.9, and SGAV's Markplan (build pumr2027-20261015.1-development, CVR 32614264) shows
retention that matches the MiljøGIS layer, within 0.01 on nine fields of that farm.

The map has so many polygons that a spatial index over all of them does not fit in
memory comfortably. The fields are therefore split into groups that lie close
together, and each group reads only the map polygons inside its bounding box from
the GeoPackage's own spatial index.
"""

import math
import time
from pathlib import Path

import numpy as np
import pyproj
import shapely
from pyogrio import read_dataframe, read_info

from database.scripts.merged_gpkg import (
    FIELD_CHUNK_SIZE,
    LAYER,
    MERGED_GPKG,
    RAW_DIR,
    area_weighted,
    format_duration,
    overlaps,
    write_columns,
)

RETENTION_MAP = (
    RAW_DIR
    / "ANGJ-data"
    / "Udeledningsdata"
    / "MiljoeGIS_kvaelstofretention"
    / "kvaelstofretention.gpkg"
)
# The map's retention is a fraction (0.59965177); RetTot is in percent.
RETENTION_COLUMN = "ret_tot"
PERCENT_PER_FRACTION = 100
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


def spatial_groups(fields: np.ndarray, size: int) -> list[np.ndarray]:
    """Return the indices of the fields in groups of at most `size`, with the
    fields of a group close together: the fields are cut into vertical strips by
    their centre's x, and each strip into groups by y. A group's bounding box
    then covers a compact part of the country, not a thin line across it."""
    if len(fields) == 0:
        return []
    boxes = shapely.bounds(fields)
    x = (boxes[:, 0] + boxes[:, 2]) / 2
    y = (boxes[:, 1] + boxes[:, 3]) / 2
    group_count = math.ceil(len(fields) / size)
    strip_count = math.ceil(math.sqrt(group_count))
    strip_size = size * math.ceil(group_count / strip_count)
    by_x = np.argsort(x, kind="stable")
    groups = []
    for first in range(0, len(fields), strip_size):
        strip = by_x[first : first + strip_size]
        strip = strip[np.argsort(y[strip], kind="stable")]
        groups.extend(strip[start : start + size] for start in range(0, len(strip), size))
    return groups


def load_retentionskort(
    gpkg_path: Path = MERGED_GPKG,
    map_path: Path = RETENTION_MAP,
    group_size: int = FIELD_CHUNK_SIZE,
) -> None:
    for path in (gpkg_path, map_path):
        if not path.exists():
            raise FileNotFoundError(f"Expected {path}")

    print(f"Reading fields from {gpkg_path.name}...", flush=True)
    fields = read_dataframe(str(gpkg_path), layer=LAYER, columns=["RetTot"], fid_as_index=True)
    map_info = read_info(str(map_path))
    if RETENTION_COLUMN not in map_info["fields"]:
        raise ValueError(f"Expected the column {RETENTION_COLUMN} in {map_path.name}")
    # The groups read the map by bounding box, which is in the map's own CRS.
    if pyproj.CRS(map_info["crs"]) != fields.crs:
        raise ValueError(f"Expected {map_path.name} in {fields.crs.to_string()}")
    print(
        f"  {len(fields):,} fields; the retention map {map_path.name} has "
        f"{map_info['features']:,} polygons",
        flush=True,
    )

    geometries = fields.geometry.to_numpy()
    groups = spatial_groups(geometries, group_size)
    retention = np.full(len(fields), np.nan)
    start = time.monotonic()
    for number, group in enumerate(groups, 1):
        bounds = shapely.total_bounds(geometries[group])
        if np.isnan(bounds).any():
            continue  # only empty geometries: nothing to overlap
        retention_map = read_dataframe(
            str(map_path), columns=[RETENTION_COLUMN], bbox=tuple(bounds)
        )
        retention_map = retention_map[retention_map[RETENTION_COLUMN].notna()]
        retention[group] = area_weighted_retention(
            geometries[group],
            retention_map[RETENTION_COLUMN].to_numpy(dtype=np.float64) * PERCENT_PER_FRACTION,
            retention_map.geometry.to_numpy(),
        )
        print(
            f"  group {number} / {len(groups)}: {len(group):,} fields, "
            f"{len(retention_map):,} polygons, {format_duration(time.monotonic() - start)}",
            flush=True,
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
