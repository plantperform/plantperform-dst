from copy import deepcopy
from datetime import UTC, datetime
from uuid import uuid4

from pydantic import BaseModel
from sqlalchemy import delete, func, insert, select, text, update
from sqlalchemy.orm import Session

from app.data.db import (
    SessionLocal,
    app_user_table,
    farm_member_table,
    farm_table,
    field_table,
    registry_field_table,
    simulation_field_candidates_table,
    simulation_result_table,
    simulation_table,
)
from app.data.optimizer_inputs import optimizer_input
from app.data.simulation_store import (
    _get_simulation as _get_simulation,
)
from app.data.simulation_store import (
    delete_simulation as delete_simulation,
)
from app.data.simulation_store import (
    get_simulation as get_simulation,
)
from app.data.simulation_store import (
    get_simulation_field as get_simulation_field,
)
from app.data.simulation_store import (
    get_simulation_field_candidate_detail as get_simulation_field_candidate_detail,
)
from app.data.simulation_store import (
    get_simulation_field_candidates as get_simulation_field_candidates,
)
from app.data.simulation_store import (
    list_simulation_field_candidates as list_simulation_field_candidates,
)
from app.data.simulation_store import (
    list_simulation_fields as list_simulation_fields,
)
from app.data.simulation_store import (
    list_simulations as list_simulations,
)
from app.data.simulation_store import (
    save_manual_rotation as save_manual_rotation,
)
from app.data.simulation_store import (
    selected_evaluations as selected_evaluations,
)
from app.data.simulation_store import (
    split_field as split_field,
)
from app.data.simulation_store import (
    update_simulation_constraints as update_simulation_constraints,
)
from app.data.simulation_store import (
    update_simulation_field as update_simulation_field,
)
from app.domain.farm import CreateFarmRequest, Farm, KystvandoplandUdledning
from app.domain.field import (
    CreateFieldRequest,
    FieldRecord,
)
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateYearResult,
    SimulationFieldCandidates,
)
from app.domain.rotation_library import ROTATION_LIBRARY
from app.domain.simulation import (
    CreateSimulationRequest,
    Simulation,
)
from app.domain.soil import MissingSoilDataError, RegistrySoilData, registry_soil_data
from app.services.rotations import saedskifte_library
from app.services.rotations.afgroede_normer import is_permanent_afgrode
from app.services.rotations.historisk_goedning import real_history_lookback
from app.services.scenario.candidate_evaluator import generate_candidates_for_field
from app.services.scenario.field_history_evaluator import (
    REAL_HISTORY_END_YEAR,
    evaluate_real_history_for_field,
    generate_permanent_crop_candidate,
)
from app.services.soil.jbnr import FALLBACK_JBNR


def _dump(model: BaseModel) -> dict:
    return model.model_dump(mode="json")


def _partial_update(model: BaseModel) -> dict:
    return {field: getattr(model, field) for field in model.model_fields_set}


def _load[ModelT: BaseModel](model_type: type[ModelT], data: dict) -> ModelT:
    return model_type.model_validate(data)


def _registry_context_for_imk_id(session: Session, imk_id: int | None):
    """Return raw registry_field context for an imk_id.

    The jbnr/goedningsregion/oeko/crop_history context is shared by both the
    "Aktuel" calculation and the real_history lookup for the 2027/2028 lookback
    in sædskifte simuleringer. Returns None if imk_id is absent or not found.
    """
    if imk_id is None:
        return None
    return session.execute(
        select(
            registry_field_table.c.jbnr,
            registry_field_table.c.goedningsregion,
            registry_field_table.c.oeko,
            registry_field_table.c.kvotegivende,
            registry_field_table.c.crop_history,
            registry_field_table.c.percolation_by_kategori,
            registry_field_table.c.org_n_topsoil,
            registry_field_table.c.s_soil,
        ).where(
            registry_field_table.c.imk_id == imk_id,
            registry_field_table.c.banned.is_(False),
        ),
    ).first()


