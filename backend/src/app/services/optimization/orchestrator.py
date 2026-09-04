from dataclasses import dataclass

from app.data import repository
from app.domain.field import FieldRecord, UpdateFieldRequest
from app.domain.optimization import (
    ConstraintsInput,
    FieldInput,
    OptimizationInput,
    OptimizationOutput,
    RotationOption,
    YearlyConstraintsInput,
    YearlyFieldInput,
    YearlyOptimizationInput,
    YearlyOptimizationOutput,
    YearlyRotationOption,
)
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    RotationPositionOverride,
    SimulationFieldCandidates,
)
from app.domain.simulation import GodningSettings, Simulation
from app.services.optimization.engine import solve
from app.services.optimization.yearly_engine import solve_yearly
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
class YearlyOptimizationRunResult:
    output: YearlyOptimizationOutput
    fields: tuple[FieldRecord, ...]


@dataclass(frozen=True)
class YearlySummaryEntry:
    year: int
    total_n_load_kg: float
    total_db2: float
    total_fen: float
    field_count: int


def _exclude_afgrodekoder(
    candidates: list[RotationCandidateEvaluation],
    excluded_afgrodekoder: frozenset[int],
) -> list[RotationCandidateEvaluation]:
    """Fjerner enhver kandidat der har en af de udelukkede afgrødekoder
    NOGET sted i sin rotation (crop-udelukkelseslisten i Optimér/Års-
    optimering) — hele kandidaten udelukkes, ikke kun det pågældende år, jf.
    at et sædskifte der indeholder afgrøden slet ikke skal være en mulighed."""
    if not excluded_afgrodekoder:
        return candidates
    return [
        c
        for c in candidates
        if not any(
            y.year.afgrode_kode in excluded_afgrodekoder for y in c.years[: c.active_len]
        )
    ]


