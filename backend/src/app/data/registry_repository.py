import json

from sqlalchemy import RowMapping, text
from sqlalchemy.orm import Session

from app.domain.registry import RegistryBounds, RegistryField, RegistryFieldSummary

# Lowest zoom at which we serve the (decimated) registry as centroid points, and
# the zoom at which we switch to full-resolution polygons.
POINT_MIN_ZOOM = 6
POLYGON_MIN_ZOOM = 11

# Per-zoom cutoff for the hashed sample_bucket (0..1023). A field is included in
# a low-zoom point tile when sample_bucket < cutoff, so density grows with zoom
# and the subsets are nested (dots fill in rather than reshuffle). Tunable.
_POINT_BUCKET_CUTOFFS = {6: 10, 7: 26, 8: 61, 9: 154, 10: 410}


def _bucket_cutoff(z: int) -> int:
    if z <= POINT_MIN_ZOOM:
        return _POINT_BUCKET_CUTOFFS[POINT_MIN_ZOOM]
    return _POINT_BUCKET_CUTOFFS.get(z, 1024)


def get_owned_imk_ids(db: Session, farm_id: str, email: str) -> list[int] | None:
    """Just the imk_ids for a farm's fields — used to flag "owned" tiles.

    Reuses the tile endpoint's own session instead of list_fields(), which
    opens a second pooled connection per call and fully deserializes every
    FieldRecord (geometry included) just to read one id off each — expensive
    and connection-hungry on a path called once per map tile. Still checks
    farm membership itself (same farm_member check list_fields() does), so
    a farm_id the caller isn't a member of can't be probed via this path
    either — returns None when the caller has no access.
    """
    is_member = db.execute(
        text("SELECT 1 FROM farm_member WHERE farm_id = :farm_id AND email = :email"),
        {"farm_id": farm_id, "email": email},
    ).scalar_one_or_none()
    if is_member is None:
        return None

    rows = db.execute(
        text(
            "SELECT (data->>'imk_id')::bigint AS imk_id FROM field "
            "WHERE farm_id = :farm_id AND data->>'imk_id' IS NOT NULL"
        ),
        {"farm_id": farm_id},
    ).scalars()
    return list(rows)


def _summary_from_row(row: RowMapping) -> RegistryFieldSummary:
    return RegistryFieldSummary(
        imk_id=row["imk_id"],
        cvr=row["cvr"],
        marknr=row["marknr"],
        kystvand_id=row["kystvand_id"],
        retention=row["retention"],
        area_ha=row["area_ha"],
        crop_rotation=row["crop_rotation"],
        in_takeout_plan=row["in_takeout_plan"],
        udledningsgraense_kgn_ha=row["udledningsgraense_kgn_ha"],
        udledningskvote_mark_kgn=row["udledningskvote_mark_kgn"],
    )


def _field_from_row(row: RowMapping) -> RegistryField:
    geometry = row["geometry"]
    if isinstance(geometry, str):
        geometry = json.loads(geometry)

    return RegistryField(
        imk_id=row["imk_id"],
        cvr=row["cvr"],
        marknr=row["marknr"],
        markblok=row["markblok"],
        journalnr=row["journalnr"],
        kystvand_id=row["kystvand_id"],
        retention=row["retention"],
        jbnr=row["jbnr"],
        goedningsregion=row["goedningsregion"],
        oeko=bool(row["oeko"]),
        kvotegivende=bool(row["kvotegivende"]),
        area_ha=row["area_ha"],
        crop_rotation=row["crop_rotation"],
        crop_history=row["crop_history"],
        in_takeout_plan=row["in_takeout_plan"],
        udledningsgraense_kgn_ha=row["udledningsgraense_kgn_ha"],
        udledningskvote_mark_kgn=row["udledningskvote_mark_kgn"],
        geometry=geometry,
    )


def search_registry_fields(
    db: Session,
    cvr: str | None = None,
    limit: int = 100,
) -> list[RegistryFieldSummary]:
    limit = max(1, min(limit, 500))
    where_clause = "WHERE cvr = :cvr" if cvr is not None else ""
    query = f"""
        SELECT
            imk_id,
            cvr,
            marknr,
            kystvand_id,
            retention,
            area_ha,
            crop_rotation,
            in_takeout_plan,
            udledningsgraense_kgn_ha,
            udledningskvote_mark_kgn
        FROM registry_field
        {where_clause}
        ORDER BY imk_id
        LIMIT :limit
    """
    rows = db.execute(text(query), {"cvr": cvr, "limit": limit}).mappings().all()
    return [_summary_from_row(row) for row in rows]