def _registry_contexts_for_imk_ids(session: Session, imk_ids: list[int]) -> dict[int, object]:
    if not imk_ids:
        return {}
    rows = session.execute(
        select(
            registry_field_table.c.imk_id,
            registry_field_table.c.jbnr,
            registry_field_table.c.goedningsregion,
            registry_field_table.c.oeko,
            registry_field_table.c.kvotegivende,
            registry_field_table.c.crop_history,
            registry_field_table.c.percolation_by_kategori,
            registry_field_table.c.org_n_topsoil,
            registry_field_table.c.s_soil,
        ).where(
            registry_field_table.c.imk_id.in_(imk_ids),
            registry_field_table.c.banned.is_(False),
        )
    ).all()
    return {row.imk_id: row for row in rows}


def _soil_data_for_context(row) -> RegistrySoilData | None:
    if row is None:
        return None
    return registry_soil_data(row.percolation_by_kategori, row.org_n_topsoil, row.s_soil)


def get_registry_soil_data(imk_id: int | None) -> RegistrySoilData | None:
    with SessionLocal() as session:
        return _soil_data_for_context(_registry_context_for_imk_id(session, imk_id))


def get_registry_soil_data_batch(imk_ids: list[int]) -> dict[int, RegistrySoilData]:
    with SessionLocal() as session:
        contexts = _registry_contexts_for_imk_ids(session, imk_ids)
    return {
        imk_id: soil_data
        for imk_id, row in contexts.items()
        if (soil_data := _soil_data_for_context(row)) is not None
    }


def _aktuel_field_state(row, area_ha: float, retention: float | None) -> dict:
    """Calculate a mark's "Aktuel" state (db2/n_load/leaching/fen).

    Uses the mark's actual crop_history and historical gødning allocation
    (Bilag 3), without involving a scenarie/gødning slider. Used by "Tilføj
    marker" instead of the former hard-coded zeros.
    """
    if row is None:
        raise MissingSoilDataError("Registry field is missing or banned")

    jbnr = row.jbnr if row.jbnr is not None else FALLBACK_JBNR
    soil_data = _soil_data_for_context(row)
    if soil_data is None:
        raise MissingSoilDataError("Registry field has incomplete P/S/Nt data")
    percolation_by_kategori, org_n_topsoil, s_soil = soil_data
    years = evaluate_real_history_for_field(
        row.crop_history or {},
        jbnr,
        row.goedningsregion,
        bool(row.oeko),
        percolation_by_kategori=percolation_by_kategori,
        org_n_topsoil=org_n_topsoil,
        s_soil=s_soil,
    )
    avg_leaching = sum(y.leaching_kg_n_ha for y in years) / len(years)
    avg_db = sum(y.db_kr_ha for y in years) / len(years)
    fen_values = [
        y.db_detail["udbytte"] for y in years if y.db_detail.get("udbytteenhed") == "FE/ha"
    ]
    avg_fen = sum(fen_values) / len(years) if fen_values else 0.0

    leaching_total = avg_leaching * area_ha
    retention_factor = 1 - (retention or 0) / 100
    return {
        "jbnr": jbnr,
        "db2": avg_db * area_ha,
        "n_load": leaching_total * retention_factor,
        "leaching": leaching_total,
        "fen": avg_fen * area_ha,
        # Actual 2019-2026 afgrøder (the same eight positions as the calculation
        # above), shown in the "Aktuel" mark overview with real calendar years
        # per the request to show history like the scenarier's forward years.
        "crop_rotation": [y.year for y in years],
        "kvotegivende": bool(row.kvotegivende),
    }


