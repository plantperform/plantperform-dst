"""Which crops can take part of their N-norm in the autumn before harvest.

N spread after 1 August falls in the leaching year of the crop harvested before
it (PUMR, Tabel A, A26 "Mineralsk andel N i efterår"), while it counts against
the norm of the crop harvested after it. That crop must then already stand on
the field in the autumn. Vinterraps, frøgræs and fodergræs are the crops
fertilised in autumn in practice; vinterkorn may be, but rarely is.
"""

_BAR_JORD_KODE = 921
_UDLAEG_TIL_FROE_KODE = 2000

_WINTER_RAPE = (22,)
_SEED_GRASS = (
    101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118,
)
_WINTER_CEREALS = (
    9, 10, 11, 13, 14, 15, 16, 57, 220, 221, 222, 223, 706, 707, 708, 709, 711,
)

_AUTUMN_SOWN = frozenset(_WINTER_RAPE + _WINTER_CEREALS)
_SEED_GRASS_CODES = frozenset(_SEED_GRASS)
# Kløvergræs and græs replace each other in the rotations with no break in the grass.
_INTERCHANGEABLE_GRASS = frozenset({260, 263})


def stands_in_autumn(
    crop: int | None, prev_crop: int | None, prev_secondary: int | None
) -> bool:
    """Whether the crop stands on the field in the autumn before its harvest.

    An autumn-sown crop always does and frøgræs does from its udlæg. Other
    grass only does once it continues from the year before, so a græsudlæg in
    the dæksæd and the grass after it are left out. Kløvergræs and græs continue
    as each other.
    """
    if crop in _AUTUMN_SOWN:
        return True
    if crop in _SEED_GRASS_CODES and prev_secondary == _UDLAEG_TIL_FROE_KODE:
        return True
    continues = crop == prev_crop or {crop, prev_crop} <= _INTERCHANGEABLE_GRASS
    return continues and prev_secondary != _BAR_JORD_KODE