def get_registry_field(db: Session, imk_id: int) -> RegistryField | None:
    query = """
        SELECT
            imk_id,
            cvr,
            marknr,
            markblok,
            journalnr,
            kystvand_id,
            retention,
            jbnr,
            goedningsregion,
            oeko,
            kvotegivende,
            area_ha,
            crop_rotation,
            crop_history,
            in_takeout_plan,
            udledningsgraense_kgn_ha,
            udledningskvote_mark_kgn,
            ST_AsGeoJSON(geom)::json AS geometry
        FROM registry_field
        WHERE imk_id = :imk_id
    """
    row = db.execute(text(query), {"imk_id": imk_id}).mappings().first()
    return _field_from_row(row) if row is not None else None


def get_registry_fields(db: Session, imk_ids: list[int]) -> list[RegistryField]:
    if not imk_ids:
        return []

    query = """
        SELECT
            imk_id,
            cvr,
            marknr,
            markblok,
            journalnr,
            kystvand_id,
            retention,
            jbnr,
            goedningsregion,
            oeko,
            kvotegivende,
            area_ha,
            crop_rotation,
            crop_history,
            in_takeout_plan,
            udledningsgraense_kgn_ha,
            udledningskvote_mark_kgn,
            ST_AsGeoJSON(geom)::json AS geometry
        FROM registry_field
        WHERE imk_id = ANY(:imk_ids)
        ORDER BY imk_id
    """
    rows = db.execute(text(query), {"imk_ids": imk_ids}).mappings().all()
    return [_field_from_row(row) for row in rows]


def get_registry_bounds(
    db: Session,
    cvr: str | None = None,
    imk_ids: list[int] | None = None,
) -> RegistryBounds | None:
    imk_ids = imk_ids or []
    if cvr is None and not imk_ids:
        return None

    cvr_clause = "cvr = :cvr" if cvr is not None else "false"
    imk_clause = "imk_id = ANY(:imk_ids)" if imk_ids else "false"
    query = f"""
        SELECT
            ST_XMin(extent)::double precision AS west,
            ST_YMin(extent)::double precision AS south,
            ST_XMax(extent)::double precision AS east,
            ST_YMax(extent)::double precision AS north
        FROM (
            SELECT ST_Extent(geom) AS extent
            FROM registry_field
            WHERE {cvr_clause} OR {imk_clause}
        ) AS bounds
        WHERE extent IS NOT NULL
    """
    row = db.execute(text(query), {"cvr": cvr, "imk_ids": imk_ids}).mappings().first()
    return RegistryBounds(**row) if row is not None else None


def get_registry_tile(
    db: Session,
    z: int,
    x: int,
    y: int,
    cvr: str | None = None,
    focus_cvr: str | None = None,
    owned_imk_ids: list[int] | None = None,
) -> bytes:
    cvr_clause = "AND cvr = :cvr" if cvr is not None else ""
    focus_clause = _focus_clause(focus_cvr, owned_imk_ids or [])
    owned_imk_ids = owned_imk_ids or []
    has_focus = focus_clause != "false"

    # Below the point floor we never serve the full registry; only focus fields
    # (a farmer's own / a highlighted CVR) remain visible when very zoomed out.
    if z < POINT_MIN_ZOOM and not has_focus:
        return b""

    if z >= POLYGON_MIN_ZOOM:
        # Full-resolution polygons (the close-up view).
        union_query = (
            f"{_regular_fields_tile_query(cvr_clause, focus_clause)} "
            f"UNION ALL {_focus_fields_tile_query(focus_clause)}"
        )
    else:
        # Decimated centroid points (the zoomed-out view). Focus fields are
        # always included without decimation so owned/highlighted fields never
        # disappear; regular points are sampled by their hashed bucket.
        focus_points_query = _focus_points_tile_query(focus_clause)
        if z >= POINT_MIN_ZOOM:
            union_query = (
                f"{_regular_points_tile_query(cvr_clause, focus_clause)} "
                f"UNION ALL {focus_points_query}"
            )
        else:
            union_query = focus_points_query

    query = f"""
        WITH bounds AS (
            SELECT
                ST_TileEnvelope(:z, :x, :y) AS geom_3857,
                ST_Transform(ST_TileEnvelope(:z, :x, :y), 4326) AS geom_4326
        ), mvtgeom AS (
            {union_query}
        )
        SELECT ST_AsMVT(mvtgeom, 'fields', 4096, 'geom') AS tile
        FROM mvtgeom
        WHERE geom IS NOT NULL
    """
    row = db.execute(
        text(query),
        {
            "z": z,
            "x": x,
            "y": y,
            "cvr": cvr,
            "focus_cvr": focus_cvr,
            "owned_imk_ids": owned_imk_ids,
            "bucket_cutoff": _bucket_cutoff(z),
        },
    ).first()
    return bytes(row.tile) if row is not None and row.tile is not None else b""