def get_farm_udledning_per_kystvandopland(
    farm_id: str,
    email: str,
) -> list[KystvandoplandUdledning] | None:
    """Group udledningskvote and calculated udledning by kystvandopland.

    "Aktuel" means FieldRecord.n_load. The bekendtgørelse calculates both values per
    kystvandopland, never across oplande (see KystvandoplandUdledning). Marker
    without imk_id, such as manually drawn marks, match no registry_field row
    and are therefore excluded from all groups, as in the previous flat total.

    A mark that is not kvotegivende (registry_field.kvotegivende = false)
    contributes neither kvote nor udledning here — such an area does not
    count toward the bedrift's regulatory quota comparison at all, even
    though NLES5 still computes a real leaching figure for it elsewhere.
    """
    with SessionLocal() as session:
        if not _farm_exists(session, farm_id, email):
            return None

        rows = session.execute(
            text(
                """
                SELECT
                    rf.kystvand_id,
                    rf.kystvand_navn,
                    COALESCE(SUM(rf.udledningskvote_mark_kgn), 0) AS kvote,
                    COALESCE(
                        SUM((f.data->>'n_load')::float) FILTER (WHERE rf.kvotegivende),
                        0
                    ) AS udledning
                FROM field f
                JOIN registry_field rf ON rf.imk_id = (f.data->>'imk_id')::bigint
                WHERE f.farm_id = :farm_id AND NOT rf.banned
                GROUP BY rf.kystvand_id, rf.kystvand_navn
                ORDER BY rf.kystvand_navn NULLS LAST, rf.kystvand_id NULLS LAST
                """
            ),
            {"farm_id": farm_id},
        ).all()

        return [
            KystvandoplandUdledning(
                kystvand_id=row.kystvand_id,
                kystvand_navn=row.kystvand_navn,
                udledningskvote_kg_n=round(float(row.kvote), 1),
                beregnet_udledning_kg_n=round(float(row.udledning), 1),
                overholder=float(row.udledning) <= float(row.kvote),
            )
            for row in rows
        ]


def _member_exists(session: Session, farm_id: str, email: str) -> bool:
    return (
        session.execute(
            select(farm_member_table.c.farm_id).where(
                farm_member_table.c.farm_id == farm_id,
                farm_member_table.c.email == email,
            )
        ).scalar_one_or_none()
        is not None
    )


def _farm_exists(session: Session, farm_id: str, email: str) -> bool:
    return _member_exists(session, farm_id, email)


def _get_farm(session: Session, farm_id: str, email: str) -> Farm | None:
    data = session.execute(
        select(farm_table.c.data)
        .join(farm_member_table, farm_member_table.c.farm_id == farm_table.c.id)
        .where(farm_table.c.id == farm_id, farm_member_table.c.email == email),
    ).scalar_one_or_none()
    return None if data is None else _load(Farm, data)


def _default_allowed_rotation_ids_for_farm(farm: Farm) -> list[str]:
    return ["current", *(rotation.id for rotation in farm.rotation_library)]


def list_farms(email: str) -> list[Farm]:
    with SessionLocal() as session:
        rows = session.execute(
            select(farm_table.c.data)
            .join(farm_member_table, farm_member_table.c.farm_id == farm_table.c.id)
            .where(farm_member_table.c.email == email)
            .order_by(farm_table.c.created_at),
        ).scalars()
        return [_load(Farm, data) for data in rows]


def create_farm(request: CreateFarmRequest, email: str) -> Farm:
    farm = Farm(
        id=str(uuid4()),
        rotation_library=deepcopy(ROTATION_LIBRARY),
        **request.model_dump(),
    )

    with SessionLocal.begin() as session:
        session.execute(
            insert(farm_table).values(
                id=farm.id,
                data=_dump(farm),
            ),
        )
        session.execute(
            insert(farm_member_table).values(farm_id=farm.id, email=email),
        )

    return farm


def get_farm(farm_id: str, email: str) -> Farm | None:
    with SessionLocal() as session:
        return _get_farm(session, farm_id, email)


def delete_farm(farm_id: str, email: str) -> bool:
    with SessionLocal.begin() as session:
        result = session.execute(
            delete(farm_table).where(
                farm_table.c.id == farm_id,
                farm_table.c.id.in_(
                    select(farm_member_table.c.farm_id).where(farm_member_table.c.email == email)
                ),
            )
        )
        return result.rowcount > 0


