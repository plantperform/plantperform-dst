from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import Field
from starlette.status import HTTP_204_NO_CONTENT

from app.data.repository import (
    FieldNotOptimizedError,
    create_simulation,
    delete_simulation,
    get_simulation,
    get_simulation_field_candidate_detail,
    get_simulation_field_candidates,
    list_simulation_field_candidates,
    list_simulation_fields,
    list_simulations,
    update_simulation_constraints,
    update_simulation_field,
)
from app.domain.base import CamelModel
from app.domain.field import FieldRecord, UpdateFieldRequest
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateRef,
    RotationPositionOverride,
)
from app.domain.simulation import (
    CreateSimulationRequest,
    OptimizationConstraints,
    Simulation,
)
from app.services.optimization.orchestrator import (
    ManualRotationNotFoundError,
    OptimizationInfeasibleError,
    OptimizationNotFoundError,
    OptimizationUnknownError,
    apply_manual_rotation,
    compute_yearly_summary,
    run_optimization,
    run_yearly_optimization,
)
from app.services.rotations import saedskifte_kategorier
from app.services.scenario.candidate_evaluator import (
    START_CALENDAR_YEAR,
    evaluate_with_overrides,
)

NUM_ROTATION_YEARS = 8

router = APIRouter(prefix="/farms/{farm_id}/simulations", tags=["simulations"])


class OptimizeSimulationRequest(CamelModel):
    time_limit_seconds: float = Field(default=15, gt=0, le=600)


class RotationAssignmentResponse(CamelModel):
    field_id: str
    rotation_id: str


class OptimizeSimulationResponse(CamelModel):
    status: Literal["OPTIMAL", "FEASIBLE"]
    objective_db2: float
    total_n_load_kg: float
    total_leaching_kg: float
    total_fen: float
    fields: list[FieldRecord]
    assignments: list[RotationAssignmentResponse]


class YearlySummaryEntryResponse(CamelModel):
    year: int
    total_n_load_kg: float
    total_db2: float
    total_fen: float
    field_count: int


@router.get("", response_model=list[Simulation])
async def get_farm_simulations(farm_id: str) -> list[Simulation]:
    simulations = list_simulations(farm_id)

    if simulations is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    return simulations


@router.post("", response_model=Simulation)
async def post_farm_simulation(farm_id: str, request: CreateSimulationRequest) -> Simulation:
    simulation = create_simulation(farm_id, request)

    if simulation is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    return simulation


@router.get("/{simulation_id}", response_model=Simulation)
async def get_farm_simulation(farm_id: str, simulation_id: str) -> Simulation:
    simulation = get_simulation(farm_id, simulation_id)

    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")

    return simulation


@router.delete("/{simulation_id}", status_code=HTTP_204_NO_CONTENT)
async def delete_farm_simulation(farm_id: str, simulation_id: str) -> None:
    deleted = delete_simulation(farm_id, simulation_id)

    if deleted is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    if not deleted:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")


@router.patch("/{simulation_id}/constraints", response_model=Simulation)
async def patch_farm_simulation_constraints(
    farm_id: str,
    simulation_id: str,
    request: OptimizationConstraints,
) -> Simulation:
    try:
        simulation = update_simulation_constraints(farm_id, simulation_id, request)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")

    return simulation


@router.post("/{simulation_id}/optimize", response_model=OptimizeSimulationResponse)
async def post_farm_simulation_optimization(
    farm_id: str,
    simulation_id: str,
    request: OptimizeSimulationRequest | None = None,
) -> OptimizeSimulationResponse:
    optimization_request = request or OptimizeSimulationRequest()

    try:
        result = run_optimization(
            farm_id,
            simulation_id,
            optimization_request.time_limit_seconds,
        )
    except OptimizationNotFoundError as error:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet") from error
    except OptimizationInfeasibleError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except OptimizationUnknownError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    return OptimizeSimulationResponse(
        status=result.output.status,
        objective_db2=result.output.total_db2,
        total_n_load_kg=result.output.total_n_load_kg,
        total_leaching_kg=result.output.total_leaching_kg,
        total_fen=result.output.total_fen,
        fields=list(result.fields),
        assignments=[
            RotationAssignmentResponse(
                field_id=assignment.field_id,
                rotation_id=assignment.rotation_id,
            )
            for assignment in result.output.assignments
        ],
    )


