"""Bridge between DST2's FieldRecord and the NLES5 engine (nles5_engine.py).

This is a first draft. It keeps `compute_field_metrics(field: FieldRecord)` as the
external interface, and derives everything NLES5 needs *from that interface plus
placeholder assumptions* rather than widening FieldRecord itself. The placeholders
are marked clearly below — replacing them with real data is the natural next step,
not a rewrite of this module's shape.

What is real and derived directly from FieldRecord:
  - M (hovedafgrøde), W (vinterplantedække), MP (forfrugt) — derived from
    `field.crop_rotation`, which turns out to map 1:1 onto NLES5's M1-M13
    (Bilag 2, tabel 3). The rotation is treated as cyclic, matching how it's
    already used in `metrics.py` (`previous_crop = crop_rotation[idx - 1]`).
  - EEA / ETS / precision — derived from `field.measures`.
  - retention — passed straight through, same semantics as our `L_r` step.

What is NOT in FieldRecord today and is stubbed here (see TODOs):
  - Fertiliser inputs (MNCS, MNCA, G0, F0, and the prior-2-years history M1/M2,
    F1/F2, G1/G2) — FieldRecord has no fertilisation data at all. Stubbed as
    per-M-class placeholder norms; the 2-year history is derived by cycling
    back through the rotation's own (placeholder) values rather than needing
    separate "historical year" data, since a rotation here is a repeating
    annual cycle, not tied to a specific calendar year.
  - Soil granularity — FieldRecord only has Soil.SAND / Soil.CLAY (2 classes).
    NLES5 wants JB-nr (1-12) plus clay % (S) and seasonal percolation (P).
    Mapped here to one representative JB-nr per bucket. The real registry
    (`RegistryField.soil_id`) looks like it may carry finer classes before
    being collapsed to SAND/CLAY — worth checking before relying on this.
  - WP (vinterplantedække til forfrugt) — this is a *different* category
    scheme from W (Bilag 2, tabel 9 vs. tabel 5/6/7), and DST2's Crop enum
    doesn't carry enough detail to derive it properly. Defaulted to WP1 (0
    contribution) rather than guessed.
  - Year (Y) — the rotation here is a repeating cycle with no calendar year,
    so the § 23 stk. 4 fixed-WP-for-2027 rule in the engine does not apply;
    Y is left unset (falls back to the categorical WP_p lookup, which is
    moot anyway since WP defaults to WP1).

db2 (dækningsbidrag) is intentionally NOT touched here — it needs crop prices
and cultivation costs, which live in a separate dataset (salgspriser +
dyrkningsomkostninger, keyed by the *fine-grained* afgrødekode, not this
coarse Crop class) and are a separate piece of work.
"""

from app.domain.field import Crop, FieldMeasures, FieldRecord, Soil
from app.services.nles5.engine import calculate_leaching

# --- Crop (DST2, 13 classes) -> NLES5 M-code (Bilag 2, tabel 3) -------------
# This is a clean 1:1 mapping: DST2's Crop enum was evidently already modelled
# on the NLES5 M-classification, same order, same thirteen buckets.
CROP_TO_M: dict[Crop, int] = {
    Crop.CEREAL_WINTER: 1,
    Crop.CEREAL_SPRING: 2,
    Crop.CEREAL_LEGUME_MIX: 3,
    Crop.GRASS_CLOVER: 4,
    Crop.GRASS_SEED: 5,
    Crop.FALLOW: 6,
    Crop.BEET: 7,
    Crop.MAIZE_POTATO: 8,
    Crop.RAPE: 9,
    Crop.CEREAL_WINTER_AFTER_GRASS: 10,
    Crop.MAIZE_AFTER_GRASS: 11,
    Crop.CEREAL_SPRING_AFTER_GRASS: 12,
    Crop.CEREAL_VEG_BEAN: 13,
}

# M-codes whose own vinterplantedække is fixed regardless of what follows
# (Bilag 2, tabel 6, aggregated to M-class level — a crop-code-level table
# would be more precise, but DST2 only carries M-class here).
AUTO_W_BY_M: dict[int, int] = {
    4: 6,  # GRASS_CLOVER -> W6 (græs, kløvergræs, ...)
    5: 6,  # GRASS_SEED -> W6 (frøgræs)
    6: 5,  # FALLOW -> W5 (brak/udtagning)
    7: 6,  # BEET -> W6 (sukkerroer, hamp)
    8: 3,  # MAIZE_POTATO -> W3 (bar jord efter majshelsæd/kartofler)
    9: 6,  # RAPE -> W6 (vinterraps er selv en del af W6-definitionen)
}

# next-year M-code -> this year's W (mirrors streamlit_app.py's _NEXT_M_TO_W,
# i.e. Bilag 2 tabel 6, "hvad sås/pløjes i efteråret afhænger af næste års M").
NEXT_M_TO_W: dict[int, int] = {1: 1, 9: 6, 10: 7, 11: 8, 12: 8}
AUTUMN_SOWN_M = frozenset({1, 9, 10})