def list_fields(farm_id: str, email: str) -> list[FieldRecord] | None:
    with SessionLocal() as session:
        if not _farm_exists(session, farm_id, email):
            return None

        rows = session.execute(
            select(field_table.c.data)
            .where(field_table.c.farm_id == farm_id)
            .order_by(field_table.c.created_at),
        ).scalars()
        return [_load(FieldRecord, data) for data in rows]


def _historical_years_for_context(row) -> list[RotationCandidateYearResult]:
    if row is None:
        raise MissingSoilDataError("Registry field is missing or banned")

    soil_data = _soil_data_for_context(row)
    if soil_data is None:
        raise MissingSoilDataError("Registry field has incomplete P/S/Nt data")

    jbnr = row.jbnr if row.jbnr is not None else FALLBACK_JBNR
    percolation_by_kategori, org_n_topsoil, s_soil = soil_data
    return evaluate_real_history_for_field(
        row.crop_history or {},
        jbnr,
        row.goedningsregion,
        bool(row.oeko),
        percolation_by_kategori=percolation_by_kategori,
        org_n_topsoil=org_n_topsoil,
        s_soil=s_soil,
    )


def get_field_historical_years(
    farm_id: str,
    field_id: str,
    email: str,
) -> list[RotationCandidateYearResult] | None:
    with SessionLocal() as session:
        if not _farm_exists(session, farm_id, email):
            return None

        data = session.execute(
            select(field_table.c.data).where(
                field_table.c.id == field_id,
                field_table.c.farm_id == farm_id,
            )
        ).scalar_one_or_none()
        if data is None:
            return None

        field = _load(FieldRecord, data)
        row = _registry_context_for_imk_id(session, field.imk_id)

    return _historical_years_for_context(row)


def get_farm_historical_yearly_summary(farm_id: str, email: str) -> list[dict] | None:
    with SessionLocal() as session:
        if not _farm_exists(session, farm_id, email):
            return None

        field_rows = (
            session.execute(
                select(field_table.c.data)
                .where(field_table.c.farm_id == farm_id)
                .order_by(field_table.c.created_at)
            )
            .scalars()
            .all()
        )
        fields = [_load(FieldRecord, data) for data in field_rows]
        contexts = _registry_contexts_for_imk_ids(
            session,
            list({field.imk_id for field in fields if field.imk_id is not None}),
        )

    start_year = REAL_HISTORY_END_YEAR - 7
    totals: dict[int, dict[str, float]] = {}
    for field in fields:
        context = contexts.get(field.imk_id) if field.imk_id is not None else None
        years = _historical_years_for_context(context)
        retention_factor = 1 - (field.retention or 0) / 100
        for index, year_result in enumerate(years):
            bucket = totals.setdefault(
                start_year + index,
                {"n_load": 0.0, "db2": 0.0, "fen": 0.0, "count": 0},
            )
            # A non-kvotegivende mark does not count toward the udledning
            # comparison at all - it does not draw down a quota, so its real
            # leaching figure must not be summed into it either.
            if context is not None and context.kvotegivende:
                bucket["n_load"] += year_result.leaching_kg_n_ha * field.area_ha * retention_factor
            bucket["db2"] += year_result.db_kr_ha * field.area_ha
            if year_result.db_detail.get("udbytteenhed") == "FE/ha":
                bucket["fen"] += (year_result.db_detail.get("udbytte") or 0.0) * field.area_ha
            bucket["count"] += 1

    return [
        {
            "year": year,
            "total_n_load_kg": data["n_load"],
            "total_db2": data["db2"],
            "total_fen": data["fen"],
            "field_count": int(data["count"]),
        }
        for year, data in sorted(totals.items())
    ]


