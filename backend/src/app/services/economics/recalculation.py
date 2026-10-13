"""Reprice existing evaluations without changing rotations or agronomic outputs."""

from app.domain.rotation_candidate import RotationCandidateEvaluation
from app.services.economics.db_calculator import calculate_db


def recalculate_candidate(candidate, simulation, snapshot, jbnr):
    candidate = candidate.model_copy(deep=True)
    for year in candidate.years:
        if year.year.afgrode_kode <= 0:
            continue
        inputs = year.db_detail.get("calculation_inputs")
        if inputs is None:
            # Legacy evaluations retained the N allocation and original context.
            detail = year.db_detail
            physical = year.leaching_detail
            inputs = dict(
                afgrodekode=year.year.afgrode_kode,
                driftsform=detail.get("driftsform", simulation.godning.driftsform),
                jbnr=detail.get("jbnr", jbnr),
                mncs=detail.get(
                    "mncs",
                    year.tildelt_handelsgodning_kgn_ha + year.tildelt_husdyrgodning_udnyttet_kgn_ha,
                ),
                mnca=physical.get("mnca", physical.get("MNCA", 0.0)),
                irrigated=physical.get("irrigated", False),
                org_mineral_n_applied=year.tildelt_husdyrgodning_udnyttet_kgn_ha,
                udlaeg_kode=year.year.udlaeg_kode,
                only_organic=(
                    detail.get("driftsform") == "Økologisk"
                    if candidate.ref.saedskiftevariant == "permanent"
                    else simulation.godning.only_organic
                ),
                kvalitet=detail.get("kvalitet", ""),
                praecisionsjordbrug=simulation.praecisionsjordbrug,
                forfrugtsvaerdi=year.forfrugtsvaerdi_kgn_ha,
            )
        year.db_detail = calculate_db(**inputs, economics_key=snapshot.overrides.cache_key())
        year.db_kr_ha = year.db_detail["db"]
    cycle = candidate.years[: candidate.active_len]
    if not cycle:
        raise ValueError("Cannot recalculate an empty rotation")
    candidate.avg_db_kr_ha = sum(y.db_kr_ha for y in cycle) / len(cycle)
    candidate.avg_fen = sum(y.fen_fe_ha for y in cycle) / len(cycle)
    return candidate


def recalculate_document(value, simulation, snapshot, jbnr):
    return recalculate_candidate(
        RotationCandidateEvaluation.model_validate(value), simulation, snapshot, jbnr
    ).model_dump(mode="json")