# TODO: replace with a real per-crop N-norm lookup (region/JB-aware, like
# lookup_norm() in plantperform-nles). These are rough placeholder MNCS
# defaults (kg N/ha) per M-class, only intended to keep the model runnable.
PLACEHOLDER_MNCS_BY_M: dict[int, float] = {
    1: 180, 2: 140, 3: 100, 4: 0, 5: 60, 6: 0, 7: 150,
    8: 150, 9: 180, 10: 140, 11: 100, 12: 120, 13: 60,
}

# TODO: replace with a real soil/climate lookup keyed by field.imk_id (same
# source as plantperform-nles' mark_input.py). One representative JB-nr per
# SAND/CLAY bucket, plus flat national-average-ish percolation, for now.
_SOIL_DEFAULTS = {
    Soil.SAND: {"jbnr": 2, "AAa": 320, "AAb": 480, "APb": 480},
    Soil.CLAY: {"jbnr": 7, "AAa": 280, "AAb": 400, "APb": 400},
}


def _rotation_w(crop_rotation: list[Crop], index: int) -> int:
    """W for `crop_rotation[index]`, cyclic (a rotation repeats indefinitely)."""
    n = len(crop_rotation)
    next_m = CROP_TO_M[crop_rotation[(index + 1) % n]]

    if next_m in NEXT_M_TO_W:
        return NEXT_M_TO_W[next_m]

    this_m = CROP_TO_M[crop_rotation[index]]
    if this_m in AUTO_W_BY_M:
        return AUTO_W_BY_M[this_m]

    if next_m not in AUTUMN_SOWN_M:
        return 5  # spildkorn/ukrudt ahead of a spring-sown crop

    return 5  # generic fallback until per-crop-code auto_W data is wired up


def _eea_active(measures: FieldMeasures, index: int) -> float:
    return 0.45 if index in measures.cover_crop_years else 0.0


def _sample_for_position(
    crop_rotation: list[Crop],
    soil: Soil,
    measures: FieldMeasures,
    index: int,
) -> dict:
    n = len(crop_rotation)
    m = CROP_TO_M[crop_rotation[index]]
    mp = CROP_TO_M[crop_rotation[(index - 1) % n]]
    w = _rotation_w(crop_rotation, index)
    soil_defaults = _SOIL_DEFAULTS[soil]

    mncs = PLACEHOLDER_MNCS_BY_M[m]
    # "History" (M1/M2) = this rotation's own two preceding positions, cycled —
    # there's no separate historical-year data source here, and a repeating
    # rotation makes "last year" and "two years ago" well-defined regardless.
    m1 = PLACEHOLDER_MNCS_BY_M[CROP_TO_M[crop_rotation[(index - 1) % n]]]
    m2 = PLACEHOLDER_MNCS_BY_M[CROP_TO_M[crop_rotation[(index - 2) % n]]]

    return {
        "Y": None,  # no calendar year in a repeating rotation; § 23 stk. 4 doesn't apply
        "M": m,
        "W": w,
        "MP": mp,
        "WP": 1,  # TODO: needs Bilag 2 tabel 9 category data DST2 doesn't carry yet
        "jbnr": soil_defaults["jbnr"],
        "AAa": soil_defaults["AAa"],
        "AAb": soil_defaults["AAb"],
        "APb": soil_defaults["APb"],
        "CU": 15 if soil == Soil.CLAY else 5,  # rough clay-% stand-in, same TODO as soil
        "NT": 0.5,
        "MNCS": mncs,
        "MNCA": 0,
        "MNudb": 0,
        "M1": m1,
        "M2": m2,
        "F0": 0, "F1": 0, "F2": 0,
        "G0": 0, "G1": 0, "G2": 0,
        "WC": 1,
        "EEA": _eea_active(measures, index),
        "Fdato": "20/8",
        "EMA": 0,
        "ETS": 0.20 if index in measures.early_sowing_years else 0,
        "EPJ": 0.04,
        "precision_dagsbasis": measures.precision_farming,
    }


def field_nles5_metrics(field: FieldRecord) -> tuple[float, float]:
    """Return (leaching, n_load) for a field, averaged over its crop rotation.

    Mirrors the averaging already used in metrics.py's `_field_metric`
    (`sum(values) / len(values)`), so the shape of the result is familiar even
    though the numbers now come from the real NLES5 formula instead of the
    flat 13x13 transition tables.
    """
    if not field.crop_rotation:
        return 0.0, 0.0

    retention = field.retention if field.retention is not None else 0.0
    leaching_values: list[float] = []
    n_load_values: list[float] = []

    for index in range(len(field.crop_rotation)):
        sample = _sample_for_position(field.crop_rotation, field.soil, field.measures, index)
        result = calculate_leaching(sample)
        l_nuar = result["L_nuar"] * field.area_ha
        leaching_values.append(l_nuar)
        n_load_values.append(l_nuar * (100 - retention) / 100)

    n = len(leaching_values)
    return sum(leaching_values) / n, sum(n_load_values) / n