def upsert_field(farm_id: str, request: CreateFieldRequest, email: str) -> FieldRecord | None:
    with SessionLocal.begin() as session:
        farm = _get_farm(session, farm_id, email)
        if farm is None:
            return None

        existing = None
        if request.imk_id is not None:
            rows = session.execute(
                select(field_table.c.data)
                .where(field_table.c.farm_id == farm_id)
                .order_by(field_table.c.created_at),
            ).scalars()
            existing = next(
                (_load(FieldRecord, data) for data in rows if data.get("imk_id") == request.imk_id),
                None,
            )

        field_id = existing.id if existing is not None else str(uuid4())
        field_data = request.model_dump()

        registry_row = _registry_context_for_imk_id(session, request.imk_id)
        aktuel = _aktuel_field_state(
            registry_row,
            field_data["area_ha"],
            field_data.get("retention"),
        )
        field_data["crop_rotation"] = aktuel["crop_rotation"]
        field = FieldRecord(
            id=field_id,
            farm_id=farm_id,
            db2=aktuel["db2"],
            n_load=aktuel["n_load"],
            leaching=aktuel["leaching"],
            fen=aktuel["fen"],
            jbnr=aktuel["jbnr"],
            kvotegivende=aktuel["kvotegivende"],
            **field_data,
        )

        if existing is None:
            session.execute(
                insert(field_table).values(
                    id=field.id,
                    farm_id=farm_id,
                    data=_dump(field),
                ),
            )
        else:
            session.execute(
                update(field_table)
                .where(field_table.c.id == field.id, field_table.c.farm_id == farm_id)
                .values(data=_dump(field), updated_at=func.now()),
            )

        return field


def detach_field(farm_id: str, field_id: str, email: str) -> bool | None:
    with SessionLocal.begin() as session:
        if not _farm_exists(session, farm_id, email):
            return None

        result = session.execute(
            delete(field_table).where(
                field_table.c.id == field_id,
                field_table.c.farm_id == farm_id,
            ),
        )
        return result.rowcount > 0


def prepare_simulation_field(copied_field, registry_row, request, *, prepared=None):
    """Calculate one field, without opening a database transaction."""
    jbnr = (
        registry_row.jbnr
        if registry_row is not None and registry_row.jbnr is not None
        else FALLBACK_JBNR
    )
    latest_crop_code = (
        registry_row.crop_history.get(str(REAL_HISTORY_END_YEAR))
        if registry_row is not None and registry_row.crop_history
        else None
    )
    latest_crop_code = int(latest_crop_code) if latest_crop_code is not None else None

    soil_data = _soil_data_for_context(registry_row)
    percolation, org_n_topsoil, s_soil = soil_data if soil_data is not None else (None, None, None)

    candidates: list[RotationCandidateEvaluation] = []
    real_history = None
    if registry_row is not None:
        real_history = real_history_lookback(
            registry_row.crop_history or {},
            jbnr,
            registry_row.goedningsregion,
            bool(registry_row.oeko),
        )

        # A mark whose latest real afgrøde is permanent (ikke-omdrift -
        # e.g. frugtplantage, skov, permanent græs) has no meaningful
        # sædskifte to pick from: none of the chosen sædskiftevarianter
        # ever include it. Auto-lock it to a candidate that keeps
        # growing that same afgrøde instead of leaving it with zero
        # candidates and failing "Optimér".
        if is_permanent_afgrode(latest_crop_code):
            permanent_candidate = generate_permanent_crop_candidate(
                latest_crop_code,
                registry_row.crop_history or {},
                jbnr,
                registry_row.goedningsregion,
                bool(registry_row.oeko),
                fdato=request.eea_fdato,
                precision_dagsbasis=request.eea_precision_dagsbasis,
                percolation_by_kategori=percolation,
                org_n_topsoil=org_n_topsoil,
                s_soil=s_soil,
            )
            candidates.append(permanent_candidate)
            locked_id = permanent_candidate.ref.to_id()
            copied_field = copied_field.model_copy(
                update={
                    "rotation_id": locked_id,
                    "allowed_rotation_ids": [locked_id],
                    # Without this, crop_rotation keeps whatever "Tilføj
                    # marker" seeded it with - the mark's actual 2019-2026
                    # history (see evaluate_real_history_for_field above) -
                    # instead of the forward-looking locked afgrøde. The two
                    # only coincidentally match when the history happens to
                    # already be a flat repeat of the 2026 afgrøde.
                    "crop_rotation": [y.year for y in permanent_candidate.years],
                },
            )

    if request.saedskiftevarianter and request.n_norm_procenter:
        candidates.extend(
            generate_candidates_for_field(
                request.saedskiftevarianter,
                request.n_norm_procenter,
                jbnr,
                request.godning,
                fdato=request.eea_fdato,
                precision_dagsbasis=request.eea_precision_dagsbasis,
                praecisionsjordbrug=request.praecisionsjordbrug,
                tidlig_saaning=request.tidlig_saaning,
                mellemafgrode=request.mellemafgrode,
                real_history=real_history,
                percolation_by_kategori=percolation,
                org_n_topsoil=org_n_topsoil,
                s_soil=s_soil,
                prepared=prepared,
            )
        )
    setup = split_field(_dump(copied_field))
    field_candidates = SimulationFieldCandidates(
        field_id=copied_field.id,
        jbnr=jbnr,
        candidates=candidates,
        real_history=real_history,
    )
    if copied_field.allowed_rotation_ids:
        selected = next((c for c in candidates if c.ref.to_id() == copied_field.rotation_id), None)
        if selected:
            setup["fixed_candidate"] = _dump(selected)
    return setup, field_candidates


