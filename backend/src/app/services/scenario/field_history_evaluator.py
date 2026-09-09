"""Evaluate a mark's "Aktuel" state (DB2/udvaskning/FEN) from its actual
crop_history (2017-2026) and historical gødning allocation (Bilag 3), without a
scenarie/gødning slider. Used to populate FieldRecord.db2/n_load/leaching/fen
through "Tilføj marker" instead of the former hard-coded zeros.

It uses the same calculation core as candidate_evaluator.py's
evaluate_sequence_for_mark (bridge_v2.evaluate_leaching_position and
calculate_db), with these differences:
  - MNCS/G0 comes from historisk_goedning.lookup_historisk_n_input (afgrøde x
    region x JB-nr x driftsform), not the norm formula in compute_n_inputs.
  - f1/f2/g1/g2/m1/m2 (the previous two years' contributions) comes from the
    mark's own previous two actual years, not a cyclic wrap of a hypothetical
    rotation.
  - Missing years (outside the history range or without a registered afgrøde)
    contribute nothing for that year. The same fallback applies to afgrøder
    without a meaningful N norm, such as permanent græs without a norm, where
    the historical MNCS/G0 lookup is ~0 and the NLES5 base term becomes
    mathematically invalid. The position is set to 0 rather than failing the
    entire mark calculation.
  - Gødning tonnage is intentionally omitted because no n_indhold_kg_per_ton
    basis exists outside a scenarie, and is set to 0.0.
"""
from __future__ import annotations

from app.domain.rotation_candidate import RotationCandidateYearResult, RotationYear
from app.domain.soil import PercolationByKategori
from app.services.economics.db_calculator import calculate_db
from app.services.nles5 import bridge_v2
from app.services.nles5.engine import LowNitrogenModelError
from app.services.rotations import afgroede_normer
from app.services.rotations.historisk_goedning import lookup_historisk_n_input

# Latest year with actual crop_history. The eight positions are the eight years
# through this year (2019-2026), so position 0 (2019) still has two actual prior
# years (2018, 2017) for f1/f2/g1/g2/m1/m2.
REAL_HISTORY_END_YEAR = 2026


def _n_input(code: int | None, jbnr: int | None, goedningsregion: str | None, oeko: bool) -> dict:
    return {**lookup_historisk_n_input(code, jbnr, goedningsregion, oeko), "mnca": 0.0}


def evaluate_real_history_for_field(
    crop_history: dict[str, int | None],
    jbnr: int | None,
    goedningsregion: str | None,
    oeko: bool,
    fdato: str = "20/8",
    precision_dagsbasis: bool = False,
    irrigated: bool = False,
    percolation_by_kategori: PercolationByKategori | None = None,
    org_n_topsoil: float | None = None,
    s_soil: float | None = None,
) -> list[RotationCandidateYearResult]:
    def code_for(year: int) -> int | None:
        value = crop_history.get(str(year))
        return int(value) if value is not None else None

    start_year = REAL_HISTORY_END_YEAR - 7  # 2019
    years: list[RotationCandidateYearResult] = []

    for i in range(8):
        this_year = start_year + i
        prev_year, prev2_year = this_year - 1, this_year - 2
        this_code = code_for(this_year)
        prev_code = code_for(prev_year)
        prev2_code = code_for(prev2_year)

        n_input = _n_input(this_code, jbnr, goedningsregion, oeko)
        n1 = _n_input(prev_code, jbnr, goedningsregion, oeko)
        n2 = _n_input(prev2_code, jbnr, goedningsregion, oeko)

        f0 = (
            afgroede_normer.lookup_nfix(this_code, jbnr, irrigated)
            if this_code is not None
            else 0.0
        )
        f1 = (
            afgroede_normer.lookup_nfix(prev_code, jbnr, irrigated)
            if prev_code is not None
            else 0.0
        )
        f2 = (
            afgroede_normer.lookup_nfix(prev2_code, jbnr, irrigated)
            if prev2_code is not None
            else 0.0
        )

        norm = (
            afgroede_normer.lookup_norm(this_code, jbnr, irrigated)
            if this_code is not None
            else None
        )
        prev_norm = (
            afgroede_normer.lookup_norm(prev_code, jbnr, irrigated)
            if prev_code is not None
            else None
        )
        fv_forfrugt = prev_norm["forfrugtsvaerdi"] if prev_norm else 0.0

        leaching: dict = {}
        if this_code is not None:
            try:
                leaching = bridge_v2.evaluate_leaching_position(
                    afgrode_kode=this_code,
                    next_afgrode_kode=code_for(this_year + 1),
                    prev_afgrode_kode=prev_code,
                    udlaeg_kode=None,
                    jbnr=jbnr,
                    mncs=n_input["mncs"], mnca=n_input["mnca"], g0=n_input["g0"],
                    m1=n1["mncs"] + n1["mnca"], m2=n2["mncs"] + n2["mnca"],
                    f0=f0, f1=f1, f2=f2,
                    g1=n1["g0"], g2=n2["g0"],
                    irrigated=irrigated, fdato=fdato, precision_dagsbasis=precision_dagsbasis,
                    y=this_year,
                    percolation_by_kategori=percolation_by_kategori,
                    org_n_topsoil=org_n_topsoil,
                    s_soil=s_soil,
                )
            except LowNitrogenModelError:
                leaching = {}
        db = (
            calculate_db(
                this_code, "Økologisk" if oeko else "Konventionel", jbnr,
                mncs=n_input["mncs"], mnca=n_input["mnca"], irrigated=irrigated,
                org_mineral_n_applied=0.0,
                udlaeg_kode=None, only_organic=oeko,
            )
            if this_code is not None
            else {"db": 0.0, "udbytte": 0.0, "udbytteenhed": ""}
        )
        crop_params = afgroede_normer.lookup_crop_params(this_code) if this_code is not None else {}

        years.append(RotationCandidateYearResult(
            year=RotationYear(
                afgrode_kode=this_code if this_code is not None else 0,
                afgrode_navn=(
                    crop_params.get("navn", "Ukendt") if this_code is not None else "Ukendt"
                ),
            ),
            leaching_kg_n_ha=leaching.get("L_nuar", 0.0),
            leaching_detail=leaching,
            db_kr_ha=db["db"],
            db_detail=db,
            forfrugtsvaerdi_kgn_ha=fv_forfrugt,
            tildelt_husdyrgodning_udnyttet_kgn_ha=0.0,
            tildelt_handelsgodning_kgn_ha=n_input["mncs"],
            husdyrgodning_organisk_bundet_kgn_ha=n_input["g0"],
            husdyrgodning_ton_udnyttet_pr_ha=0.0,
            husdyrgodning_ton_total_pr_ha=0.0,
            afgrode_norm_kgn_ha=norm["n_norm"] if norm else None,
            n_norm_pct=100.0,
        ))

    return years
