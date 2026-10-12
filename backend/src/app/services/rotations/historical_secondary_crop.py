"""What a field's reported catch crop (registry_field.secondary_crop_history)
stands for in the calculation.

The registry only knows that a field had a mandatory or targeted catch crop in
a year. That counts as a catch crop only where one could grow:

- The year's crop must be one a catch crop can follow: the crop table's
  Grund6Procent. On other crops, such as willow, poplar, fallow or grass seed,
  the requirement was met another way, and the field has no secondary crop.
- When next year's crop is grass, clover grass or grass seed (the crop
  table's table 8), the grass established after the harvest is the winter
  cover and met the requirement, as the undersown grass of a rotation does.
  The field has no secondary crop, so no catch crop effect either.
- When next year's crop is sown in the autumn, no catch crop can have stood
  over the winter. The requirement was met by an intermediate crop or early
  sowing instead, whichever the two crops allow, or by neither.
- Otherwise the reported catch crop stands.
"""

from app.services.rotations import afgroede_normer
from app.services.virkemidler import TIDLIG_SAANING_KODE, virkemiddel_tilladt

INTERMEDIATE_CROP_CODE = 9682
EARLY_SOWING_CODE = TIDLIG_SAANING_KODE
# The crop table's "Normal såmåned" August to November.
AUTUMN_SOWING_MONTHS = range(8, 12)
# The two measures have no row in the crop table.
_MEASURE_NAMES = {INTERMEDIATE_CROP_CODE: "Mellemafgrøde", EARLY_SOWING_CODE: "Tidlig såning"}


def is_autumn_sown(crop_code: int | None) -> bool:
    return afgroede_normer.lookup_crop_params(crop_code).get("saamaaned") in AUTUMN_SOWING_MONTHS


def is_grass(crop_code: int | None) -> bool:
    """Whether the crop is grass, clover grass or grass seed: it has a W for
    ploughing in the crop table's table 8."""
    return afgroede_normer.lookup_crop_params(crop_code).get("W_omploejning") is not None


def historical_secondary_crop(
    reported: int | None, crop: int | None, next_crop: int | None
) -> int | None:
    """Return the secondary crop code the calculation uses for a year with the
    reported catch crop, the year's crop and next year's crop, or None for no
    secondary crop. An unknown next crop does not rule out a catch crop."""
    if reported is None or crop is None:
        return None
    if not afgroede_normer.lookup_crop_params(crop).get("grund6procent"):
        return None
    if is_grass(next_crop):
        return None
    if is_autumn_sown(next_crop):
        return next(
            (
                code
                for code in (INTERMEDIATE_CROP_CODE, EARLY_SOWING_CODE)
                if virkemiddel_tilladt(code, crop, next_crop)
            ),
            None,
        )
    return reported


def secondary_crop_name(code: int | None) -> str | None:
    if code is None:
        return None
    return _MEASURE_NAMES.get(code) or afgroede_normer.lookup_crop_params(code).get("navn")