def create_simulation(
    farm_id: str,
    request: CreateSimulationRequest,
    email: str,
) -> Simulation | None:
    with SessionLocal.begin() as session:
        if not _farm_exists(session, farm_id, email):
            return None

        setup_fields = {}
        field_order = []
        simulation = Simulation(
            id=str(uuid4()),
            farm_id=farm_id,
            name=request.name,
            created_at=datetime.now(UTC).isoformat(),
            constraints=request.constraints,
            rotation_saedskiftevarianter=request.saedskiftevarianter,
            rotation_n_norm_procenter=request.n_norm_procenter,
            godning=request.godning,
            eea_fdato=request.eea_fdato,
            eea_precision_dagsbasis=request.eea_precision_dagsbasis,
            praecisionsjordbrug=request.praecisionsjordbrug,
            tidlig_saaning=request.tidlig_saaning,
            mellemafgrode=request.mellemafgrode,
        )
        session.execute(
            insert(simulation_table).values(
                id=simulation.id,
                farm_id=farm_id,
                data=_dump(simulation),
            ),
        )

        field_rows = (
            session.execute(
                select(field_table.c.data)
                .where(field_table.c.farm_id == farm_id)
                .order_by(field_table.c.created_at),
            )
            .scalars()
            .all()
        )
        current_fields = [_load(FieldRecord, data) for data in field_rows]
        registry_contexts = _registry_contexts_for_imk_ids(
            session,
            [field.imk_id for field in current_fields if field.imk_id is not None],
        )
        for current_field in current_fields:
            field_id = str(uuid4())
            copied_field = current_field.model_copy(
                update={"id": field_id, "geometry": deepcopy(current_field.geometry)},
                deep=True,
            )

            setup, field_candidates = prepare_simulation_field(
                copied_field,
                registry_contexts.get(copied_field.imk_id),
                request,
            )
            setup_fields[copied_field.id] = setup
            field_order.append(copied_field.id)
            if field_candidates.candidates:
                session.execute(
                    insert(simulation_field_candidates_table).values(
                        id=str(uuid4()),
                        simulation_id=simulation.id,
                        field_id=copied_field.id,
                        data=_dump(field_candidates),
                        optimizer_input=optimizer_input(field_candidates),
                    )
                )

        session.execute(
            update(simulation_table)
            .where(simulation_table.c.id == simulation.id)
            .values(fields=setup_fields, field_order=field_order)
        )
        session.execute(insert(simulation_result_table).values(simulation_id=simulation.id))
        return simulation


