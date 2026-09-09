import math
from collections.abc import Mapping
from typing import cast

PERCOLATION_ROUND_DIGITS = 3
PercolationByKategori = tuple[float, float, float, float, float, float, float, float]
RegistrySoilData = tuple[PercolationByKategori, float, float]


class MissingSoilDataError(Exception):
    """A field has no complete, real P/S/Nt input set for NLES5."""


def registry_soil_data(
    percolation: Mapping[str, float | None] | None,
    org_n_topsoil: float | None,
    s_soil: float | None,
) -> RegistrySoilData | None:
    if percolation is None or org_n_topsoil is None or s_soil is None:
        return None

    values = tuple(percolation.get(str(kategori)) for kategori in range(1, 9))
    if any(value is None or not math.isfinite(float(value)) for value in values):
        return None

    rounded = tuple(round(float(value), PERCOLATION_ROUND_DIGITS) for value in values)
    if not math.isfinite(org_n_topsoil) or not math.isfinite(s_soil):
        return None
    return (
        cast(PercolationByKategori, rounded),
        round(float(org_n_topsoil), PERCOLATION_ROUND_DIGITS),
        round(float(s_soil), PERCOLATION_ROUND_DIGITS),
    )