class SaedskifteVariantRef(CamelModel):
    saedskiftevariant: str
    variant: str


class YearlyOptimizeSimulationRequest(CamelModel):
    time_limit_seconds: float = Field(default=20, gt=0, le=600)
    max_n_load_by_year: dict[int, float] = Field(default_factory=dict)
    db2_swing_pct: float | None = Field(default=None, ge=0)
    selected_saedskifter: list[SaedskifteVariantRef] = Field(default_factory=list)


class YearlyOptimizeSimulationResponse(CamelModel):
    status: Literal["OPTIMAL", "FEASIBLE"]
    objective_db2: float
    total_n_load_kg: float
    total_leaching_kg: float
    total_fen: float
    total_db2_by_year: dict[int, float]
    total_n_load_by_year: dict[int, float]
    fields: list[FieldRecord]
    assignments: list[RotationAssignmentResponse]


@router.post("/{simulation_id}/optimize-yearly", response_model=YearlyOptimizeSimulationResponse)
async def post_farm_simulation_yearly_optimization(
    farm_id: str,
    simulation_id: str,
    request: YearlyOptimizeSimulationRequest | None = None,
) -> YearlyOptimizeSimulationResponse:
    """"Års-optimering" (Fase 11) — som /optimize, men med pr.-kalenderår
    udledningslofter og en DB-udsvingsgrænse i stedet for scenarie-totaler;
    solveren vælger selv hvor meget hvert felts sædskifte forskydes."""
    optimization_request = request or YearlyOptimizeSimulationRequest()
    max_n_load_by_year = tuple(
        optimization_request.max_n_load_by_year.get(START_CALENDAR_YEAR + i)
        for i in range(NUM_ROTATION_YEARS)
    )
    selected_pairs = {
        (ref.saedskiftevariant, ref.variant)
        for ref in optimization_request.selected_saedskifter
    }

    try:
        result = run_yearly_optimization(
            farm_id,
            simulation_id,
            optimization_request.time_limit_seconds,
            max_n_load_by_year,
            optimization_request.db2_swing_pct,
            selected_pairs,
        )
    except OptimizationNotFoundError as error:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet") from error
    except OptimizationInfeasibleError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except OptimizationUnknownError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    return YearlyOptimizeSimulationResponse(
        status=result.output.status,
        objective_db2=result.output.total_db2,
        total_n_load_kg=result.output.total_n_load_kg,
        total_leaching_kg=result.output.total_leaching_kg,
        total_fen=result.output.total_fen,
        total_db2_by_year={
            START_CALENDAR_YEAR + i: value
            for i, value in enumerate(result.output.total_db2_by_year)
        },
        total_n_load_by_year={
            START_CALENDAR_YEAR + i: value
            for i, value in enumerate(result.output.total_n_load_by_year)
        },
        fields=list(result.fields),
        assignments=[
            RotationAssignmentResponse(
                field_id=assignment.field_id,
                rotation_id=assignment.rotation_id,
            )
            for assignment in result.output.assignments
        ],
    )


class YearlyOptimizationSaedskifteOption(CamelModel):
    saedskiftevariant: str
    variant: str
    crop_sequence: list[str]
    active_len: int


class YearlyOptimizationKategoriOption(CamelModel):
    kategori: str
    saedskifter: list[YearlyOptimizationSaedskifteOption]


