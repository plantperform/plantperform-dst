"""Shared helper for reading polygon layers from geodata.fvm.dk's public WFS
(GeoServer, no login required) instead of a manually downloaded shapefile.

Layer names on this server carry a trailing survey year (e.g.
"Paragraf3_i_IMK_2026", "Jordbundskort_2024") and a new year's layer appears
without any "latest" alias, so a loader must not hardcode a year — it asks
GetCapabilities for the newest one each run via resolve_latest_typename.
"""

import re
import time

import httpx
from shapely.geometry import shape

WFS_BASE_URL = "https://geodata.fvm.dk/geoserver/ows"
PAGE_SIZE = 20_000


def resolve_latest_typename(client: httpx.Client, workspace: str, name_prefix: str) -> str:
    """Find the newest year's layer under workspace matching "{name_prefix}{year}".

    Raises ValueError if no matching layer is found, so a renamed or removed
    upstream layer fails loudly instead of silently reusing a stale name.
    """
    response = client.get(
        WFS_BASE_URL,
        params={"service": "WFS", "version": "2.0.0", "request": "GetCapabilities"},
    )
    response.raise_for_status()
    pattern = re.compile(
        rf"<Name>{re.escape(workspace)}:{re.escape(name_prefix)}(\d{{4}})</Name>"
    )
    years = [int(match) for match in pattern.findall(response.text)]
    if not years:
        raise ValueError(
            f"No layer found matching {workspace}:{name_prefix}<year> on {WFS_BASE_URL} "
            "— the upstream layer may have been renamed or removed."
        )
    return f"{workspace}:{name_prefix}{max(years)}"


def fetch_wfs_features(
    client: httpx.Client, typename: str, properties: list[str]
) -> list[dict]:
    """Fetch every feature of typename as {**properties, "fid", "geometry"}.

    "fid" is GeoServer's own feature id (e.g. "Paragraf3_i_IMK_2026.1"),
    stable within one layer version and unique per feature — used as a
    primary key by callers that keep a permanent table, the same role
    mars_id plays for the mars_projekt table.

    Paginates via startIndex/count since GeoServer does not return an
    unbounded result set in one call. Geometry stays in the source CRS
    (EPSG:25832 for this server) — callers reproject as needed, matching the
    existing file-based loaders' own to_crs(4326) step.
    """
    features: list[dict] = []
    start_index = 0
    start = time.monotonic()
    while True:
        response = client.get(
            WFS_BASE_URL,
            params={
                "service": "WFS",
                "version": "2.0.0",
                "request": "GetFeature",
                "typeName": typename,
                "outputFormat": "application/json",
                "count": PAGE_SIZE,
                "startIndex": start_index,
            },
            timeout=120.0,
        )
        response.raise_for_status()
        payload = response.json()
        page = payload["features"]
        for feature in page:
            if feature["geometry"] is None:
                continue
            row = {key: feature["properties"].get(key) for key in properties}
            row["fid"] = feature["id"]
            row["geometry"] = shape(feature["geometry"])
            features.append(row)
        elapsed = time.monotonic() - start
        print(
            f"  fetched {len(features):,} / {payload.get('totalFeatures', '?')} "
            f"from {typename}, elapsed {elapsed:.0f}s",
            flush=True,
        )
        if len(page) < PAGE_SIZE:
            break
        start_index += PAGE_SIZE
    return features