def _build_options(
    field: FieldRecord,
    candidates: list[RotationCandidateEvaluation],
    excluded_afgrodekoder: frozenset[int] = frozenset(),
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
    candidates = _exclude_afgrodekoder(candidates, excluded_afgrodekoder)
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
    excluded_afgrodekoder: frozenset[int],
    email: str,
) -> OptimizationRunResult:
    simulation = repository.get_simulation(farm_id, simulation_id, email)
    fields = repository.list_simulation_fields(farm_id, simulation_id, email)
    field_candidates = repository.list_simulation_field_candidates(farm_id, simulation_id, email)

    if simulation is None or fields is None or field_candidates is None:
        raise OptimizationNotFoundError

    if not fields:
        raise OptimizationInfeasibleError("Simuleringen har ingen marker at optimere.")

    candidates_by_field_id = {fc.field_id: fc.candidates for fc in field_candidates}

    field_inputs = []
    for field in fields:
        options = _build_options(
            field, candidates_by_field_id.get(field.id, []), excluded_afgrodekoder,
        )
        if not options:
            raise OptimizationInfeasibleError(
                f"Marken {field.name} har ingen beregnede sædskifte-kandidater tilbage — "
                "genopret scenariet med mindst én kategori og N-norm%, eller fravælg "
                "færre afgrøder."
            )

        field_inputs.append(
            FieldInput(
                id=field.id, area_ha=field.area_ha, kystvand_id=field.kystvand_id, options=options,
            )
        )

    output = solve(
        input=OptimizationInput(
            fields=tuple(field_inputs),
            constraints=ConstraintsInput(
                max_n_load_by_kystvandopland={
                    cap.kystvand_id: cap.max_n_load_kg
                    for cap in simulation.constraints.max_n_load_by_kystvandopland
                    if cap.max_n_load_kg is not None
                },
                min_fen=simulation.constraints.min_fen,
                max_fen=simulation.constraints.max_fen,
            ),
            time_limit_seconds=time_limit_seconds,
        )
    )

    if output.status == "INFEASIBLE":
        raise OptimizationInfeasibleError(
            "Ingen sædskifte-fordeling kan opfylde de gemte krav — lempe krav som "
            "maks. udledning eller foderenheder og prøv igen."
        )

    if output.status == "UNKNOWN":
        raise OptimizationUnknownError(
            "Optimeringen fandt ikke en løsning inden for tidsgrænsen — "
            "prøv en længere tidsgrænse."
        )

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
            email,
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
    email: str,
    start_year: int = 1,
) -> FieldRecord | None:
    """"Rediger manuelt" (Fase 10) — genberegner markens rotation ud fra
    base_ref + evt. enkelt-positions-overskrivninger, gemmer resultatet som
    en ekstra (erstattelig) kandidat på marken, skriver det tilbage til
    marken præcis som Optimér ville (samme areal-/retentionsskalering som
    _build_options), og låser marken til dette valg (allowed_rotation_ids)
    så en senere Optimér-kørsel ikke overskriver den manuelle rettelse
    igen, før brugeren selv låser op."""
    simulation = repository.get_simulation(farm_id, simulation_id, email)
    fields = repository.list_simulation_fields(farm_id, simulation_id, email)
    if simulation is None or fields is None:
        raise ManualRotationNotFoundError

    field = next((f for f in fields if f.id == field_id), None)
    candidates_row = repository.get_simulation_field_candidates(
        farm_id,
        simulation_id,
        field_id,
        email,
    )
    if field is None or candidates_row is None:
        raise ManualRotationNotFoundError

    godning = simulation.godning
    percolation_by_kategori, org_n_topsoil, s_soil = repository.get_registry_percolation_context(
        field.imk_id,
    )
    candidate = candidate_evaluator.evaluate_with_overrides(
        base_ref, overrides, jbnr=candidates_row.jbnr,
        driftsform=godning.driftsform,
        org_mineral_n=godning.org_mineral_n,
        mineralsk_andel_pct=godning.mineralsk_andel_pct,
        only_organic=godning.only_organic,
        n_indhold_kg_per_ton=godning.n_indhold_kg_per_ton,
        fdato=simulation.eea_fdato, precision_dagsbasis=simulation.eea_precision_dagsbasis,
        praecisionsjordbrug=simulation.praecisionsjordbrug,
        tidlig_saaning=simulation.tidlig_saaning, mellemafgrode=simulation.mellemafgrode,
        start_year=start_year,
        real_history=candidates_row.real_history,
        percolation_by_kategori=percolation_by_kategori,
        org_n_topsoil=org_n_topsoil, s_soil=s_soil,
    )
    if candidate is None:
        return None

    if not repository.append_manual_field_candidate(
        farm_id,
        simulation_id,
        field_id,
        candidate,
        email,
    ):
        raise ManualRotationNotFoundError

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
        email,
    )