@router.get(
    "/{simulation_id}/yearly-optimization-candidates",
    response_model=list[YearlyOptimizationKategoriOption],
)
async def get_farm_simulation_yearly_optimization_candidates(
    farm_id: str, simulation_id: str,
) -> list[YearlyOptimizationKategoriOption]:
    """Fase 12 — de (saedskiftevariant, variant)-par der reelt er gemt for
    denne simulerings marker (fra "Opret scenarie"), til "Års-optimering"s
    eksplicitte sædskifte-vælger. Kun rigtige biblioteks-refs vises
    (base_ref er None) — tidligere Fase 10/11-efterladte "+manuel"-varianter
    filtreres fra, samme mønster som _expand_yearly_options's dedup."""
    field_candidates = list_simulation_field_candidates(farm_id, simulation_id)
    if field_candidates is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")

    by_pair: dict[tuple[str, str], RotationCandidateEvaluation] = {}
    for row in field_candidates:
        for candidate in row.candidates:
            if candidate.base_ref is not None:
                continue
            pair = (candidate.ref.saedskiftevariant, candidate.ref.variant)
            by_pair.setdefault(pair, candidate)

    # Kategorier er normalt gensidigt udelukkende for en given
    # saedskiftevariant — undtagelsen er "ren brak" (saedskiftevariant "1"),
    # som hører til alle 6 kategorier i kildedataen (beslutning 15). Uden
    # særbehandling ville brak-varianterne dukke op — og blive markeret
    # valgt — identisk under alle 6 kategorier i vælgeren, så en "vælg alt"
    # på blot én lille kategori kunne se ud som om den valgte på tværs af
    # dem alle. Brak får derfor sin egen kategori i stedet.
    BRAK_KATEGORI = "Brak"
    # Brak-variant-id'erne (1-4, evt. flere) er alle den samme rene brak
    # gentaget hele vejen igennem — ingen virkemiddel- eller afgrødeforskel
    # dem imellem, kun forskellige interne normgruppe-id'er uden betydning
    # her. Vis kun ét repræsentativt eksemplar i stedet for ét pr. variant-id.
    seen_brak_sequences: set[tuple[str, ...]] = set()

    by_kategori: dict[str, list[YearlyOptimizationSaedskifteOption]] = {}
    for (saedskiftevariant, variant), candidate in by_pair.items():
        crop_sequence = [
            y.year.afgrode_navn for y in candidate.years[: candidate.active_len]
        ]
        option = YearlyOptimizationSaedskifteOption(
            saedskiftevariant=saedskiftevariant,
            variant=variant,
            crop_sequence=crop_sequence,
            active_len=candidate.active_len,
        )
        kategorier = saedskifte_kategorier.kategorier_for_saedskifte(saedskiftevariant)
        if len(kategorier) > 1:
            sequence_key = tuple(crop_sequence)
            if sequence_key in seen_brak_sequences:
                continue
            seen_brak_sequences.add(sequence_key)
            by_kategori.setdefault(BRAK_KATEGORI, []).append(option)
        else:
            for kategori in kategorier:
                by_kategori.setdefault(kategori, []).append(option)

    ordered_kategorier = [BRAK_KATEGORI, *saedskifte_kategorier.list_kategorier()]
    return [
        YearlyOptimizationKategoriOption(
            kategori=kategori,
            saedskifter=sorted(
                by_kategori[kategori],
                key=lambda o: (int(o.saedskiftevariant), o.variant),
            ),
        )
        for kategori in ordered_kategorier
        if kategori in by_kategori
    ]


@router.get("/{simulation_id}/fields", response_model=list[FieldRecord])
async def get_farm_simulation_fields(farm_id: str, simulation_id: str) -> list[FieldRecord]:
    fields = list_simulation_fields(farm_id, simulation_id)

    if fields is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")

    return fields


@router.patch("/{simulation_id}/fields/{field_id}", response_model=FieldRecord)
async def patch_farm_simulation_field(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    request: UpdateFieldRequest,
) -> FieldRecord:
    field = update_simulation_field(farm_id, simulation_id, field_id, request)

    if field is None:
        raise HTTPException(status_code=404, detail="Mark ikke fundet")

    return field


