from dataclasses import dataclass

from app.data import repository
from app.domain.field import FieldRecord, UpdateFieldRequest
from app.domain.optimization import (
    ConstraintsInput,
    FieldInput,
    OptimizationInput,
    OptimizationOutput,
    RotationOption,
)
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    RotationPositionOverride,
)
from app.services.optimization.engine import solve
from app.services.rotations import saedskifte_kategorier
from app.services.scenario import candidate_evaluator


class OptimizationNotFoundError(Exception):
    pass


class OptimizationInfeasibleError(Exception):
    pass


class OptimizationUnknownError(Exception):
    pass


@dataclass(frozen=True)
class OptimizationRunResult:
    output: OptimizationOutput
    fields: tuple[FieldRecord, ...]


@dataclass(frozen=True)
class YearlySummaryEntry:
    year: int
    total_n_load_kg: float
    total_db2: float
    total_fen: float
    field_count: int


def _build_options(
    field: FieldRecord,
    candidates: list[RotationCandidateEvaluation],
) -> tuple[RotationOption, ...]:
    """Ét RotationOption pr. gemt, usynligt beregnet sædskifte-kandidat (jf.
    "Opret scenarie") — ingen 2^n virkemiddel-udfoldning her (beslutning 7:
    virkemidler er en fremtidig ekstra kandidat-facet, ikke bygget endnu).

    Hvis marken har `allowed_rotation_ids` sat (fx en manuel rettelse gemt
    via Fase 10's "Rediger manuelt", som låser marken til netop det valg),
    begrænses kandidatmængden til kun disse — Optimér kan så ikke overskrive
    en bevidst manuel rettelse igen, før brugeren selv låser op."""
    retention_factor = 1 - (field.retention or 0) / 100
    if field.allowed_rotation_ids:
        allowed = set(field.allowed_rotation_ids)
        candidates = [c for c in candidates if c.ref.to_id() in allowed]
    options = []
    for candidate in candidates:
        ref_id = candidate.ref.to_id()
        leaching_total = candidate.avg_leaching_kg_n_ha * field.area_ha
        options.append(
            RotationOption(
                key=ref_id,
                id=ref_id,
                years=tuple(y.year for y in candidate.years[: candidate.active_len]),
                db2=candidate.avg_db_kr_ha * field.area_ha,
                n_load=leaching_total * retention_factor,
                leaching=leaching_total,
                fen=candidate.avg_fen * field.area_ha,
            )
        )
    return tuple(options)


def run_optimization(
    farm_id: str,
    simulation_id: str,
    time_limit_seconds: float,
) -> OptimizationRunResult:
    simulation = repository.get_simulation(farm_id, simulation_id)
    fields = repository.list_simulation_fields(farm_id, simulation_id)
    field_candidates = repository.list_simulation_field_candidates(farm_id, simulation_id)

    if simulation is None or fields is None or field_candidates is None:
        raise OptimizationNotFoundError

    if not fields:
        raise OptimizationInfeasibleError("Simulation has no fields to optimize.")

    candidates_by_field_id = {fc.field_id: fc.candidates for fc in field_candidates}

    field_inputs = []
    for field in fields:
        options = _build_options(field, candidates_by_field_id.get(field.id, []))
        if not options:
            raise OptimizationInfeasibleError(
                f"Field {field.name} has no calculated rotation candidates — "
                "recreate the scenario with at least one kategori and N-norm%."
            )

        field_inputs.append(FieldInput(id=field.id, area_ha=field.area_ha, options=options))

    output = solve(
        input=OptimizationInput(
            fields=tuple(field_inputs),
            constraints=ConstraintsInput(
                max_n_load_kg=simulation.constraints.max_n_load_kg,
                min_fen=simulation.constraints.min_fen,
                max_fen=simulation.constraints.max_fen,
            ),
            time_limit_seconds=time_limit_seconds,
        )
    )

    if output.status == "INFEASIBLE":
        raise OptimizationInfeasibleError(
            "No feasible crop rotation assignment satisfies the saved constraints."
        )

    if output.status == "UNKNOWN":
        raise OptimizationUnknownError("Optimization did not find a feasible solution in time.")

    updated_fields = []
    for assignment in output.assignments:
        updated_field = repository.update_simulation_field(
            farm_id,
            simulation_id,
            assignment.field_id,
            UpdateFieldRequest(
                crop_rotation=list(assignment.years),
                rotation_id=assignment.rotation_id,
                db2=assignment.db2,
                n_load=assignment.n_load,
                leaching=assignment.leaching,
                fen=assignment.fen,
            ),
        )
        if updated_field is None:
            raise OptimizationNotFoundError
        updated_fields.append(updated_field)

    return OptimizationRunResult(output=output, fields=tuple(updated_fields))


