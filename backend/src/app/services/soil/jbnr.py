"""Real JB-nr (1-12) per mark from registry_field.jbnr.

The value is populated by load_registry.py's ETL from the GeoPackage's JB_Kode
column. Only marker without a registry link, such as manually drawn marker
without imk_id or older rows from before the ETL was fixed, fall back to a
fixed default JB. This is an edge case, not the primary path: almost all marker
have a real JB_Kode-based jbnr.
"""
from __future__ import annotations

from app.domain.registry import RegistryField

FALLBACK_JBNR = 6  # Rough midpoint estimate for farmland, used only without a registry link


def jbnr_for_registry(registry: RegistryField | None) -> int:
    if registry is not None and registry.jbnr is not None:
        return registry.jbnr
    return FALLBACK_JBNR
