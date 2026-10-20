"""Set each registry field's gødningsregion from its kystvandopland.

Bilag 3 gives the historical fertiliser allocation (historisk_goedningsfordeling)
per egn, and every kystvandopland belongs to exactly one egn. A field's
gødningsregion therefore follows the kystvand_id that load_kystvandoplande gave
it, so this loader must run after that one.

The kystvandoplande of each egn are listed below, so the loader needs no source
file. A field without a kystvand_id, such as one on a small island outside the
kystvandopland map, or in a kystvandopland the table does not list, gets the
gødningsregion of the nearest field whose kystvandopland the table lists. Its
kystvand_id stays as it is.
"""

from __future__ import annotations

import time

import psycopg

from database.scripts.runtime_lookup_loader import database_dsn

# egn_nr is the Region column in SGAV's "Fordeling af gødning pr. kystvandopland"
# workbook; the names are Bilag 3's regions as historisk_goedningsfordeling
# stores them.
REGION_BY_EGN_NR = {
    1: "Sjælland",
    2: "Fyn",
    3: "Øst og Nordjylland",
    4: "Vestjylland",
    5: "Bornholm",
    6: "Lolland/Falster",
}

# The kystvandoplande ("Opland ID") of each egn ("Egn nr"), as received on
# 2026-10-20.
KYSTVAND_IDS_BY_EGN_NR = {
    1: (
        1, 2, 6, 16, 17, 18, 24, 25, 28, 29, 35, 36, 37, 46, 47, 48, 165, 200, 201, 204, 206,
    ),
    2: (
        59, 62, 68, 72, 74, 80, 82, 83, 84, 85, 86, 87, 89, 90, 92, 93, 95, 96, 212, 214, 216,
        224,
    ),
    3: (
        101, 102, 103, 104, 105, 106, 108, 109, 110, 113, 114, 122, 123, 124, 125, 127, 128,
        136, 137, 138, 139, 140, 141, 142, 144, 145, 146, 147, 154, 158, 159, 160, 217, 219,
        221, 222, 225, 231, 232, 233, 234, 235, 236, 238,
    ),
    4: (107, 111, 119, 120, 121, 129, 130, 131, 132, 133, 157),
    5: (56, 57),
    6: (34, 38, 44, 45, 49, 207, 208, 209),
}

# The KNN index orders by distance in degrees; the nearest of these candidates
# in metres decides.
NEAREST_CANDIDATES = 10


def goedningsregion_by_kystvand_id(
    kystvand_ids_by_egn_nr: dict[int, tuple[int, ...]] = KYSTVAND_IDS_BY_EGN_NR,
) -> dict[int, str]:
    """Return the gødningsregion of each listed kystvand_id."""
    regions: dict[int, str] = {}
    for egn_nr, kystvand_ids in kystvand_ids_by_egn_nr.items():
        for kystvand_id in kystvand_ids:
            if kystvand_id in regions:
                raise ValueError(f"kystvand_id {kystvand_id} is listed under two egne")
            regions[kystvand_id] = REGION_BY_EGN_NR[egn_nr]
    return regions


def load_goedningsregioner(database_url: str | None = None) -> None:
    regions = goedningsregion_by_kystvand_id()

    start = time.monotonic()
    with psycopg.connect(database_dsn(database_url)) as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            CREATE TEMP TABLE goedningsregion_source (
                kystvand_id integer PRIMARY KEY,
                goedningsregion text NOT NULL
            ) ON COMMIT DROP
            """
        )
        cursor.executemany(
            "INSERT INTO goedningsregion_source (kystvand_id, goedningsregion) VALUES (%s, %s)",
            list(regions.items()),
        )
        cursor.execute("ANALYZE goedningsregion_source")

        cursor.execute(
            """
            UPDATE registry_field rf
            SET goedningsregion = source.goedningsregion
            FROM goedningsregion_source source
            WHERE source.kystvand_id = rf.kystvand_id
                AND rf.goedningsregion IS DISTINCT FROM source.goedningsregion
            """
        )
        print(f"Updated {cursor.rowcount:,} fields from their kystvandopland", flush=True)

        cursor.execute(
            """
            UPDATE registry_field rf
            SET goedningsregion = nearest.goedningsregion
            FROM registry_field outside
            CROSS JOIN LATERAL (
                SELECT source.goedningsregion
                FROM (
                    SELECT candidate.kystvand_id, candidate.geom
                    FROM registry_field candidate
                    WHERE candidate.kystvand_id IN (
                        SELECT kystvand_id FROM goedningsregion_source
                    )
                    ORDER BY candidate.geom <-> outside.geom
                    LIMIT %s
                ) candidate
                JOIN goedningsregion_source source USING (kystvand_id)
                ORDER BY ST_Distance(candidate.geom::geography, outside.geom::geography)
                LIMIT 1
            ) nearest
            WHERE outside.imk_id = rf.imk_id
                AND NOT EXISTS (
                    SELECT 1 FROM goedningsregion_source source
                    WHERE source.kystvand_id = outside.kystvand_id
                )
                AND rf.goedningsregion IS DISTINCT FROM nearest.goedningsregion
            """,
            (NEAREST_CANDIDATES,),
        )
        print(f"Updated {cursor.rowcount:,} fields from the nearest field", flush=True)

        cursor.execute(
            """
            SELECT
                rf.goedningsregion,
                COUNT(*),
                COALESCE(SUM(rf.area_ha), 0),
                COUNT(*) FILTER (WHERE source.kystvand_id IS NULL)
            FROM registry_field rf
            LEFT JOIN goedningsregion_source source ON source.kystvand_id = rf.kystvand_id
            GROUP BY rf.goedningsregion
            ORDER BY rf.goedningsregion NULLS LAST
            """
        )
        for region, fields, area_ha, from_nearest in cursor.fetchall():
            print(
                f"  {region or '(none)'}: {fields:,} fields, {area_ha:,.0f} ha, "
                f"{from_nearest:,} of them from the nearest field",
                flush=True,
            )

        cursor.execute(
            """
            SELECT DISTINCT rf.kystvand_id
            FROM registry_field rf
            WHERE rf.kystvand_id IS NOT NULL
                AND rf.kystvand_id NOT IN (SELECT kystvand_id FROM goedningsregion_source)
            ORDER BY rf.kystvand_id
            """
        )
        unlisted = [kystvand_id for (kystvand_id,) in cursor.fetchall()]
        if unlisted:
            print(
                "  kystvand_id not in KYSTVAND_IDS_BY_EGN_NR, given the nearest field's region: "
                f"{', '.join(map(str, unlisted))}",
                flush=True,
            )
        connection.commit()

    print(f"Done in {time.monotonic() - start:.1f}s", flush=True)


if __name__ == "__main__":
    load_goedningsregioner()