def _focus_clause(focus_cvr: str | None, owned_imk_ids: list[int]) -> str:
    clauses = []
    if focus_cvr is not None:
        clauses.append("cvr = :focus_cvr")
    if owned_imk_ids:
        clauses.append("imk_id = ANY(:owned_imk_ids)")

    return " OR ".join(clauses) if clauses else "false"


def _regular_fields_tile_query(cvr_clause: str, focus_clause: str) -> str:
    return f"""
        SELECT
            imk_id,
            cvr,
            marknr,
            kystvand_id,
            retention,
            jbnr,
            area_ha,
            crop_rotation,
            udledningsgraense_kgn_ha,
            udledningskvote_mark_kgn,
            (in_takeout_plan != 'nej')::int AS in_takeout_plan,
            kvotegivende::int AS kvotegivende,
            CASE WHEN imk_id = ANY(:owned_imk_ids) THEN true ELSE false END AS owned,
            false AS focus,
            ST_AsMVTGeom(ST_Transform(f.geom, 3857), bounds.geom_3857, 4096, 256, true) AS geom
        FROM registry_field AS f, bounds
        WHERE f.geom && bounds.geom_4326
          AND ST_Intersects(f.geom, bounds.geom_4326)
          {cvr_clause}
          AND NOT ({focus_clause})
    """


def _focus_fields_tile_query(focus_clause: str) -> str:
    return f"""
        SELECT
            imk_id,
            cvr,
            marknr,
            kystvand_id,
            retention,
            jbnr,
            area_ha,
            crop_rotation,
            udledningsgraense_kgn_ha,
            udledningskvote_mark_kgn,
            (in_takeout_plan != 'nej')::int AS in_takeout_plan,
            kvotegivende::int AS kvotegivende,
            CASE WHEN imk_id = ANY(:owned_imk_ids) THEN true ELSE false END AS owned,
            true AS focus,
            ST_AsMVTGeom(ST_Transform(f.geom, 3857), bounds.geom_3857, 4096, 256, true) AS geom
        FROM registry_field AS f, bounds
        WHERE f.geom && bounds.geom_4326
          AND ST_Intersects(f.geom, bounds.geom_4326)
          AND ({focus_clause})
    """


def _regular_points_tile_query(cvr_clause: str, focus_clause: str) -> str:
    # Zoomed-out representation: one decimated centroid point per field. Carries
    # only the colour/interaction properties needed by the circle layers, so the
    # tiles stay tiny. Schema is a subset of the polygon tiles (same names).
    return f"""
        SELECT
            imk_id,
            cvr,
            kystvand_id,
            retention,
            jbnr,
            udledningsgraense_kgn_ha,
            udledningskvote_mark_kgn,
            (in_takeout_plan != 'nej')::int AS in_takeout_plan,
            kvotegivende::int AS kvotegivende,
            CASE WHEN imk_id = ANY(:owned_imk_ids) THEN true ELSE false END AS owned,
            false AS focus,
            ST_AsMVTGeom(ST_Transform(f.centroid, 3857), bounds.geom_3857, 4096, 64, true) AS geom
        FROM registry_field AS f, bounds
        WHERE f.centroid && bounds.geom_4326
          AND f.sample_bucket < :bucket_cutoff
          {cvr_clause}
          AND NOT ({focus_clause})
    """


def _focus_points_tile_query(focus_clause: str) -> str:
    # Focus fields (owned farm / highlighted CVR) as points, no decimation, so a
    # farmer's own fields stay visible no matter how far they zoom out.
    return f"""
        SELECT
            imk_id,
            cvr,
            kystvand_id,
            retention,
            jbnr,
            udledningsgraense_kgn_ha,
            udledningskvote_mark_kgn,
            (in_takeout_plan != 'nej')::int AS in_takeout_plan,
            kvotegivende::int AS kvotegivende,
            CASE WHEN imk_id = ANY(:owned_imk_ids) THEN true ELSE false END AS owned,
            true AS focus,
            ST_AsMVTGeom(ST_Transform(f.centroid, 3857), bounds.geom_3857, 4096, 64, true) AS geom
        FROM registry_field AS f, bounds
        WHERE f.centroid && bounds.geom_4326
          AND ({focus_clause})
    """