def _expand_yearly_options(
    field: FieldRecord,
    candidates: list[RotationCandidateEvaluation],
    jbnr: int,
    godning: GodningSettings,
    fdato: str,
    precision_dagsbasis: bool,
    praecisionsjordbrug: bool,
    tidlig_saaning: bool,
    mellemafgrode: bool,
    excluded_afgrodekoder: frozenset[int] = frozenset(),
    real_history: dict[str, dict] | None = None,
    percolation_by_kategori: tuple[float | None, ...] | None = None,
    org_n_topsoil: float | None = None,
    s_soil: float | None = None,
) -> tuple[YearlyRotationOption, ...]:
    """Udvider hver gemt kandidat til dens active_len forskudte varianter
    (start_year 1..active_len, jf. Fase 10's evaluate_with_overrides) — den
    ekstra beslutningsvariabel "Års-optimering" (Fase 11) bruger til at rykke
    et felts sædskifte frem/tilbage for bedre at kunne overholde
    pr.-års-udledningslofter og DB-udsvingsgrænsen. Samme
    allowed_rotation_ids-lås som _build_options respekteres — en låst marks
    kandidatmængde begrænses til kun dens låste kandidat, før den forskydes.

    Enhver kandidat kan forskydes (ingen forudvalgt delmængde længere, jf.
    Fase 12's forkastede eksperiment med automatisk DB2-/udlednings-baseret
    rangering — den udelukkede uforvarende kandidater en mark reelt havde
    brug for; her ser solveren i stedet ALLE forskydninger for alle
    kandidater og vælger selv, ingen ekstern heuristik filtrerer på forhånd).
    Tidsforbruget deraf styres af kalderens time_limit_seconds i stedet."""
    retention_factor = 1 - (field.retention or 0) / 100
    if field.allowed_rotation_ids:
        allowed = set(field.allowed_rotation_ids)
        candidates = [c for c in candidates if c.ref.to_id() in allowed]
    candidates = _exclude_afgrodekoder(candidates, excluded_afgrodekoder)

    # En kandidat med base_ref sat og ingen overrides er en tidligere
    # kørsels efterladte rene forskydning af en anden kandidat — at
    # forskyde den IGEN ville blot genskabe de samme sekvenser dens
    # base_ref's egen forskydnings-udvidelse allerede dækker. Springes over
    # for at undgå at kandidatmængden (og dermed CP-SAT-model-størrelsen)
    # vokser for hver gentagen kørsel — men KUN når base_ref rent faktisk
    # stadig er til stede (fx efter allowed_rotation_ids-filtret ovenfor
    # kan en låst marks eneste tilbageværende kandidat selv være en ren
    # forskydning, og skal så beholdes, ellers bliver marken uløseligt).
    # En kandidat med reelle overrides (Fase 10 "Rediger manuelt") er unik
    # og beholdes altid.
    present_ids = {c.ref.to_id() for c in candidates}
    candidates = [
        c
        for c in candidates
        if c.overrides
        or c.base_ref is None
        or c.base_ref.to_id() not in present_ids
    ]

    options: list[YearlyRotationOption] = []
    for candidate in candidates:
        if candidate.active_len == 0:
            continue

        for shift in range(1, candidate.active_len + 1):
            variant = (
                candidate
                if shift == 1
                else candidate_evaluator.evaluate_with_overrides(
                    candidate.ref, [], jbnr=jbnr,
                    driftsform=godning.driftsform,
                    org_mineral_n=godning.org_mineral_n,
                    mineralsk_andel_pct=godning.mineralsk_andel_pct,
                    only_organic=godning.only_organic,
                    n_indhold_kg_per_ton=godning.n_indhold_kg_per_ton,
                    fdato=fdato, precision_dagsbasis=precision_dagsbasis,
                    praecisionsjordbrug=praecisionsjordbrug,
                    tidlig_saaning=tidlig_saaning, mellemafgrode=mellemafgrode,
                    start_year=shift,
                    real_history=real_history,
                    percolation_by_kategori=percolation_by_kategori,
                    org_n_topsoil=org_n_topsoil, s_soil=s_soil,
                )
            )
            if variant is None:
                continue

            db2_by_year = tuple(y.db_kr_ha * field.area_ha for y in variant.years)
            leaching_by_year = tuple(
                y.leaching_kg_n_ha * field.area_ha for y in variant.years
            )
            n_load_by_year = tuple(
                leaching * retention_factor for leaching in leaching_by_year
            )
            ref_id = variant.ref.to_id()
            options.append(
                YearlyRotationOption(
                    key=ref_id,
                    id=ref_id,
                    candidate=variant,
                    years=tuple(y.year for y in variant.years[: variant.active_len]),
                    db2_by_year=db2_by_year,
                    n_load_by_year=n_load_by_year,
                    leaching_by_year=leaching_by_year,
                    fen=variant.avg_fen * field.area_ha,
                )
            )
    return tuple(options)


