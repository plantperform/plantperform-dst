"""Manual rotation editing and summaries shared by the API and optimizer."""

from dataclasses import dataclass

from app.data import repository
from app.domain.field import FieldRecord, UpdateFieldRequest
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    RotationPositionOverride,
)
from app.services.scenario import candidate_evaluator


@dataclass(frozen=True)
class YearlySummaryEntry:
    year: int
    total_n_load_kg: float
    total_db2: float
    total_fen: float
    field_count: int


def selected_locked_candidate(
    field: FieldRecord,
    candidates: list[RotationCandidateEvaluation],
) -> RotationCandidateEvaluation | None:
    allowed = set(field.allowed_rotation_ids)
    if field.rotation_id in allowed:
        return next((c for c in candidates if c.ref.to_id() == field.rotation_id), None)
    return next((c for c in candidates if c.ref.to_id() in allowed), None)


class ManualRotationNotFoundError(Exception):
    """The simulering, mark, or its stored candidate set (jbnr source) is missing."""


def apply_manual_rotation(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    base_ref: RotationCandidateRef,
    overrides: list[RotationPositionOverride],
    email: str,
    start_year: int = 1,
) -> FieldRecord | None:
    """Apply a Phase 10 "Rediger manuelt" adjustment to a mark's rotation.

    Recalculate from base_ref plus any single-position overrides, store the
    result as an additional replaceable candidate on the mark, and write it
    back exactly as "Optimér" would, with the same area/retention scaling as
    _build_options. Lock the mark to this choice through allowed_rotation_ids
    so a later "Optimér" run cannot overwrite the manual adjustment until the
    user unlocks it.
    """
    simulation = repository.get_simulation(farm_id, simulation_id, email)
    field = repository.get_simulation_field(farm_id, simulation_id, field_id, email)
    if simulation is None or field is None:
        raise ManualRotationNotFoundError

    candidates_row = repository.get_simulation_field_candidates(
        farm_id,
        simulation_id,
        field_id,
        email,
    )
    if candidates_row is None:
        raise ManualRotationNotFoundError

    godning = simulation.godning
    soil_data = repository.get_registry_soil_data(field.imk_id)
    percolation, org_n_topsoil, s_soil = soil_data if soil_data is not None else (None, None, None)
    candidate = candidate_evaluator.evaluate_with_overrides(
        base_ref,
        overrides,
        jbnr=candidates_row.jbnr,
        driftsform=godning.driftsform,
        org_mineral_n=godning.org_mineral_n,
        mineralsk_andel_pct=godning.mineralsk_andel_pct,
        only_organic=godning.only_organic,
        n_indhold_kg_per_ton=godning.n_indhold_kg_per_ton,
        fdato=simulation.eea_fdato,
        precision_dagsbasis=simulation.eea_precision_dagsbasis,
        praecisionsjordbrug=simulation.praecisionsjordbrug,
        tidlig_saaning=simulation.tidlig_saaning,
        mellemafgrode=simulation.mellemafgrode,
        start_year=start_year,
        real_history=candidates_row.real_history,
        percolation_by_kategori=percolation,
        org_n_topsoil=org_n_topsoil,
        s_soil=s_soil,
    )
    if candidate is None:
        return None

    retention_factor = 1 - (field.retention or 0) / 100
    leaching_total = candidate.avg_leaching_kg_n_ha * field.area_ha
    rotation_id = candidate.ref.to_id()
    return repository.save_manual_rotation(
        farm_id,
        simulation_id,
        field_id,
        candidate,
        UpdateFieldRequest(
            crop_rotation=[y.year for y in candidate.years[: candidate.active_len]],
            rotation_id=rotation_id,
            db2=candidate.avg_db_kr_ha * field.area_ha,
            n_load=leaching_total * retention_factor,
            leaching=leaching_total,
            fen=candidate.avg_fen * field.area_ha,
            allowed_rotation_ids=[rotation_id],
        ),
        email,
        simulation.revision,
    )


def compute_yearly_summary(
    farm_id: str,
    simulation_id: str,
    email: str,
) -> tuple[YearlySummaryEntry, ...] | None:
    """Summarize annual udledning, DB2, and foderenheder for optimized marks.

    udledning is retention-corrected. Each year is a position in the individual
    mark's own rotation cycle. The result feeds the "Årsoversigt" strip at the
    top of the Liste-visning. Marker without a winning candidate, which have not yet
    been optimized, do not contribute. Rotations shorter than those of other
    marker contribute only to the years they actually cover; field_count shows
    how many marker have data for each year.
    """
    selected = repository.selected_evaluations(farm_id, simulation_id, email)
    if selected is None:
        return None
    fields, candidates_by_field_id = selected

    totals: dict[int, dict[str, float]] = {}
    for field in fields:
        if field.rotation_id is None:
            continue
        candidate = candidates_by_field_id.get(field.id)
        if candidate is None:
            continue

        retention_factor = 1 - (field.retention or 0) / 100
        for index, year_result in enumerate(candidate.years[: candidate.active_len]):
            bucket = totals.setdefault(
                index + 1,
                {"n_load": 0.0, "db2": 0.0, "fen": 0.0, "count": 0},
            )
            bucket["n_load"] += year_result.leaching_kg_n_ha * field.area_ha * retention_factor
            bucket["db2"] += year_result.db_kr_ha * field.area_ha
            if year_result.db_detail.get("udbytteenhed") == "FE/ha":
                bucket["fen"] += (year_result.db_detail.get("udbytte") or 0.0) * field.area_ha
            bucket["count"] += 1

    return tuple(
        YearlySummaryEntry(
            year=year,
            total_n_load_kg=data["n_load"],
            total_db2=data["db2"],
            total_fen=data["fen"],
            field_count=int(data["count"]),
        )
        for year, data in sorted(totals.items())
    )
