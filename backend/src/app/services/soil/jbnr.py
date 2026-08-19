"""Rigtigt JB-nr (1-12) pr. mark, fra registry_field.jbnr (udfyldt af
load_registry.py's ETL fra GeoPackagets JB_Kode-kolonne).

Kun marker uden registreringslink (fx manuelt tegnede marker uden imk_id,
eller ældre rækker fra før ETL'en blev rettet) falder tilbage til et fast
standard-JB. Det er en edge case, ikke hovedvejen — de allerfleste marker
har et rigtigt JB_Kode-baseret jbnr.
"""
from __future__ import annotations

from app.domain.registry import RegistryField

FALLBACK_JBNR = 6  # groft midterskøn for landbrugsjord, kun brugt uden registreringslink


def jbnr_for_registry(registry: RegistryField | None) -> int:
    if registry is not None and registry.jbnr is not None:
        return registry.jbnr
    return FALLBACK_JBNR