def run_yearly_optimization(
    farm_id: str,
    simulation_id: str,
    time_limit_seconds: float,
    max_n_load_by_kystvandopland: dict[int | None, tuple[float | None, ...]],
    db2_swing_pct: float | None,
    excluded_afgrodekoder: frozenset[int],
    email: str,
) -> YearlyOptimizationRunResult:
    """"Års-optimering" (Fase 11) — som run_optimization, men lader solveren
    også vælge hvor meget hvert felts sædskifte forskydes (start_year), for
    at kunne overholde pr.-kalenderår-udledningslofter og en grænse for hvor
    meget den samlede DB2 må svinge år-til-år. Vindende kandidater gemmes KUN
    som markens egne rotation_id/crop_rotation/db2/... felter (samme som
    almindelig Optimér) — IKKE tilføjet til den gemte kandidatliste, i
    modsætning til apply_manual_rotation's rigtige "Rediger manuelt"-
    rettelser. En gentagen forskydning genberegnes altid på stedet fra de
    oprindelige bibliotekskandidater i stedet for at ophobe én ekstra gemt
    kandidat pr. kørsel (se get_field_candidate_detail nedenfor for hvordan
    "candidate-detail"-visningen finder den igen). Låser IKKE marken — et
    Års-optimering-resultat skal fortsat kunne overskrives af en senere
    almindelig Optimér- eller Års-optimering-kørsel."""
    simulation = repository.get_simulation(farm_id, simulation_id, email)
    fields = repository.list_simulation_fields(farm_id, simulation_id, email)
    field_candidates = repository.list_simulation_field_candidates(farm_id, simulation_id, email)

    if simulation is None or fields is None or field_candidates is None:
        raise OptimizationNotFoundError

    if not fields:
        raise OptimizationInfeasibleError("Simuleringen har ingen marker at optimere.")

    candidates_by_field_id = {fc.field_id: fc for fc in field_candidates}

    field_inputs = []
    for field in fields:
        field_candidates_row = candidates_by_field_id.get(field.id)
        base_candidates = field_candidates_row.candidates if field_candidates_row else []
        jbnr = field_candidates_row.jbnr if field_candidates_row else 0
        real_history = field_candidates_row.real_history if field_candidates_row else None
        percolation_by_kategori, org_n_topsoil, s_soil = (
            repository.get_registry_percolation_context(field.imk_id)
        )
        options = _expand_yearly_options(
            field, base_candidates, jbnr=jbnr, godning=simulation.godning,
            fdato=simulation.eea_fdato, precision_dagsbasis=simulation.eea_precision_dagsbasis,
            praecisionsjordbrug=simulation.praecisionsjordbrug,
            tidlig_saaning=simulation.tidlig_saaning, mellemafgrode=simulation.mellemafgrode,
            excluded_afgrodekoder=excluded_afgrodekoder, real_history=real_history,
            percolation_by_kategori=percolation_by_kategori,
            org_n_topsoil=org_n_topsoil, s_soil=s_soil,
        )
        if not options:
            raise OptimizationInfeasibleError(
                f"Marken {field.name} har ingen beregnede sædskifte-kandidater tilbage — "
                "genopret scenariet med mindst én kategori og N-norm%, eller fravælg "
                "færre afgrøder."
            )
        field_inputs.append(
            YearlyFieldInput(
                id=field.id, area_ha=field.area_ha, kystvand_id=field.kystvand_id, options=options,
            )
        )

    output = solve_yearly(
        input=YearlyOptimizationInput(
            fields=tuple(field_inputs),
            constraints=YearlyConstraintsInput(
                max_n_load_by_kystvandopland_and_year=max_n_load_by_kystvandopland,
                db2_swing_pct=db2_swing_pct,
                min_fen=simulation.constraints.min_fen,
                max_fen=simulation.constraints.max_fen,
            ),
            time_limit_seconds=time_limit_seconds,
        )
    )

    if output.status == "INFEASIBLE":
        raise OptimizationInfeasibleError(
            "Ingen sædskifte-fordeling kan opfylde de gemte krav — lempe krav som "
            "maks. udledning eller foderenheder og prøv igen."
        )

    if output.status == "UNKNOWN":
        raise OptimizationUnknownError(
            "Optimeringen fandt ikke en løsning inden for tidsgrænsen — "
            "prøv en længere tidsgrænse."
        )

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
            email,
        )
        if updated_field is None:
            raise OptimizationNotFoundError
        updated_fields.append(updated_field)

    return YearlyOptimizationRunResult(output=output, fields=tuple(updated_fields))