class ManualRotationNotFoundError(Exception):
    """Simulering, mark eller markens gemte kandidatmængde (jbnr-kilden) findes ikke."""


def apply_manual_rotation(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    base_ref: RotationCandidateRef,
    overrides: list[RotationPositionOverride],
) -> FieldRecord | None:
    """"Rediger manuelt" (Fase 10) — genberegner markens rotation ud fra
    base_ref + evt. enkelt-positions-overskrivninger, gemmer resultatet som
    en ekstra (erstattelig) kandidat på marken, skriver det tilbage til
    marken præcis som Optimér ville (samme areal-/retentionsskalering som
    _build_options), og låser marken til dette valg (allowed_rotation_ids)
    så en senere Optimér-kørsel ikke overskriver den manuelle rettelse
    igen, før brugeren selv låser op."""
    simulation = repository.get_simulation(farm_id, simulation_id)
    fields = repository.list_simulation_fields(farm_id, simulation_id)
    field_candidates = repository.list_simulation_field_candidates(farm_id, simulation_id)
    if simulation is None or fields is None or field_candidates is None:
        raise ManualRotationNotFoundError

    field = next((f for f in fields if f.id == field_id), None)
    candidates_row = next((fc for fc in field_candidates if fc.field_id == field_id), None)
    if field is None or candidates_row is None:
        raise ManualRotationNotFoundError

    kategorier = saedskifte_kategorier.kategorier_for_saedskifte(base_ref.saedskiftevariant)
    if not kategorier:
        return None
    candidate = candidate_evaluator.evaluate_with_overrides(
        base_ref, overrides, jbnr=candidates_row.jbnr, kategori=kategorier[0],
        fdato=simulation.eea_fdato, precision_dagsbasis=simulation.eea_precision_dagsbasis,
    )
    if candidate is None:
        return None

    repository.append_manual_field_candidate(farm_id, simulation_id, field_id, candidate)

    retention_factor = 1 - (field.retention or 0) / 100
    leaching_total = candidate.avg_leaching_kg_n_ha * field.area_ha
    rotation_id = candidate.ref.to_id()
    return repository.update_simulation_field(
        farm_id, simulation_id, field_id,
        UpdateFieldRequest(
            crop_rotation=[y.year for y in candidate.years[: candidate.active_len]],
            rotation_id=rotation_id,
            db2=candidate.avg_db_kr_ha * field.area_ha,
            n_load=leaching_total * retention_factor,
            leaching=leaching_total,
            fen=candidate.avg_fen * field.area_ha,
            allowed_rotation_ids=[rotation_id],
        ),
    )


def compute_yearly_summary(
    farm_id: str, simulation_id: str,
) -> tuple[YearlySummaryEntry, ...] | None:
    """Summér kvælstofudledning (retentionskorrigeret)/DB2/foderenheder pr. år
    (position i den enkelte marks
    egen rotationscyklus) på tværs af alle optimerede marker i simuleringen —
    til "Årsoversigt"-stripen øverst i Liste-visningen. Marker uden vindende
    kandidat (endnu ikke optimeret) bidrager ikke. Rotationer med kortere
    cyklus end andre marker bidrager kun til de år de reelt dækker (field_count
    afspejler hvor mange marker der har data for det pågældende år)."""
    fields = repository.list_simulation_fields(farm_id, simulation_id)
    field_candidates = repository.list_simulation_field_candidates(farm_id, simulation_id)
    if fields is None or field_candidates is None:
        return None

    candidates_by_field_id = {fc.field_id: fc.candidates for fc in field_candidates}

    totals: dict[int, dict[str, float]] = {}
    for field in fields:
        if field.rotation_id is None:
            continue
        candidates = candidates_by_field_id.get(field.id, [])
        candidate = next(
            (c for c in candidates if c.ref.to_id() == field.rotation_id), None,
        )
        if candidate is None:
            continue

        retention_factor = 1 - (field.retention or 0) / 100
        for index, year_result in enumerate(candidate.years[: candidate.active_len]):
            bucket = totals.setdefault(
                index + 1, {"n_load": 0.0, "db2": 0.0, "fen": 0.0, "count": 0},
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
