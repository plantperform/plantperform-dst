"""Derived solver inputs; full calculation details remain in the candidate cache."""

from app.domain.base import CamelModel
from app.domain.rotation_candidate import (
    RotationCandidateEvaluation,
    RotationYear,
    SimulationFieldCandidates,
)


class OptimizerYear(CamelModel):
    year: RotationYear
    leaching_kg_n_ha: float
    db_kr_ha: float
    fen_fe_ha: float


class OptimizerCandidate(RotationCandidateEvaluation):
    years: list[OptimizerYear]


class OptimizerFieldCandidates(SimulationFieldCandidates):
    candidates: list[OptimizerCandidate]


def optimizer_input(data: SimulationFieldCandidates) -> dict:
    compact = data.model_dump(
        mode="json",
        include={
            "field_id": True,
            "jbnr": True,
            "real_history": True,
            "candidates": {
                "__all__": {
                    "ref": True,
                    "base_ref": True,
                    "overrides": True,
                    "start_year": True,
                    "active_len": True,
                    "avg_leaching_kg_n_ha": True,
                    "avg_db_kr_ha": True,
                    "avg_fen": True,
                    "years": {
                        "__all__": {"year", "leaching_kg_n_ha", "db_kr_ha"},
                    },
                },
            },
        },
    )
    # Yearly foderenheder come from db_detail, which the compact input omits.
    for candidate, compact_candidate in zip(data.candidates, compact["candidates"], strict=True):
        for year, compact_year in zip(candidate.years, compact_candidate["years"], strict=True):
            compact_year["fen_fe_ha"] = year.fen_fe_ha
    return compact


def parse_optimizer_input(data: dict) -> SimulationFieldCandidates:
    # Validate only solver inputs. Full reporting models are restored for winners.
    row = OptimizerFieldCandidates.model_validate(data)
    for position, candidate in enumerate(row.candidates):
        candidate._cache_position = position
    return row
