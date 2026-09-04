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
    simulation_field_table,
    simulation_table,
)
from app.domain.farm import CreateFarmRequest, Farm, KystvandoplandUdledning
from app.domain.field import (
    CreateFieldRequest,
    FieldRecord,
    UpdateFieldRequest,
    validate_measures_for_rotation,
)
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationCandidateYearResult,
    SimulationFieldCandidates,
)
from app.domain.rotation_library import ROTATION_LIBRARY
from app.domain.simulation import (
    CreateSimulationRequest,
    OptimizationConstraints,
    Simulation,
)
from app.services.scenario.candidate_evaluator import generate_candidates_for_field
from app.services.scenario.field_history_evaluator import evaluate_real_history_for_field
from app.services.rotations.historisk_goedning import real_history_lookback
from app.services.soil.jbnr import FALLBACK_JBNR


def _dump(model: BaseModel) -> dict:
    return model.model_dump(mode="json")


def _partial_update(model: BaseModel) -> dict:
    return {field: getattr(model, field) for field in model.model_fields_set}


def _load[ModelT: BaseModel](model_type: type[ModelT], data: dict) -> ModelT:
    return model_type.model_validate(data)


def _registry_context_for_imk_id(session: Session, imk_id: int | None):
    """Rå registry_field-kontekst (jbnr/goedningsregion/oeko/crop_history/
    percolation_by_kategori/org_n_topsoil/s_soil) for en imk_id — delt
    grundlag for både "Aktuel"-beregningen og real_history-opslaget til
    2027/2028's bagudkig i sædskifte-scenarier.
    Returnerer None hvis imk_id mangler, ikke findes, eller er banned (jf.
    registry_repository.py's modul-docstring — en banned mark er usynlig
    overalt, ikke kun i markvælgeren).
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


# Antal decimaler P/S/NT-inputtet til NLES5 afrundes til, før det bruges som
# lru_cache-nøgle i bridge_v2.evaluate_leaching_position — explicit
# brugerbeslutning (2026-09-04): kildens fulde float64-præcision (16+
# betydende cifre) gjorde reelt hver eneste mark til sin egen unikke
# cache-nøgle, så cachen holdt op med at genbruges på tværs af marker (se
# evaluate_leaching_position's docstring — det var direkte årsag til at én
# 59-marks simulering brugte flere GB RAM). 3 dechimaler er markens egen
# accepterede fejlmargin for selve udvaskningsberegningen (L), ikke kun for
# P/S/NT hver for sig — givet hvor glat NLES5's (P·S)^ρ-led er omkring disse
# værdiområder, giver 3 decimaler på INPUT god margin til at holde L's egen
# fejl et godt stykke under den grænse, samtidig med at det giver en reel
# chance for at to forskellige marker med lignende jordbund lander på nøjagtig
# samme afrundede værdi og dermed rent faktisk deler en cache-post.
_PERCOLATION_ROUND_DIGITS = 3


def _round_soil_value(value: float | None) -> float | None:
    return round(value, _PERCOLATION_ROUND_DIGITS) if value is not None else None


def _percolation_by_kategori_tuple(
    raw: dict[str, float | None] | None,
) -> tuple[float | None, ...] | None:
    """registry_field.percolation_by_kategori (JSON {"1".."8": værdi}) som en
    hashbar, afrundet 8-tuple (index 0 = kategori 1) til bridge_v2.evaluate_
    leaching_position, som er lru_cache'et og derfor ikke kan tage et
    dict-argument (og hvis nøgle skal kunne genbruges på tværs af marker, se
    _PERCOLATION_ROUND_DIGITS)."""
    if raw is None:
        return None
    return tuple(_round_soil_value(raw.get(str(kategori))) for kategori in range(1, 9))


def get_registry_percolation_context(
    imk_id: int | None,
) -> tuple[tuple[float | None, ...] | None, float | None, float | None]:
    """(percolation_by_kategori, org_n_topsoil, s_soil) for en imk_id, klar til
    bridge_v2.evaluate_leaching_position — (None, None, None) hvis marken
    mangler/ikke findes/er banned. Offentlig, session-ejende udgave af
    _registry_context_for_imk_id's samme tre felter, til brug fra
    services.optimization.orchestrator (Års-optimering/Rediger manuelt),
    som ikke selv har en session liggende og har brug for netop disse tre —
    IKKE jbnr/goedningsregion/oeko/crop_history, som allerede kommer fra
    SimulationFieldCandidates for de kaldere."""
    with SessionLocal() as session:
        row = _registry_context_for_imk_id(session, imk_id)
        if row is None:
            return None, None, None
        return (
            _percolation_by_kategori_tuple(row.percolation_by_kategori),
            _round_soil_value(row.org_n_topsoil),
            _round_soil_value(row.s_soil),
        )


def _aktuel_field_state(session: Session, imk_id: int | None, area_ha: float, retention: float | None) -> dict:
    """"Aktuel"-tilstand (db2/n_load/leaching/fen) beregnet ud fra markens
    egen ægte crop_history og den historiske gødningstildeling (Bilag 3) —
    ingen scenarie/gødnings-slider involveret. Bruges ved "Tilføj marker" i
    stedet for de hidtidige hardkodede 0'er.
    """
    fallback = {
        "jbnr": FALLBACK_JBNR, "db2": 0.0, "n_load": 0.0, "leaching": 0.0, "fen": 0.0,
        "crop_rotation": [], "kvotegivende": False,
    }
    row = _registry_context_for_imk_id(session, imk_id)
    if row is None:
        return fallback

    jbnr = row.jbnr if row.jbnr is not None else FALLBACK_JBNR
    years = evaluate_real_history_for_field(
        row.crop_history or {}, jbnr, row.goedningsregion, bool(row.oeko),
        percolation_by_kategori=_percolation_by_kategori_tuple(row.percolation_by_kategori),
        org_n_topsoil=_round_soil_value(row.org_n_topsoil), s_soil=_round_soil_value(row.s_soil),
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
        # Ægte 2019-2026-afgrøder (samme 8 positioner som beregningen ovenfor)
        # — vist i "Aktuel"-markoversigten med rigtige kalenderår, jf. bruger-
        # ønske om at se historikken ligesom scenariernes fremadrettede år.
        "crop_rotation": [y.year for y in years],
        "kvotegivende": bool(row.kvotegivende),
    }


def get_farm_udledning_per_kystvandopland(
    farm_id: str, email: str,
) -> list[KystvandoplandUdledning] | None:
    """Udledningskvote og beregnet udledning ("Aktuel", dvs. FieldRecord.n_load)
    grupperet pr. kystvandopland — bekendtgørelsen opgør begge dele pr. opland,
    aldrig samlet på tværs (se KystvandoplandUdledning). Marker uden imk_id
    (fx manuelt tegnede) matcher ingen registry_field-række og indgår derfor
    ikke i nogen gruppe, samme afgrænsning som den tidligere flade sum havde.
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
                    COALESCE(SUM((f.data->>'n_load')::float), 0) AS udledning
                FROM field f
                JOIN registry_field rf ON rf.imk_id = (f.data->>'imk_id')::bigint
                WHERE f.farm_id = :farm_id
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


