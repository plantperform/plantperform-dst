"""Set Fradragsareal in the merged GeoPackage to each field's fradragsareal (ha):
the part of the field that lies on the areas the PUMR 2027 requirements spec
(table A, field A4) deducts before the udledningskvote is calculated.

The quota-giving area is A69 = A3 (the field's area) - A4 (this deduction) -
A6 (other deductions), and the quota is A24 = A69 x A78 (the field's
udledningsgrænse, set by load_udledningsgraenser.py). `pixi run load-registry-data`
deducts Fradragsareal from the area when it calculates the quota, and keeps the
deduction in registry_field.fradragsareal_ha.

Run it whenever the GeoPackage or one of the layers is replaced, before
`pixi run load-registry-data`.

A4 consists of five layers, polygons in EPSG:25832 from landbrugsgeodata.fvm.dk,
downloaded 2026-11-12 (the portal rewrites them every night, and the files keep their
names): Vandboringer_i_IMK_2026 (circles of about 25 m around the wells),
GLM_Soer_2027, GLM_Fortidsminder_2027, Braemmer_3-metersbraemme_2026 and
Markkrat_2027. They are expected in ANGJ-data/Fradragsarealer/ as shapefiles. The
year in a name is the layer's edition, so change DEDUCTION_LAYERS when a new one is
published. A part of a field that lies on more than one layer counts once. A field
that overlaps none gets 0.

Not deducted: A6 (other deductions), which the sources do not give, and
Fradrag_grundbetaling_2027, which shares no area with the A4 layers and is not part
of A4.
"""

import time
from collections.abc import Callable, Sequence
from pathlib import Path

import numpy as np
import shapely
from pyogrio import read_dataframe

from database.scripts.merged_gpkg import (
    FIELD_CHUNK_SIZE,
    LAYER,
    MERGED_GPKG,
    RAW_DIR,
    add_columns,
    format_duration,
    progress_printer,
    write_columns,
)

DEDUCTION_DIR = RAW_DIR / "ANGJ-data" / "Fradragsarealer"
DEDUCTION_LAYERS = (
    "Vandboringer_i_IMK_2026",
    "GLM_Soer_2027",
    "GLM_Fortidsminder_2027",
    "Braemmer_3-metersbraemme_2026",
    "Markkrat_2027",
)
DEDUCTION_COLUMN = "Fradragsareal"
SQUARE_METRES_PER_HA = 10_000
# Hectares with 4 decimals, that is whole square metres.
DEDUCTION_DECIMALS = 4


def union_area(index: np.ndarray, parts: np.ndarray, size: int) -> np.ndarray:
    """Return, for each of the indices 0..size-1, the area of the union of the
    parts that carry it; 0 for an index without parts. A part given twice, or
    two parts that overlap, count once."""
    part_area = shapely.area(parts)
    kept = part_area > 0
    index, parts, part_area = index[kept], parts[kept], part_area[kept]
    area = np.bincount(index, weights=part_area, minlength=size)
    # The sum is right unless an index has several parts that may overlap.
    several = np.flatnonzero(np.bincount(index, minlength=size) > 1)
    order = np.argsort(index, kind="stable")
    sorted_index, sorted_parts = index[order], parts[order]
    firsts = np.searchsorted(sorted_index, several, side="left")
    lasts = np.searchsorted(sorted_index, several, side="right")
    for position, first, last in zip(several, firsts, lasts, strict=True):
        area[position] = shapely.area(shapely.union_all(sorted_parts[first:last]))
    return area


def deduction_area_ha(
    fields: np.ndarray,
    deduction_polygons: np.ndarray,
    *,
    chunk_size: int = FIELD_CHUNK_SIZE,
    progress: Callable[[int, int], None] | None = None,
) -> np.ndarray:
    """Return, for each field, the area in ha of the field that lies on the
    deduction polygons, rounded to DEDUCTION_DECIMALS. A part on several
    polygons counts once; a field that overlaps none gets 0."""
    tree = shapely.STRtree(deduction_polygons)
    area = np.zeros(len(fields))
    for start in range(0, len(fields), chunk_size):
        chunk = fields[start : start + chunk_size]
        chunk_index, polygon_index = tree.query(chunk, predicate="intersects")
        parts = shapely.intersection(chunk[chunk_index], deduction_polygons[polygon_index])
        area[start : start + len(chunk)] = union_area(chunk_index, parts, len(chunk))
        if progress is not None:
            progress(start + len(chunk), len(fields))
    return np.round(area / SQUARE_METRES_PER_HA, DEDUCTION_DECIMALS)


def read_deduction_polygons(directory: Path, layers: Sequence[str], crs: object) -> np.ndarray:
    """Return the polygons of all the layers in one array, in the given CRS."""
    polygons = []
    for name in layers:
        path = directory / f"{name}.shp"
        if not path.exists():
            raise FileNotFoundError(f"Expected {path}")
        layer = read_dataframe(str(path), columns=[])
        if layer.crs != crs:
            layer = layer.to_crs(crs)
        geometry = layer.geometry[layer.geometry.notna() & ~layer.geometry.is_empty]
        print(f"  {name}: {len(geometry):,} polygons", flush=True)
        polygons.append(geometry.to_numpy())
    return np.concatenate(polygons)


def load_fradragsarealer(
    gpkg_path: Path = MERGED_GPKG,
    deduction_dir: Path = DEDUCTION_DIR,
    layers: Sequence[str] = DEDUCTION_LAYERS,
) -> None:
    if not gpkg_path.exists():
        raise FileNotFoundError(f"Expected {gpkg_path}")

    # A GeoPackage without the column gets an empty one to write into.
    add_columns(gpkg_path, {DEDUCTION_COLUMN: "REAL"})
    print(f"Reading fields from {gpkg_path.name}...", flush=True)
    fields = read_dataframe(
        str(gpkg_path), layer=LAYER, columns=[DEDUCTION_COLUMN], fid_as_index=True
    )
    print(f"Reading deduction layers from {deduction_dir}...", flush=True)
    polygons = read_deduction_polygons(deduction_dir, layers, fields.crs)

    start = time.monotonic()
    deduction = deduction_area_ha(
        fields.geometry.to_numpy(), polygons, progress=progress_printer("overlaying")
    )
    previous = fields[DEDUCTION_COLUMN].to_numpy(dtype=np.float64)
    changed = ~np.isclose(deduction, previous, rtol=0, atol=1e-9, equal_nan=True)
    print(
        f"  computed in {format_duration(time.monotonic() - start)}: "
        f"{np.count_nonzero(deduction):,} of {len(fields):,} fields have a deduction, "
        f"{deduction.sum():,.1f} ha in all; {np.count_nonzero(changed):,} values change",
        flush=True,
    )

    write_columns(gpkg_path, fields.index.to_numpy(), {DEDUCTION_COLUMN: deduction})
    print(
        f"Updated {DEDUCTION_COLUMN} for {len(fields):,} features in {gpkg_path.name}", flush=True
    )


if __name__ == "__main__":
    load_fradragsarealer()
