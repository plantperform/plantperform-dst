from sqlalchemy import text
from sqlalchemy.orm import Session

# Below this zoom, projects render as centroid points (visible as coloured
# dots at country/regional view) instead of their real polygon — same
# zoom-based switch as the much larger registry_field layer, just without
# its bucket-based decimation (only 1,666 rows, no need to thin them out).
MARS_POLYGON_MIN_ZOOM = 11


def get_mars_tile(db: Session, z: int, x: int, y: int) -> bytes:
    geom_expr = (
        "ST_AsMVTGeom(ST_Transform(m.geom, 3857), bounds.geom_3857, 4096, 256, true)"
        if z >= MARS_POLYGON_MIN_ZOOM
        else (
            "ST_AsMVTGeom(ST_Transform(ST_Centroid(m.geom), 3857), "
            "bounds.geom_3857, 4096, 64, true)"
        )
    )
    query = f"""
        WITH bounds AS (
            SELECT
                ST_TileEnvelope(:z, :x, :y) AS geom_3857,
                ST_Transform(ST_TileEnvelope(:z, :x, :y), 4326) AS geom_4326
        ), mvtgeom AS (
            SELECT
                mars_id,
                titel,
                tilskudsordning,
                status,
                virkemiddel,
                areal_ha,
                ansoegningsrunde_aar,
                kvaelstofeffekt_t,
                udtagningseffekt_ha,
                skovrejsningseffekt_ha,
                {geom_expr} AS geom
            FROM mars_projekt AS m, bounds
            WHERE m.geom && bounds.geom_4326
              AND ST_Intersects(m.geom, bounds.geom_4326)
        )
        SELECT ST_AsMVT(mvtgeom, 'mars', 4096, 'geom') AS tile
        FROM mvtgeom
        WHERE geom IS NOT NULL
    """
    row = db.execute(text(query), {"z": z, "x": x, "y": y}).first()
    return bytes(row.tile) if row is not None and row.tile is not None else b""