def _get_simulation(
    session: Session,
    farm_id: str,
    simulation_id: str,
    email: str,
) -> Simulation | None:
    data = session.execute(
        select(simulation_table.c.data)
        .join(farm_member_table, farm_member_table.c.farm_id == simulation_table.c.farm_id)
        .where(
            simulation_table.c.id == simulation_id,
            simulation_table.c.farm_id == farm_id,
            farm_member_table.c.email == email,
        )
    ).scalar_one_or_none()
    return None if data is None else _load(Simulation, data)


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
            delete(farm_table)
            .where(
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


def get_field(farm_id: str, field_id: str, email: str) -> FieldRecord | None:
    """Én mark — filtreret direkte i SQL'en, i modsætning til list_fields som
    henter ALLE bedriftens marker. Samme begrundelse som get_simulation_field
    (dens søster i simulation_field_table)."""
    with SessionLocal() as session:
        if not _farm_exists(session, farm_id, email):
            return None

        data = session.execute(
            select(field_table.c.data).where(
                field_table.c.id == field_id,
                field_table.c.farm_id == farm_id,
            ),
        ).scalar_one_or_none()
        return _load(FieldRecord, data) if data is not None else None


def get_farm_historical_yearly_summary(farm_id: str, email: str) -> list[dict] | None:
    """Som services.optimization.orchestrator.compute_yearly_summary, men for
    "Afgrødehistorik" i stedet for en simulering: summér db2/kvælstofudledning
    (retentionskorrigeret)/foderenheder pr. KALENDERÅR (2019-2026 — rigtige
    år, ikke simuleringens relative position 1-8, da historikken allerede har
    faste år) på tværs af bedriftens egne rigtige marker. Returnerer
    dict-rækker (year/total_n_load_kg/total_db2/total_fen/field_count) i
    stedet for orchestrator's YearlySummaryEntry-dataclass for at undgå et
    repository→services-importkredsløb (orchestrator importerer allerede
    `repository`).

    Én batched registry-forespørgsel for ALLE marker, ikke ét opslag pr. mark
    (samme O(marker²)-fælde som candidate-detail havde før 2026-09-04's
    rettelse — undgået fra starten her)."""
    fields = list_fields(farm_id, email)
    if fields is None:
        return None

    imk_ids = [f.imk_id for f in fields if f.imk_id is not None]
    with SessionLocal() as session:
        rows = session.execute(
            select(
                registry_field_table.c.imk_id,
                registry_field_table.c.jbnr,
                registry_field_table.c.goedningsregion,
                registry_field_table.c.oeko,
                registry_field_table.c.crop_history,
                registry_field_table.c.percolation_by_kategori,
                registry_field_table.c.org_n_topsoil,
                registry_field_table.c.s_soil,
            ).where(
                registry_field_table.c.imk_id.in_(imk_ids),
                registry_field_table.c.banned.is_(False),
            ),
        ).all() if imk_ids else []
    context_by_imk_id = {row.imk_id: row for row in rows}

    totals: dict[int, dict[str, float]] = {}
    for field in fields:
        row = context_by_imk_id.get(field.imk_id) if field.imk_id is not None else None
        if row is None:
            continue

        jbnr = row.jbnr if row.jbnr is not None else FALLBACK_JBNR
        years = evaluate_real_history_for_field(
            row.crop_history or {}, jbnr, row.goedningsregion, bool(row.oeko),
            percolation_by_kategori=_percolation_by_kategori_tuple(row.percolation_by_kategori),
            org_n_topsoil=_round_soil_value(row.org_n_topsoil),
            s_soil=_round_soil_value(row.s_soil),
        )
        retention_factor = 1 - (field.retention or 0) / 100
        for year_result in years:
            calendar_year = year_result.leaching_detail.get("Y")
            if calendar_year is None:
                continue
            bucket = totals.setdefault(
                int(calendar_year), {"n_load": 0.0, "db2": 0.0, "fen": 0.0, "count": 0},
            )
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


def get_field_historical_years(
    farm_id: str, field_id: str, email: str,
) -> list[RotationCandidateYearResult] | None:
    """Markens egen ægte 8-positions historik (2019-2026) med fuld
    leaching_detail/db_detail pr. år, jf. _aktuel_field_state — men den fulde
    liste i stedet for kun de aggregerede db2/n_load/leaching/fen-summer, til
    "Afgrødehistorik"-visningens beregningsgennemgang (samme UI-komponent,
    RotationYearsDetail, som simulerings-kandidaters). Returnerer None hvis
    marken/bedriften ikke findes."""
    field = get_field(farm_id, field_id, email)
    if field is None:
        return None

    with SessionLocal() as session:
        row = _registry_context_for_imk_id(session, field.imk_id)
    if row is None:
        return []

    jbnr = row.jbnr if row.jbnr is not None else FALLBACK_JBNR
    return list(
        evaluate_real_history_for_field(
            row.crop_history or {}, jbnr, row.goedningsregion, bool(row.oeko),
            percolation_by_kategori=_percolation_by_kategori_tuple(row.percolation_by_kategori),
            org_n_topsoil=_round_soil_value(row.org_n_topsoil),
            s_soil=_round_soil_value(row.s_soil),
        )
    )


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

        aktuel = _aktuel_field_state(
            session, request.imk_id, field_data["area_ha"], field_data.get("retention"),
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


def list_simulations(farm_id: str, email: str) -> list[Simulation] | None:
    with SessionLocal() as session:
        if not _farm_exists(session, farm_id, email):
            return None

        rows = session.execute(
            select(simulation_table.c.data)
            .where(simulation_table.c.farm_id == farm_id)
            .order_by(simulation_table.c.created_at),
        ).scalars()
        return [_load(Simulation, data) for data in rows]


def create_simulation(
    farm_id: str,
    request: CreateSimulationRequest,
    email: str,
) -> Simulation | None:
    with SessionLocal.begin() as session:
        if not _farm_exists(session, farm_id, email):
            return None

        simulation = Simulation(
            id=str(uuid4()),
            farm_id=farm_id,
            name=request.name,
            created_at=datetime.now(UTC).isoformat(),
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

        rows = session.execute(
            select(field_table.c.data)
            .where(field_table.c.farm_id == farm_id)
            .order_by(field_table.c.created_at),
        ).scalars()
        for data in rows:
            current_field = _load(FieldRecord, data)
            field_id = str(uuid4())
            copied_field = current_field.model_copy(
                update={"id": field_id, "geometry": deepcopy(current_field.geometry)},
                deep=True,
            )
            session.execute(
                insert(simulation_field_table).values(
                    id=copied_field.id,
                    simulation_id=simulation.id,
                    data=_dump(copied_field),
                ),
            )

            if request.saedskiftevarianter and request.n_norm_procenter:
                registry_row = _registry_context_for_imk_id(session, copied_field.imk_id)
                jbnr = (
                    registry_row.jbnr
                    if registry_row is not None and registry_row.jbnr is not None
                    else FALLBACK_JBNR
                )
                real_history = (
                    real_history_lookback(
                        registry_row.crop_history or {}, jbnr,
                        registry_row.goedningsregion, bool(registry_row.oeko),
                    )
                    if registry_row is not None
                    else None
                )
                percolation_by_kategori = (
                    _percolation_by_kategori_tuple(registry_row.percolation_by_kategori)
                    if registry_row is not None
                    else None
                )
                org_n_topsoil = (
                    _round_soil_value(registry_row.org_n_topsoil)
                    if registry_row is not None else None
                )
                s_soil = (
                    _round_soil_value(registry_row.s_soil)
                    if registry_row is not None else None
                )
                candidates = generate_candidates_for_field(
                    request.saedskiftevarianter, request.n_norm_procenter, jbnr,
                    request.godning,
                    fdato=request.eea_fdato, precision_dagsbasis=request.eea_precision_dagsbasis,
                    praecisionsjordbrug=request.praecisionsjordbrug,
                    tidlig_saaning=request.tidlig_saaning, mellemafgrode=request.mellemafgrode,
                    percolation_by_kategori=percolation_by_kategori,
                    org_n_topsoil=org_n_topsoil, s_soil=s_soil,
                    real_history=real_history,
                )
                field_candidates = SimulationFieldCandidates(
                    field_id=copied_field.id, jbnr=jbnr, candidates=candidates,
                    real_history=real_history,
                )
                session.execute(
                    insert(simulation_field_candidates_table).values(
                        id=str(uuid4()),
                        simulation_id=simulation.id,
                        field_id=copied_field.id,
                        data=_dump(field_candidates),
                    ),
                )

        return simulation


def get_simulation(farm_id: str, simulation_id: str, email: str) -> Simulation | None:
    with SessionLocal() as session:
        return _get_simulation(session, farm_id, simulation_id, email)


def list_simulation_field_candidates(
    farm_id: str, simulation_id: str, email: str,
) -> list[SimulationFieldCandidates] | None:
    with SessionLocal() as session:
        if _get_simulation(session, farm_id, simulation_id, email) is None:
            return None

        rows = session.execute(
            select(simulation_field_candidates_table.c.data)
            .where(simulation_field_candidates_table.c.simulation_id == simulation_id),
        ).scalars()
        return [_load(SimulationFieldCandidates, data) for data in rows]


def list_scenario_afgrodekoder(
    farm_id: str, simulation_id: str, email: str,
) -> set[int] | None:
    """Alle distinkte afgrødekoder der forekommer i simuleringens gemte
    sædskifte-kandidater, på tværs af alle marker — kildedata til crop-
    udelukkelseslisten i Optimér/Års-optimering (orchestrator's
    excluded_afgrodekoder-filter)."""
    with SessionLocal() as session:
        if _get_simulation(session, farm_id, simulation_id, email) is None:
            return None

        rows = session.execute(
            select(simulation_field_candidates_table.c.data)
            .where(simulation_field_candidates_table.c.simulation_id == simulation_id),
        ).scalars()
        codes: set[int] = set()
        for data in rows:
            field_candidates = _load(SimulationFieldCandidates, data)
            for candidate in field_candidates.candidates:
                for year_result in candidate.years[: candidate.active_len]:
                    if year_result.year.afgrode_kode is not None:
                        codes.add(year_result.year.afgrode_kode)
        return codes


def get_simulation_field_candidates(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    email: str,
) -> SimulationFieldCandidates | None:
    """Én marks gemte kandidatmængde — filtreret direkte i SQL'en, i
    modsætning til list_simulation_field_candidates som henter ALLE marker i
    simuleringens fulde kandidatmængder (inkl. hver kandidats år-for-år
    udvasknings-/DB-detalje). Brug denne når kun én mark er relevant (fx
    "Rediger manuelt"s preview/apply, som kun læser candidates_row.jbnr) —
    undgår at hente og deserialisere resten af simuleringens marker forgæves."""
    with SessionLocal() as session:
        if _get_simulation(session, farm_id, simulation_id, email) is None:
            return None

        data = session.execute(
            select(simulation_field_candidates_table.c.data).where(
                simulation_field_candidates_table.c.simulation_id == simulation_id,
                simulation_field_candidates_table.c.field_id == field_id,
            ),
        ).scalar_one_or_none()
        return _load(SimulationFieldCandidates, data) if data is not None else None


def append_manual_field_candidate(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    candidate: RotationCandidateEvaluation,
    email: str,
) -> bool:
    """Føjer en manuelt genberegnet kandidat (Fase 10 — "Rediger manuelt")
    til markens gemte kandidatmængde. Erstatter en evt. tidligere kandidat
    med samme ref-id i stedet for at ophobe en historik — kun "seneste
    manuelle rettelse for denne mark" er meningsfuld at beholde."""
    with SessionLocal.begin() as session:
        if _get_simulation(session, farm_id, simulation_id, email) is None:
            return False

        row = session.execute(
            select(simulation_field_candidates_table.c.id, simulation_field_candidates_table.c.data)
            .where(
                simulation_field_candidates_table.c.simulation_id == simulation_id,
                simulation_field_candidates_table.c.field_id == field_id,
            ),
        ).one_or_none()
        if row is None:
            return False

        row_id, data = row
        field_candidates = _load(SimulationFieldCandidates, data)
        ref_id = candidate.ref.to_id()
        kept = [c for c in field_candidates.candidates if c.ref.to_id() != ref_id]
        updated = field_candidates.model_copy(update={"candidates": [*kept, candidate]})
        session.execute(
            update(simulation_field_candidates_table)
            .where(simulation_field_candidates_table.c.id == row_id)
            .values(data=_dump(updated)),
        )
        return True


class FieldNotOptimizedError(Exception):
    """Marken har endnu ikke et vindende sædskifte (rotation_id) — kør Optimér først."""


def get_simulation_field_candidate_detail(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    email: str,
) -> RotationCandidateEvaluation | None:
    """Den fulde beregningsdetalje (leaching_detail/db_detail pr. år) for den
    kandidat Optimér har valgt til denne mark. Returnerer None hvis
    marken/simuleringen ikke findes; rejser FieldNotOptimizedError hvis marken
    endnu ikke er blevet optimeret (intet rotation_id sat)."""
    with SessionLocal() as session:
        if _get_simulation(session, farm_id, simulation_id, email) is None:
            return None

        field_data = session.execute(
            select(simulation_field_table.c.data).where(
                simulation_field_table.c.id == field_id,
                simulation_field_table.c.simulation_id == simulation_id,
            ),
        ).scalar_one_or_none()
        if field_data is None:
            return None

        field = _load(FieldRecord, field_data)
        if field.rotation_id is None:
            raise FieldNotOptimizedError

        candidates_data = session.execute(
            select(simulation_field_candidates_table.c.data).where(
                simulation_field_candidates_table.c.simulation_id == simulation_id,
                simulation_field_candidates_table.c.field_id == field_id,
            ),
        ).scalar_one_or_none()
        if candidates_data is None:
            return None

        field_candidates = _load(SimulationFieldCandidates, candidates_data)
        return next(
            (
                candidate
                for candidate in field_candidates.candidates
                if candidate.ref.to_id() == field.rotation_id
            ),
            None,
        )


def delete_simulation(farm_id: str, simulation_id: str, email: str) -> bool | None:
    with SessionLocal.begin() as session:
        if not _farm_exists(session, farm_id, email):
            return None

        result = session.execute(
            delete(simulation_table).where(
                simulation_table.c.id == simulation_id,
                simulation_table.c.farm_id == farm_id,
            ),
        )
        return result.rowcount > 0


def update_simulation_constraints(
    farm_id: str,
    simulation_id: str,
    constraints: OptimizationConstraints,
    email: str,
) -> Simulation | None:
    with SessionLocal.begin() as session:
        simulation = _get_simulation(session, farm_id, simulation_id, email)
        if simulation is None:
            return None

        max_fields = constraints.max_fields_with_new_rotation
        field_count = session.execute(
            select(func.count()).where(
                simulation_field_table.c.simulation_id == simulation_id,
            ),
        ).scalar_one()
        if max_fields is not None and max_fields > field_count:
            raise ValueError(
                "Maximum fields with new rotations cannot exceed the simulation field count"
            )

        if constraints.globally_allowed_rotation_ids is not None:
            farm = _get_farm(session, farm_id, email)
            if farm is None:
                return None
            library_ids = {rotation.id for rotation in farm.rotation_library}
            unknown = [
                rotation_id
                for rotation_id in constraints.globally_allowed_rotation_ids
                if rotation_id not in library_ids
            ]
            if unknown:
                raise ValueError(f"Unknown globally allowed rotation id: {unknown[0]}")

        updated_simulation = simulation.model_copy(
            update={"constraints": constraints},
            deep=True,
        )
        session.execute(
            update(simulation_table)
            .where(
                simulation_table.c.id == simulation_id,
                simulation_table.c.farm_id == farm_id,
            )
            .values(data=_dump(updated_simulation), updated_at=func.now()),
        )
        return updated_simulation


def list_simulation_fields(
    farm_id: str,
    simulation_id: str,
    email: str,
) -> list[FieldRecord] | None:
    with SessionLocal() as session:
        if _get_simulation(session, farm_id, simulation_id, email) is None:
            return None

        rows = session.execute(
            select(simulation_field_table.c.data)
            .where(simulation_field_table.c.simulation_id == simulation_id)
            .order_by(simulation_field_table.c.created_at),
        ).scalars()
        return [_load(FieldRecord, data) for data in rows]


def get_simulation_field(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    email: str,
) -> FieldRecord | None:
    """Én mark — filtreret direkte i SQL'en, i modsætning til
    list_simulation_fields som henter ALLE simuleringens marker. Samme
    begrundelse som get_simulation_field_candidates: brug denne når kun én
    mark er relevant (fx get_field_candidate_detail's fallback), undgår at
    hente og deserialisere resten af simuleringens marker forgæves."""
    with SessionLocal() as session:
        if _get_simulation(session, farm_id, simulation_id, email) is None:
            return None

        data = session.execute(
            select(simulation_field_table.c.data).where(
                simulation_field_table.c.id == field_id,
                simulation_field_table.c.simulation_id == simulation_id,
            ),
        ).scalar_one_or_none()
        return _load(FieldRecord, data) if data is not None else None


def update_simulation_field(
    farm_id: str,
    simulation_id: str,
    field_id: str,
    request: UpdateFieldRequest,
    email: str,
) -> FieldRecord | None:
    with SessionLocal.begin() as session:
        if _get_simulation(session, farm_id, simulation_id, email) is None:
            return None

        data = session.execute(
            select(simulation_field_table.c.data).where(
                simulation_field_table.c.id == field_id,
                simulation_field_table.c.simulation_id == simulation_id,
            ),
        ).scalar_one_or_none()
        if data is None:
            return None

        existing = _load(FieldRecord, data)
        field = existing.model_copy(update=_partial_update(request), deep=True)
        validate_measures_for_rotation(field.measures, field.crop_rotation)
        session.execute(
            update(simulation_field_table)
            .where(
                simulation_field_table.c.id == field_id,
                simulation_field_table.c.simulation_id == simulation_id,
            )
            .values(data=_dump(field), updated_at=func.now()),
        )
        return field


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
        session.execute(
            insert(farm_member_table).values(farm_id=farm_id, email=member_email)
        )
        return "added"


def remove_farm_member(farm_id: str, email: str, member_email: str) -> str:
    with SessionLocal.begin() as session:
        if not _member_exists(session, farm_id, email):
            return "farm_not_found"
        members = session.execute(
            select(farm_member_table.c.email)
            .where(farm_member_table.c.farm_id == farm_id)
            .with_for_update()
        ).scalars().all()
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
