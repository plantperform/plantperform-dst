"""Historisk (2025+2026 gennemsnit) gødningstildeling pr. afgrødekode, region,
JB-nr og driftsform (Bilag 3) — bruges til at genskabe ægte N-input (MNCS/G0)
for marker og rotationspositioner ud fra hvad der faktisk er tildelt
historisk, i stedet for scenariets gødnings-slider (org_mineral_n/
mineralsk_andel_pct).

Loader direkte fra kilde-CSV'en (samme mønster som afgroede_normer's
Excel-opslag) — ikke fra DB-tabellen historisk_goedningsfordeling, som kun
findes for at gøre dataene tilgængelige for andre ad hoc-forespørgsler.
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

# CSV'en har 6 regioner (Øst- og Nordjylland slået sammen); vores 7-delte
# goedningsregion-kolonne på registry_field splitter dem — kollaps ved opslag.
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
    """{"mncs": ..., "g0": ...} for én afgrøde/mark, historisk gennemsnit.

    Falder tilbage til {"mncs": 0.0, "g0": 0.0} (ingen bidrag) når afgrøden,
    JB-nr'et eller regionen ikke findes i opslaget — fx en administrativ
    arealtype uden historisk gødningsdata, eller en mark uden tildelt region.
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
    """{"2025": {"code", "mncs", "mnca", "g0"}, "2026": {...}} — markens egen
    ægte 2025/26-afgrøde og dens historiske N-input, til at seede f1/f2/g1/g2/
    m1/m2 for position 0 (2027) og 1 (2028) af en NY rotationsevaluering, i
    stedet for at ombukke cyklisk til en hypotetisk fremtidig position i
    samme kandidat — se candidate_evaluator.evaluate_sequence_for_mark.
    String-nøgler (ikke int) så det ruller uændret gennem JSON-lagring
    (SimulationFieldCandidates.real_history), samme konvention som
    crop_history selv.
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