def list_scenario_afgrodekoder(
    farm_id: str,
    simulation_id: str,
    email: str,
) -> set[int] | None:
    """Return every distinct afgrode_kode the simulering's chosen sædskifter can use.

    A rotation's afgrode_kode per position comes straight from
    saedskifte_library.generate_rotation(saedskiftevariant, variant) - jbnr,
    gødning and every other per-mark input only affect that position's N/DB2/
    udvaskning, never which afgrøde is there
    (candidate_evaluator._strip_disabled_virkemidler only ever clears
    udlæg_kode/udlæg_navn). The set is therefore identical for every mark in
    the simulering and derivable straight from
    simulation.rotation_saedskiftevarianter, without touching
    simulation_field_candidates at all - no per-mark ~1.6 MB candidate set
    (db/leaching breakdown included) needs to be loaded just to read off one
    integer per position.

    This is the data source for "Fravælg en afgrøde" in Optimér's exclusion
    list (api/v0/simulations.py's /afgroder-i-brug), which excludes every
    sædskifte containing the chosen afgrøde - see
    optimization.orchestrator._exclude_afgrodekoder. A permanent-afgrøde
    auto-lock's synthetic "permanent:<afgrode_kode>:100" candidate
    deliberately never appears here even though it never comes from the
    sædskifte library either: that afgrøde isn't in any sædskifte to
    exclude, the mark it belongs to is never a decision variable in the
    first place (orchestrator._build_options/_locked_field_contribution),
    and listing it only invited deselecting a checkbox that could never do
    anything.
    """
    with SessionLocal() as session:
        simulation = _get_simulation(session, farm_id, simulation_id, email)
    if simulation is None:
        return None

    codes: set[int] = set()
    for saedskiftevariant in simulation.rotation_saedskiftevarianter:
        for variant in saedskifte_library.list_variants(saedskiftevariant):
            raw_rotation = saedskifte_library.generate_rotation(saedskiftevariant, variant)
            active_len = saedskifte_library.rotation_active_len(raw_rotation)
            codes.update(
                afgrode_kode
                for afgrode_kode, _, _ in raw_rotation[:active_len]
                if afgrode_kode is not None
            )

    return codes


class FieldNotOptimizedError(Exception):
    """The mark has no winning sædskifte (rotation_id); run Optimér first."""


def list_farm_members(farm_id: str, email: str) -> list[str] | None:
    with SessionLocal() as session:
        if not _member_exists(session, farm_id, email):
            return None
        return list(
            session.execute(
                select(farm_member_table.c.email)
                .where(farm_member_table.c.farm_id == farm_id)
                .order_by(farm_member_table.c.email)
            ).scalars()
        )


def add_farm_member(farm_id: str, email: str, member_email: str) -> str:
    with SessionLocal.begin() as session:
        if not _member_exists(session, farm_id, email):
            return "farm_not_found"
        user = session.execute(
            select(app_user_table.c.email, app_user_table.c.verified_at).where(
                app_user_table.c.email == member_email
            )
        ).first()
        if user is None or user.verified_at is None:
            return "user_not_found"
        if _member_exists(session, farm_id, member_email):
            return "already_member"
        session.execute(insert(farm_member_table).values(farm_id=farm_id, email=member_email))
        return "added"


def remove_farm_member(farm_id: str, email: str, member_email: str) -> str:
    with SessionLocal.begin() as session:
        if not _member_exists(session, farm_id, email):
            return "farm_not_found"
        members = (
            session.execute(
                select(farm_member_table.c.email)
                .where(farm_member_table.c.farm_id == farm_id)
                .with_for_update()
            )
            .scalars()
            .all()
        )
        count = len(members)
        if count <= 1:
            return "last_member"
        result = session.execute(
            delete(farm_member_table).where(
                farm_member_table.c.farm_id == farm_id,
                farm_member_table.c.email == member_email,
            )
        )
        return "removed" if result.rowcount else "member_not_found"
