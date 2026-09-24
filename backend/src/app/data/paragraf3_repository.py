from sqlalchemy import text
from sqlalchemy.orm import Session

# Same zoom-based polygon/centroid switch as mars_repository.get_mars_tile,
# but at ~121,000 rows (vs. MARS's 1,666) each tile query still relies on
# the geom && bounds spatial filter plus the gist index to stay cheap.
PARAGRAF3_POLYGON_MIN_ZOOM = 11


def get_paragraf3_tile(db: Session, z: int, x: int, y: int) -> bytes:
    geom_expr = (
        "ST_AsMVTGeom(ST_Transform(p.geom, 3857), bounds.geom_3857, 4096, 256, true)"
        if z >= PARAGRAF3_POLYGON_MIN_ZOOM
        else (
            "ST_AsMVTGeom(ST_Transform(ST_Centroid(p.geom), 3857), "
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
                fid,
                natyp_navn,
                {geom_expr} AS geom
            FROM paragraf3_omraade AS p, bounds
            WHERE p.geom && bounds.geom_4326
              AND ST_Intersects(p.geom, bounds.geom_4326)
        )
        SELECT ST_AsMVT(mvtgeom, 'paragraf3', 4096, 'geom') AS tile
        FROM mvtgeom
        WHERE geom IS NOT NULL
    """
    row = db.execute(text(query), {"z": z, "x": x, "y": y}).first()
    return bytes(row.tile) if row is not None and row.tile is not None else b""