@router.get(
    "/{simulation_id}/fields/{field_id}/candidate-detail",
    response_model=RotationCandidateEvaluation,
)
async def get_farm_simulation_field_candidate_detail(
    farm_id: str, simulation_id: str, field_id: str,
) -> RotationCandidateEvaluation:
    try:
        detail = get_simulation_field_candidate_detail(farm_id, simulation_id, field_id)
    except FieldNotOptimizedError as error:
        raise HTTPException(
            status_code=422, detail="Marken er ikke optimeret endnu",
        ) from error

    if detail is None:
        raise HTTPException(status_code=404, detail="Kandidat-detalje ikke fundet")

    return detail


class RecomputeFieldRotationRequest(CamelModel):
    base_ref: RotationCandidateRef
    overrides: list[RotationPositionOverride] = Field(default_factory=list)
    start_year: int = 1


@router.post(
    "/{simulation_id}/fields/{field_id}/preview-rotation",
    response_model=RotationCandidateEvaluation,
)
async def post_farm_simulation_field_preview_rotation(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    request: RecomputeFieldRotationRequest,
) -> RotationCandidateEvaluation:
    """Levende beregning (Fase 10) — genberegner en rotation for én mark ud
    fra base_ref + evt. enkelt-positions-overskrivninger, uden at gemme
    noget. Bruges af "Rediger manuelt"-panelet til at vise resultatet af en
    ændring, før brugeren trykker "Gem"."""
    simulation = get_simulation(farm_id, simulation_id)
    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")

    candidates_row = get_simulation_field_candidates(farm_id, simulation_id, field_id)
    if candidates_row is None:
        raise HTTPException(status_code=404, detail="Mark ikke fundet")

    godning = simulation.godning
    candidate = evaluate_with_overrides(
        request.base_ref,
        request.overrides,
        jbnr=candidates_row.jbnr,
        driftsform=godning.driftsform,
        org_mineral_n=godning.org_mineral_n,
        mineralsk_andel_pct=godning.mineralsk_andel_pct,
        only_organic=godning.only_organic,
        n_indhold_kg_per_ton=godning.n_indhold_kg_per_ton,
        fdato=simulation.eea_fdato,
        precision_dagsbasis=simulation.eea_precision_dagsbasis,
        start_year=request.start_year,
    )
    if candidate is None:
        raise HTTPException(status_code=422, detail="Rotationen kunne ikke beregnes")

    return candidate


@router.post(
    "/{simulation_id}/fields/{field_id}/apply-rotation",
    response_model=FieldRecord,
)
async def post_farm_simulation_field_apply_rotation(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    request: RecomputeFieldRotationRequest,
) -> FieldRecord:
    """Gemmer resultatet af en manuel rettelse (samme genberegning som
    preview-rotation), skriver den til marken som Optimér ville, og låser
    marken til dette valg (allowed_rotation_ids) indtil brugeren låser op."""
    try:
        field = apply_manual_rotation(
            farm_id, simulation_id, field_id,
            request.base_ref, request.overrides, request.start_year,
        )
    except ManualRotationNotFoundError as error:
        raise HTTPException(status_code=404, detail="Simulering eller mark ikke fundet") from error

    if field is None:
        raise HTTPException(status_code=422, detail="Rotationen kunne ikke beregnes")

    return field


@router.get(
    "/{simulation_id}/yearly-summary",
    response_model=list[YearlySummaryEntryResponse],
)
async def get_farm_simulation_yearly_summary(
    farm_id: str, simulation_id: str,
) -> list[YearlySummaryEntryResponse]:
    summary = compute_yearly_summary(farm_id, simulation_id)

    if summary is None:
        raise HTTPException(status_code=404, detail="Simulering ikke fundet")

    return [
        YearlySummaryEntryResponse(
            year=entry.year,
            total_n_load_kg=entry.total_n_load_kg,
            total_db2=entry.total_db2,
            total_fen=entry.total_fen,
            field_count=entry.field_count,
        )
        for entry in summary
    ]