def _resolve_field_rotation_candidate(
    field: FieldRecord,
    simulation: Simulation,
    field_candidates_row: SimulationFieldCandidates | None,
) -> RotationCandidateEvaluation | None:
    """Markens vindende kandidat: først i den gemte kandidatliste (bibliotek-
    opslag, "Rediger manuelt"), ellers genberegnet på stedet ved at genudlede
    alle dens forskydningsmuligheder og matche på rotation_id. Års-
    optimering-resultater persisteres bevidst ikke i den gemte kandidatliste
    (se run_yearly_optimization, for at undgå at listen ophober en ekstra
    kandidat pr. kørsel) — deres vindende kandidat findes derfor kun ad denne
    vej. Bruges af både get_field_candidate_detail (én mark) og
    compute_yearly_summary (alle marker)."""
    if field.rotation_id is None:
        return None

    stored_candidates = field_candidates_row.candidates if field_candidates_row else []
    candidate = next(
        (c for c in stored_candidates if c.ref.to_id() == field.rotation_id), None,
    )
    if candidate is not None:
        return candidate

    percolation_by_kategori, org_n_topsoil, s_soil = repository.get_registry_percolation_context(
        field.imk_id,
    )
    options = _expand_yearly_options(
        field,
        stored_candidates,
        jbnr=field_candidates_row.jbnr if field_candidates_row else 0,
        godning=simulation.godning,
        fdato=simulation.eea_fdato,
        precision_dagsbasis=simulation.eea_precision_dagsbasis,
        praecisionsjordbrug=simulation.praecisionsjordbrug,
        tidlig_saaning=simulation.tidlig_saaning,
        mellemafgrode=simulation.mellemafgrode,
        real_history=field_candidates_row.real_history if field_candidates_row else None,
        percolation_by_kategori=percolation_by_kategori,
        org_n_topsoil=org_n_topsoil, s_soil=s_soil,
    )
    match = next((o for o in options if o.id == field.rotation_id), None)
    return match.candidate if match is not None else None


def get_field_candidate_detail(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    email: str,
) -> RotationCandidateEvaluation | None:
    """Som repository.get_simulation_field_candidate_detail, men falder
    tilbage til _resolve_field_rotation_candidate hvis kandidaten ikke findes
    i den gemte kandidatliste (se dens docstring). Marker der reelt ikke er
    optimeret endnu rammer stadig FieldNotOptimizedError fra det indledende
    opslag, uændret.

    Henter kun DENNE marks field/candidates-rækker (get_simulation_field/
    get_simulation_field_candidates), ikke hele simuleringens — rettet
    2026-09-04, da frontenden kalder dette én gang PR. mark (op til 59 for en
    stor bedrift), og et list_simulation_fields/list_simulation_field_
    candidates-kald her genhentede og deserialiserede ALLE marker forgæves
    ved hvert af de kald, en O(marker²)-omkostning der blev synlig efter
    percolation_by_kategori/org_n_topsoil/s_soil gjorde evaluate_leaching_
    positions lru_cache ineffektiv på tværs af marker (se dens docstring)."""
    detail = repository.get_simulation_field_candidate_detail(
        farm_id, simulation_id, field_id, email,
    )
    if detail is not None:
        return detail

    simulation = repository.get_simulation(farm_id, simulation_id, email)
    field = repository.get_simulation_field(farm_id, simulation_id, field_id, email)
    field_candidates_row = repository.get_simulation_field_candidates(
        farm_id, simulation_id, field_id, email,
    )
    if simulation is None or field is None:
        return None

    return _resolve_field_rotation_candidate(field, simulation, field_candidates_row)


def compute_yearly_summary(
    farm_id: str,
    simulation_id: str,
    email: str,
) -> tuple[YearlySummaryEntry, ...] | None:
    """Summér kvælstofudledning (retentionskorrigeret)/DB2/foderenheder pr. år
    (position i den enkelte marks
    egen rotationscyklus) på tværs af alle optimerede marker i simuleringen —
    til "Årsoversigt"-stripen øverst i Liste-visningen. Marker uden vindende
    kandidat (endnu ikke optimeret) bidrager ikke. Rotationer med kortere
    cyklus end andre marker bidrager kun til de år de reelt dækker (field_count
    afspejler hvor mange marker der har data for det pågældende år)."""
    simulation = repository.get_simulation(farm_id, simulation_id, email)
    fields = repository.list_simulation_fields(farm_id, simulation_id, email)
    field_candidates = repository.list_simulation_field_candidates(farm_id, simulation_id, email)
    if simulation is None or fields is None or field_candidates is None:
        return None

    candidates_by_field_id = {fc.field_id: fc for fc in field_candidates}

    totals: dict[int, dict[str, float]] = {}
    for field in fields:
        candidate = _resolve_field_rotation_candidate(
            field, simulation, candidates_by_field_id.get(field.id),
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
