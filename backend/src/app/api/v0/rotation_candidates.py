from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy.orm import Session

from app.auth import AuthenticatedUser, current_user
from app.data.db import get_db
from app.data.registry_repository import get_registry_fields
from app.data.repository import get_farm, get_registry_soil_data_batch, list_fields
from app.domain.base import CamelModel
from app.domain.rotation_candidate import RotationCandidateEvaluation, RotationCandidateRef
from app.domain.simulation import GodningSettings
from app.services.rotations import afgroede_normer, saedskifte_kategorier, saedskifte_library
from app.services.rotations.historisk_goedning import real_history_lookback
from app.services.scenario.candidate_evaluator import evaluate_candidate_for_mark
from app.services.soil.jbnr import jbnr_for_registry

router = APIRouter(prefix="/farms/{farm_id}/rotation-candidates", tags=["rotation candidates"])
CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]
DbSession = Annotated[Session, Depends(get_db)]


def _require_farm_member(farm_id: str, user: CurrentUser) -> AuthenticatedUser:
    if get_farm(farm_id, user.email) is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")
    return user


FarmMember = Annotated[AuthenticatedUser, Depends(_require_farm_member)]


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
    """Provide a cheap afgrøde-sequence preview for one saedskiftevariant.

    Uses the first available variant without NLES5/DB2 calculation. Intended
    for the expandable category list in "Nyt scenarie", not actual evaluation.
    """
    variants = saedskifte_library.list_variants(saedskiftevariant)
    if not variants:
        return None
    variant = variants[0]
    raw = saedskifte_library.get_raw_rotation(saedskiftevariant, variant)
    active_len = saedskifte_library.rotation_active_len(raw)
    names = [
        afgroede_normer.lookup_crop_params(code).get("navn", str(code))
        for code, _udl, _udl_navn in raw[:active_len]
    ]
    return SaedskifteOption(
        saedskiftevariant=saedskiftevariant, crop_sequence=names, active_len=active_len,
    )


@router.get("/kategorier", response_model=list[RotationKategoriOption])
def list_rotation_kategorier(_: FarmMember) -> list[RotationKategoriOption]:
    """Return the four sædskifte categories (driftsform + gødning level).

    Each category contains its individual sædskifte options with afgrøde-sequence
    previews, allowing users to expand it and select specific sædskifter in
    "Nyt scenarie".
    """
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


# Fixed N-norm% levels for the N-norm% checklist in "Nyt scenarie".
# These were previously derived from the sædskifte lookup file's N-norm% rows
# (Ny_sædskifte_lookup_sammenlagt.csv removed that axis from the rotation lookup
# on 2026-09-02; see saedskifte_library.py's module docstring). This is the same
# value set that the file previously contained, now fixed independently of the
# data file because N allocation is handled as pure percentage scaling in
# candidate_evaluator.compute_n_inputs, not as part of the rotation data.
_N_NORM_PROCENTER = ["30", "50", "60", "70", "75", "80", "85", "90", "95", "100"]


@router.get("/n-norm-procenter", response_model=list[str])
def list_rotation_n_norm_procenter(_: FarmMember) -> list[str]:
    """Return all N-norm% levels for the checklist in "Nyt scenarie".

    They are not conditional on the category selection and apply uniformly to
    all sædskifter.
    """
    return _N_NORM_PROCENTER


@router.get("/godnings-presets", response_model=list[GodningPresetOption])
def list_godnings_presets(_: FarmMember) -> list[GodningPresetOption]:
    """Return gødning-type presets for "Nyt scenarie" (simplified Phase 13).

    They are named for the gødning type itself (Svinegylle/Kvæggylle), not for
    a driftsform- or N-quantity-specific variant. The same preset is used
    whether the mark is konventionel or økologisk; org_mineral_n,
    mineralsk_andel_pct, and only_organic remain freely adjustable, in line
    with Phase 13's complete decoupling. The values are reasonable starting
    points taken from the konventionelle variants in
    saedskifte_kategorier.KATEGORI_GODNING ("Konv. svin samlet"/"Konv. kvæg").
    """
    svin = saedskifte_kategorier.KATEGORI_GODNING[saedskifte_kategorier.KONV_SVIN_SAMLET]
    kvaeg = saedskifte_kategorier.KATEGORI_GODNING[saedskifte_kategorier.KONV_KVAEG]
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
def list_afgrode_koder(_: FarmMember) -> list[AfgrodeKodeOption]:
    """Return real afgrødekoder (Bilag 1/NUAR) with a valid NUAR M code.

    These can actually be used as hovedafgrøde in an NLES5 calculation. They
    are sorted by name for the afgrøde dropdown in the live Phase 10 "Rediger
    manuelt" calculation. The small minority without an M code, such as
    administrative area types, are omitted because they cannot be calculated.
    """
    names = afgroede_normer.crop_names_from_normer()
    options = [
        AfgrodeKodeOption(code=code, navn=navn)
        for code, navn in names.items()
        if afgroede_normer.lookup_crop_params(code).get("M") is not None
    ]
    return sorted(options, key=lambda o: o.navn)


