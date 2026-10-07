from collections import defaultdict
from dataclasses import dataclass

from app.domain.field import FieldRecord
from app.domain.optimization import NUM_YEARS
from app.domain.rotation_candidate import RotationCandidateEvaluation
from app.services.scenario.rotations import selected_locked_candidate


@dataclass(frozen=True)
class CropAreaRange:
    afgrode_kode: int
    min_average_ha: float
    max_average_ha: float
    min_ha_by_year: tuple[float, ...]
    max_ha_by_year: tuple[float, ...]
    yearly_max_average_ha: float


def _codes_by_year(
    candidate: RotationCandidateEvaluation,
    start: int = 0,
) -> tuple[int, ...]:
    active = [year.year.afgrode_kode for year in candidate.years[: candidate.active_len]]
    if not active:
        return ()
    return tuple(active[(start + year) % len(active)] for year in range(NUM_YEARS))


def _shifted_codes_by_year(
    candidate: RotationCandidateEvaluation,
) -> list[tuple[int, ...]]:
    return [_codes_by_year(candidate, start) for start in range(candidate.active_len)]


def crop_area_ranges(
    fields: list[FieldRecord],
    candidates_by_field_id: dict[str, list[RotationCandidateEvaluation]],
) -> list[CropAreaRange]:
    min_average: dict[int, float] = defaultdict(float)
    max_average: dict[int, float] = defaultdict(float)
    min_by_year: dict[int, list[float]] = defaultdict(lambda: [0.0] * NUM_YEARS)
    max_by_year: dict[int, list[float]] = defaultdict(lambda: [0.0] * NUM_YEARS)
    yearly_max_average: dict[int, float] = defaultdict(float)

    for field in fields:
        candidates = candidates_by_field_id.get(field.id, [])
        locked = bool(field.allowed_rotation_ids)
        if locked:
            selected = selected_locked_candidate(field, candidates)
            sequences = [_codes_by_year(selected)] if selected is not None else []
            shifted = sequences
        else:
            sequences = [_codes_by_year(candidate) for candidate in candidates]
            shifted = [
                sequence
                for candidate in candidates
                for sequence in _shifted_codes_by_year(candidate)
            ]
        sequences = [sequence for sequence in sequences if sequence]
        if not sequences:
            continue

        for code in {code for sequence in sequences for code in sequence}:
            counts = [sequence.count(code) for sequence in sequences]
            min_average[code] += field.area_ha * min(counts) / NUM_YEARS
            max_average[code] += field.area_ha * max(counts) / NUM_YEARS
            yearly_max_average[code] += (
                field.area_ha * max(sequence.count(code) for sequence in shifted) / NUM_YEARS
            )
            for year in range(NUM_YEARS):
                if locked:
                    can_grow = must_grow = sequences[0][year] == code
                else:
                    can_grow = max(counts) > 0
                    must_grow = min(counts) == NUM_YEARS
                if can_grow:
                    max_by_year[code][year] += field.area_ha
                if must_grow:
                    min_by_year[code][year] += field.area_ha

    return [
        CropAreaRange(
            afgrode_kode=code,
            min_average_ha=min_average[code],
            max_average_ha=max_average[code],
            min_ha_by_year=tuple(min_by_year[code]),
            max_ha_by_year=tuple(max_by_year[code]),
            yearly_max_average_ha=yearly_max_average[code],
        )
        for code in sorted(max_average)
    ]
