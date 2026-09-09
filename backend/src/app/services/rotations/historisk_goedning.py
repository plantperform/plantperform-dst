"""Historical average 2025+2026 gødning allocation per afgrødekode, region,
JB-nr, and driftsform (Bilag 3).

It reconstructs actual N inputs (MNCS/G0) for marker and rotation positions from
historical allocations rather than the scenarie's gødning slider
(org_mineral_n/mineralsk_andel_pct). Data loads directly from the source CSV
using the same pattern as afgroede_normer's Excel lookup, not from the
historisk_goedningsfordeling DB table, which exists only to expose the data to
other ad hoc queries.
"""
from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

_CSV_PATH = (
    Path(__file__).resolve().parents[4]
    / "database"
    / "data"
    / "raw"
    / "ANGJ-data"
    / "Historisk_goedningsfordeling_2025_og_2026_bilag3_lookup.csv"
)

# The CSV has six regions (Øst- and Nordjylland combined), while the
# seven-region goedningsregion column on registry_field separates them. Collapse
# them during lookup.
_REGION_ALIASES = {
    "Østjylland": "Øst og Nordjylland",
    "Nordjylland": "Øst og Nordjylland",
}


@lru_cache(maxsize=1)
def _load() -> dict[tuple[str, str, int, int], dict[str, float]]:
    lut: dict[tuple[str, str, int, int], dict[str, float]] = {}
    with _CSV_PATH.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            key = (row["region"], row["driftsform"], int(row["afgroedekode"]), int(row["jb_nr"]))
            entry = lut.setdefault(key, {"mncs": 0.0, "g0": 0.0})
            value = float(row["vaerdi"])
            if row["n_type"] == "mineralsk":
                entry["mncs"] = value
            elif row["n_type"] == "organisk":
                entry["g0"] = value
    return lut


def lookup_historisk_n_input(
    afgrode_kode: int | None,
    jbnr: int | None,
    goedningsregion: str | None,
    oeko: bool,
) -> dict[str, float]:
    """Return historical average {"mncs": ..., "g0": ...} for an afgrøde/mark.

    Falls back to {"mncs": 0.0, "g0": 0.0} (no contribution) when the afgrøde,
    JB-nr, or region is not found, such as an administrative area type without
    historical gødning data or a mark without an assigned region.
    """
    if afgrode_kode is None or jbnr is None or goedningsregion is None:
        return {"mncs": 0.0, "g0": 0.0}

    region = _REGION_ALIASES.get(goedningsregion, goedningsregion)
    driftsform = "Økologisk" if oeko else "Konventionel"
    return dict(_load().get((region, driftsform, afgrode_kode, jbnr), {"mncs": 0.0, "g0": 0.0}))


def real_history_lookback(
    crop_history: dict[str, int | None],
    jbnr: int | None,
    goedningsregion: str | None,
    oeko: bool,
) -> dict[str, dict]:
    """Return the mark's actual 2025/26 afgrøde and historical N inputs.

    The shape is {"2025": {"code", "mncs", "mnca", "g0"}, "2026": {...}}. It
    seeds f1/f2/g1/g2/m1/m2 for positions 0 (2027) and 1 (2028) in a new
    rotation evaluation rather than cycling to a hypothetical future position
    in the same candidate; see candidate_evaluator.evaluate_sequence_for_mark.
    String keys rather than integers pass unchanged through JSON storage in
    SimulationFieldCandidates.real_history, following crop_history's convention.
    """
    result: dict[str, dict] = {}
    for year in (2025, 2026):
        value = crop_history.get(str(year))
        code = int(value) if value is not None else None
        n_input = lookup_historisk_n_input(code, jbnr, goedningsregion, oeko)
        result[str(year)] = {
            "code": code,
            "mncs": n_input["mncs"],
            "mnca": 0.0,
            "g0": n_input["g0"],
        }
    return result
