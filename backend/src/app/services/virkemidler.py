"""Shared crop eligibility for scenario-level virkemidler."""

from app.services.rotations import afgroede_normer

# SKH's 2026 faktaark limits præcisionsjordbrug to korn and raps. Maize and
# legumes are deliberately excluded even where source tables group them nearby.
KORN_OG_RAPS_KODER = frozenset({1, 2, 3, 10, 11, 14, 15, 22})

# The rotation lookup's virkemiddel markers in the udlæg column.
MELLEMAFGROEDE_KODER = frozenset({9682, 9684})
TIDLIG_SAANING_KODE = 9683

# The vintersæd the PUMR beslutningstræ (ark W) allows on the field with a
# mellemafgrøde or tidlig såning. It covers the winter after the virkemiddel
# (§ 55, stk. 1, nr. 2); vinterraps is not on the list.
VINTERSAED_EFTER_VIRKEMIDDEL = frozenset({
    10, 11, 13, 14, 15, 16, 17, 57, 70, 71, 72, 220, 221, 222, 223, 224,
})


def virkemiddel_tilladt(
    udlaeg_kode: int | None,
    afgrode_kode: int | None,
    naeste_afgrode_kode: int | None,
) -> bool:
    """Whether a position's mellemafgrøde or tidlig såning is allowed.

    The afgrødetabel's "ME - mellemafgroeder"/"ME - tidlig saaning" flags give
    the hovedafgrøder it may follow, and next year's afgrøde must be on the
    vintersæd list. A naeste_afgrode_kode of None (not known yet) skips that
    check. Every other udlægskode is allowed here.
    """
    if udlaeg_kode in MELLEMAFGROEDE_KODER:
        flag = "mellemafgroede_mulig"
    elif udlaeg_kode == TIDLIG_SAANING_KODE:
        flag = "tidlig_saaning_mulig"
    else:
        return True
    if afgrode_kode is None:
        return False
    if naeste_afgrode_kode is not None and (
        naeste_afgrode_kode not in VINTERSAED_EFTER_VIRKEMIDDEL
    ):
        return False
    return bool(afgroede_normer.lookup_crop_params(afgrode_kode).get(flag))
