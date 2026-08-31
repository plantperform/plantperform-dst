from dataclasses import dataclass
from typing import Literal

from app.domain.rotation_candidate import RotationCandidateEvaluation, RotationYear

OptimizationStatus = Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN"]


@dataclass(frozen=True)
class RotationOption:
    key: str
    id: str
    years: tuple[RotationYear, ...]
    db2: float
    n_load: float
    leaching: float
    fen: float


@dataclass(frozen=True)
class FieldInput:
    id: str
    area_ha: float
    kystvand_id: int | None
    options: tuple[RotationOption, ...]


@dataclass(frozen=True)
class ConstraintsInput:
    # Udledningsloft pr. kystvandopland (nøgle=kystvand_id, None for marker
    # uden et tilknyttet opland) — bekendtgørelsen opgør udledning pr. opland,
    # aldrig samlet på tværs, jf. FarmSidebar's tilsvarende Aktuel-visning.
    # Et opland uden nøgle her er ubegrænset. Kun oplande der faktisk har
    # marker i denne simulering får en håndhævet grænse.
    max_n_load_by_kystvandopland: dict[int | None, float]
    min_fen: float | None
    max_fen: float | None


@dataclass(frozen=True)
class OptimizationInput:
    fields: tuple[FieldInput, ...]
    constraints: ConstraintsInput
    time_limit_seconds: float


@dataclass(frozen=True)
class AssignedRotation:
    field_id: str
    rotation_id: str
    years: tuple[RotationYear, ...]
    db2: float
    n_load: float
    leaching: float
    fen: float


@dataclass(frozen=True)
class OptimizationOutput:
    status: OptimizationStatus
    assignments: tuple[AssignedRotation, ...]
    total_db2: float
    total_n_load_kg: float
    total_leaching_kg: float
    total_fen: float


# ── Fase 11 — "Års-optimering": pr.-kalenderår udledningsloft, DB-udsvings-
# grænse, og automatisk rotations-forskydning (start_year) som ekstra
# beslutningsvariabel. Additivt sideordnet system til RotationOption/
# ConstraintsInput/solve() ovenfor — rører intet af det eksisterende.

@dataclass(frozen=True)
class YearlyRotationOption:
    key: str
    id: str
    candidate: RotationCandidateEvaluation
    years: tuple[RotationYear, ...]
    db2_by_year: tuple[float, ...]
    n_load_by_year: tuple[float, ...]
    leaching_by_year: tuple[float, ...]
    fen: float


@dataclass(frozen=True)
class YearlyFieldInput:
    id: str
    area_ha: float
    kystvand_id: int | None
    options: tuple[YearlyRotationOption, ...]


@dataclass(frozen=True)
class YearlyConstraintsInput:
    # Samme pr.-kystvandopland-princip som ConstraintsInput, men med et
    # 8-langt (pr. kalenderår) loft-tuple pr. opland i stedet for ét tal.
    max_n_load_by_kystvandopland_and_year: dict[int | None, tuple[float | None, ...]]
    db2_swing_pct: float | None
    min_fen: float | None
    max_fen: float | None


@dataclass(frozen=True)
class YearlyOptimizationInput:
    fields: tuple[YearlyFieldInput, ...]
    constraints: YearlyConstraintsInput
    time_limit_seconds: float


@dataclass(frozen=True)
class YearlyOptimizationOutput:
    status: OptimizationStatus
    assignments: tuple[AssignedRotation, ...]
    total_db2: float
    total_n_load_kg: float
    total_leaching_kg: float
    total_fen: float
    total_db2_by_year: tuple[float, ...]
    total_n_load_by_year: tuple[float, ...]
