from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy.orm import Session

from app.data.db import get_db
from app.data.registry_repository import get_registry_fields
from app.data.repository import list_fields
from app.domain.base import CamelModel
from app.domain.rotation_candidate import RotationCandidateEvaluation, RotationCandidateRef
from app.domain.simulation import GodningSettings
from app.services.rotations import afgroede_normer, saedskifte_kategorier, saedskifte_library
from app.services.scenario.candidate_evaluator import evaluate_candidate_for_mark
from app.services.soil.jbnr import jbnr_for_registry

router = APIRouter(prefix="/farms/{farm_id}/rotation-candidates", tags=["rotation candidates"])
DbSession = Annotated[Session, Depends(get_db)]


class EvaluateRotationCandidatesRequest(CamelModel):
    field_ids: list[str] = Field(min_length=1)
    godning: GodningSettings
    candidate_refs: list[RotationCandidateRef] = Field(min_length=1)
    start_year: int = 1
    irrigated: bool = False


class FieldRotationCandidates(CamelModel):
    field_id: str
    jbnr: int
    candidates: list[RotationCandidateEvaluation]


class RotationCandidateOption(CamelModel):
    ref: RotationCandidateRef
    active_len: int
    crop_sequence: list[str]


class SaedskifteOption(CamelModel):
    saedskiftevariant: str
    crop_sequence: list[str]
    active_len: int


class RotationKategoriOption(CamelModel):
    kategori: str
    dyrkningssystem: str
    antal_saedskifter: int
    saedskifter: list[SaedskifteOption]


class AfgrodeKodeOption(CamelModel):
    code: int
    navn: str


class GodningPresetOption(CamelModel):
    navn: str
    godning: GodningSettings


def _saedskifte_preview(saedskiftevariant: str) -> SaedskifteOption | None:
    """Billig afgrødesekvens-forhåndsvisning for én saedskiftevariant — bruger
    første tilgængelige (variant, N-norm%), ingen NLES5/DB2-beregning. Til
    kategori-fold-ud-listen i "Nyt scenarie", ikke til reel evaluering."""
    variants = saedskifte_library.list_variants(saedskiftevariant)
    if not variants:
        return None
    variant = variants[0]
    n_norms = saedskifte_library.list_n_norms(saedskiftevariant, variant)
    if not n_norms:
        return None
    raw = saedskifte_library.get_raw_rotation(saedskiftevariant, variant, n_norms[0])
    active_len = saedskifte_library.rotation_active_len(raw)
    names = [
        afgroede_normer.lookup_crop_params(code).get("navn", str(code))
        for code, _udl, _udl_navn in raw[:active_len]
    ]
    return SaedskifteOption(
        saedskiftevariant=saedskiftevariant, crop_sequence=names, active_len=active_len,
    )


@router.get("/kategorier", response_model=list[RotationKategoriOption])
async def list_rotation_kategorier() -> list[RotationKategoriOption]:
    """De 6 sædskifte-kategorier (driftsform + gødningsniveau), til
    kategori-afkrydsningslisten i "Nyt scenarie" — hver med en liste af dens
    individuelle sædskiftemuligheder (afgrødesekvens-forhåndsvisning), så
    brugeren kan folde kategorien ud og vælge specifikke sædskifter til/fra."""
    options = []
    for kategori in saedskifte_kategorier.list_kategorier():
        saedskiftevarianter = saedskifte_kategorier.saedskifter_for_kategori(kategori)
        saedskifter = [
            preview
            for sv in saedskiftevarianter
            if (preview := _saedskifte_preview(sv)) is not None
        ]
        options.append(
            RotationKategoriOption(
                kategori=kategori,
                dyrkningssystem=saedskifte_kategorier.dyrkningssystem_for_kategori(kategori),
                antal_saedskifter=len(saedskiftevarianter),
                saedskifter=saedskifter,
            )
        )
    return options


@router.get("/n-norm-procenter", response_model=list[str])
async def list_rotation_n_norm_procenter() -> list[str]:
    """Alle N-norm%-niveauer der findes i datasættet, til N-norm%-
    afkrydsningslisten i "Nyt scenarie". Ikke betinget af kategori-valget i
    denne omgang — en forenkling, jf. planen."""
    values = {n for _s, _v, n in saedskifte_library.list_all_candidate_refs()}
    return sorted(values, key=int)