@router.get("", response_model=list[RotationCandidateOption])
def list_candidate_refs(_: FarmMember) -> list[RotationCandidateOption]:
    """Return all available sædskifte candidates for troubleshooting/debugging,
    with a short afgrøde-sequence preview for each candidate.

    No udvaskning/DB calculation is performed here; use POST .../evaluate on a
    selected subset instead.
    """
    options: list[RotationCandidateOption] = []
    for s, v in saedskifte_library.list_all_saedskifte_refs():
        raw = saedskifte_library.get_raw_rotation(s, v)
        active_len = saedskifte_library.rotation_active_len(raw)
        names = [
            afgroede_normer.lookup_crop_params(code).get("navn", str(code))
            for code, _udl, _udl_navn in raw[:active_len]
        ]
        for n in _N_NORM_PROCENTER:
            options.append(RotationCandidateOption(
                ref=RotationCandidateRef(saedskiftevariant=s, variant=v, n_norm_pct=n),
                active_len=active_len,
                crop_sequence=names,
            ))
    return options


@router.post("/evaluate", response_model=list[FieldRotationCandidates])
def evaluate_rotation_candidates(
    farm_id: str,
    request: EvaluateRotationCandidatesRequest,
    db: DbSession,
    user: FarmMember,
) -> list[FieldRotationCandidates]:
    """Calculate udvaskning + DB for selected sædskifte candidates and marker.

    This stateless operation is for troubleshooting/individual lookups, not the
    "Nyt scenarie" flow, which calculates and stores results in the background during
    creation as specified in the plan.
    """
    fields = list_fields(farm_id, user.email)
    if fields is None:
        raise HTTPException(status_code=404, detail="Bedrift ikke fundet")

    selected = [field for field in fields if field.id in request.field_ids]
    if len(selected) != len(set(request.field_ids)):
        raise HTTPException(status_code=404, detail="Én eller flere marker blev ikke fundet")

    imk_ids = [field.imk_id for field in selected if field.imk_id is not None]
    registries_by_imk_id = (
        {registry.imk_id: registry for registry in get_registry_fields(db, imk_ids)}
        if imk_ids
        else {}
    )
    soil_data_by_imk_id = get_registry_soil_data_batch(imk_ids)

    results: list[FieldRotationCandidates] = []
    for field in selected:
        registry = registries_by_imk_id.get(field.imk_id) if field.imk_id is not None else None
        jbnr = jbnr_for_registry(registry)
        real_history = (
            real_history_lookback(
                registry.crop_history, jbnr, registry.goedningsregion, registry.oeko
            )
            if registry is not None
            else None
        )
        soil_data = soil_data_by_imk_id.get(field.imk_id)
        percolation, org_n_topsoil, s_soil = (
            soil_data if soil_data is not None else (None, None, None)
        )
        candidates = [
            evaluate_candidate_for_mark(
                ref,
                jbnr=jbnr,
                driftsform=request.godning.driftsform,
                org_mineral_n=request.godning.org_mineral_n,
                mineralsk_andel_pct=request.godning.mineralsk_andel_pct,
                only_organic=request.godning.only_organic,
                n_indhold_kg_per_ton=request.godning.n_indhold_kg_per_ton,
                start_year=request.start_year,
                irrigated=request.irrigated,
                real_history=real_history,
                percolation_by_kategori=percolation,
                org_n_topsoil=org_n_topsoil,
                s_soil=s_soil,
            )
            for ref in request.candidate_refs
        ]
        results.append(FieldRotationCandidates(
            field_id=field.id, jbnr=jbnr,
            candidates=[c for c in candidates if c is not None],
        ))

    return results