@router.get("/godnings-presets", response_model=list[GodningPresetOption])
async def list_godnings_presets() -> list[GodningPresetOption]:
    """Gødningstype-presets til "Nyt scenarie"s gødnings-sektion (Fase 13,
    forenklet) — navngivet efter selve gødningstypen (Svinegylle/Kvæggylle),
    ikke efter en driftsform- eller N-mængde-specifik variant. Samme preset
    bruges uanset om marken er konventionel eller økologisk — org_mineral_n/
    mineralsk_andel_pct/kun-organisk er altid frit justerbare bagefter, jf.
    Fase 13's fulde afkobling. Tallene er et rimeligt udgangspunkt hentet
    fra de konventionelle varianter i saedskifte_kategorier.KATEGORI_GODNING
    (samme tal som tidligere blev vist bag "Sædskifter med svinegylle
    (150 N)"/"...kvæggylle (170 kg organisk N)")."""
    svin = saedskifte_kategorier.KATEGORI_GODNING[saedskifte_kategorier.SVINEGYLLE_150]
    kvaeg = saedskifte_kategorier.KATEGORI_GODNING[saedskifte_kategorier.KVAEGGYLLE_170]
    return [
        GodningPresetOption(
            navn="Svinegylle",
            godning=GodningSettings(
                driftsform=svin["dyrkningssystem"],
                org_mineral_n=svin["org_mineral_n"],
                mineralsk_andel_pct=svin["mineralsk_andel_pct"],
                only_organic=svin["only_organic"],
            ),
        ),
        GodningPresetOption(
            navn="Kvæggylle",
            godning=GodningSettings(
                driftsform=kvaeg["dyrkningssystem"],
                org_mineral_n=kvaeg["org_mineral_n"],
                mineralsk_andel_pct=kvaeg["mineralsk_andel_pct"],
                only_organic=kvaeg["only_organic"],
            ),
        ),
    ]


@router.get("/afgrode-koder", response_model=list[AfgrodeKodeOption])
async def list_afgrode_koder() -> list[AfgrodeKodeOption]:
    """Alle rigtige afgrødekoder (Bilag 1/NUAR) med en gyldig NUAR M-kode
    (dvs. reelt brugbare som hovedafgrøde i en NLES5-beregning), til
    afgrøde-dropdownen i "Rediger manuelt" (Fase 10 — levende beregning),
    sorteret på navn. Et lille mindretal koder uden M-kode (fx administrative
    arealtyper) udelades, da de ikke kan indgå i en beregning."""
    names = afgroede_normer.crop_names_from_normer()
    options = [
        AfgrodeKodeOption(code=code, navn=navn)
        for code, navn in names.items()
        if afgroede_normer.lookup_crop_params(code).get("M") is not None
    ]
    return sorted(options, key=lambda o: o.navn)


@router.get("", response_model=list[RotationCandidateOption])
async def list_candidate_refs() -> list[RotationCandidateOption]:
    """Alle tilgængelige sædskifte-kandidater (til fejlsøgning/debugging),
    med en kort afgrødesekvens-forhåndsvisning pr. kandidat.

    Ingen udvaskning/DB-beregning her — brug POST .../evaluate for det, på en
    udvalgt delmængde.
    """
    options: list[RotationCandidateOption] = []
    for s, v, n in saedskifte_library.list_all_candidate_refs():
        raw = saedskifte_library.get_raw_rotation(s, v, n)
        active_len = saedskifte_library.rotation_active_len(raw)
        names = [
            afgroede_normer.lookup_crop_params(code).get("navn", str(code))
            for code, _udl, _udl_navn in raw[:active_len]
        ]
        options.append(RotationCandidateOption(
            ref=RotationCandidateRef(saedskiftevariant=s, variant=v, n_norm_pct=n),
            active_len=active_len,
            crop_sequence=names,
        ))
    return options


@router.post("/evaluate", response_model=list[FieldRotationCandidates])
async def evaluate_rotation_candidates(
    farm_id: str,
    request: EvaluateRotationCandidatesRequest,
    db: DbSession,
) -> list[FieldRotationCandidates]:
    """Beregn udvaskning + DB for en udvalgt delmængde sædskifte-kandidater,
    for et udvalg af marker. Stateless — bruges til fejlsøgning/enkeltopslag,
    IKKE af "Nyt scenarie"-flowet (som beregner og gemmer usynligt ved
    oprettelse, jf. planen)."""
    fields = list_fields(farm_id)
    if fields is None:
        raise HTTPException(status_code=404, detail="Farm not found")

    selected = [field for field in fields if field.id in request.field_ids]
    if len(selected) != len(set(request.field_ids)):
        raise HTTPException(status_code=404, detail="One or more fields were not found")

    imk_ids = [field.imk_id for field in selected if field.imk_id is not None]
    registries_by_imk_id = {r.imk_id: r for r in get_registry_fields(db, imk_ids)} if imk_ids else {}

    results: list[FieldRotationCandidates] = []
    for field in selected:
        registry = registries_by_imk_id.get(field.imk_id) if field.imk_id is not None else None
        jbnr = jbnr_for_registry(registry)
        candidates = [
            evaluate_candidate_for_mark(
                ref,
                jbnr=jbnr,
                driftsform=request.godning.driftsform,
                org_mineral_n=request.godning.org_mineral_n,
                mineralsk_andel_pct=request.godning.mineralsk_andel_pct,
                only_organic=request.godning.only_organic,
                start_year=request.start_year,
                irrigated=request.irrigated,
            )
            for ref in request.candidate_refs
        ]
        results.append(FieldRotationCandidates(
            field_id=field.id, jbnr=jbnr,
            candidates=[c for c in candidates if c is not None],
        ))

    return results
