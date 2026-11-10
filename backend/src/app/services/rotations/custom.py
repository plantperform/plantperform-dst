"""Request/job-local definitions. Private rotations never enter global lookup caches."""

from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from itertools import product
from math import prod

from app.data import rotation_snapshot_store
from app.domain.saedskifte import RotationDefinitionError, RotationGroupSnapshot
from app.domain.saedskifte import is_custom as is_custom
from app.services.rotations import choices

MAX_CUSTOM_CANDIDATES = 4096
CUSTOM_CATEGORY = "Egne sædskifter"
_groups: ContextVar[dict[str, RotationGroupSnapshot] | None] = ContextVar(
    "rotation_groups", default=None
)
_driftsform: ContextVar[str | None] = ContextVar("rotation_driftsform", default=None)
_options_cache: ContextVar[dict | None] = ContextVar("rotation_options", default=None)
_names: ContextVar[dict | None] = ContextVar("rotation_udlaeg_names", default=None)
_disabled: ContextVar[frozenset[int]] = ContextVar(
    "disabled_rotation_measures", default=frozenset()
)


def current_groups():
    return _groups.get() or {}


@contextmanager
def rotation_scope(groups, driftsform=None):
    resolved = {
        key: RotationGroupSnapshot.model_validate(value) for key, value in (groups or {}).items()
    }
    token = _groups.set(resolved)
    form_token = _driftsform.set(driftsform)
    options_token = _options_cache.set({})
    names_token = _names.set(None)
    disabled_token = _disabled.set(frozenset())
    try:
        yield
    finally:
        _disabled.reset(disabled_token)
        _names.reset(names_token)
        _options_cache.reset(options_token)
        _driftsform.reset(form_token)
        _groups.reset(token)


@contextmanager
def simulation_scope(simulation):
    groups = getattr(simulation, "rotation_groups", None)
    if groups is None:
        groups = rotation_snapshot_store.load_selected(simulation.rotation_saedskiftevarianter)
    with (
        rotation_scope(groups, simulation.godning.driftsform),
        measure_scope(simulation.tidlig_saaning, simulation.mellemafgrode),
    ):
        yield groups


@contextmanager
def measure_scope(tidlig_saaning=True, mellemafgrode=True):
    disabled = (set() if tidlig_saaning else {9683}) | (set() if mellemafgrode else {9682, 9684})
    token = _disabled.set(frozenset(disabled))
    try:
        yield
    finally:
        _disabled.reset(token)


def with_simulation_rotations(function):
    @wraps(function)
    def scoped(simulation, *args, **kwargs):
        with simulation_scope(simulation) as groups:
            if hasattr(simulation, "model_copy"):
                simulation = simulation.model_copy(update={"rotation_groups": groups})
            return function(simulation, *args, **kwargs)

    return scoped


def group(group_id):
    value = current_groups().get(group_id)
    if value is None:
        raise RotationDefinitionError("Rotation is not available in this calculation")
    return value


def validate_definition(variants, driftsform=None):
    primary_codes = {option.code for option in choices.list_afgrode_koder()}
    for variant in variants:
        for index, position in enumerate(variant.positions):
            if position.afgrode_kode not in primary_codes:
                raise RotationDefinitionError(f"Invalid hovedafgrøde: {position.afgrode_kode}")
            next_crop = variant.positions[(index + 1) % len(variant.positions)].afgrode_kode
            # With no driftsform metadata a definition may be used organically;
            # the effective simulation driftsform narrows choices during expansion.
            allowed = {
                option.code
                for option in choices.list_udlaeg_koder(
                    position.afgrode_kode, driftsform or "Økologisk", next_crop
                )
            }
            if set(position.allowed_udlaeg_koder) - allowed:
                raise RotationDefinitionError("Udlæg is not eligible for this crop position")


def _options(variant, index):
    position = variant.positions[index]
    next_crop = variant.positions[(index + 1) % len(variant.positions)].afgrode_kode
    key = (position.afgrode_kode, next_crop, tuple(position.allowed_udlaeg_koder), _disabled.get())
    cache = _options_cache.get()
    if cache is not None and key in cache:
        return cache[key]
    allowed = {
        option.code
        for option in choices.list_udlaeg_koder(
            position.afgrode_kode,
            _driftsform.get() or "Økologisk",
            next_crop,
        )
    }
    result = [0, *sorted((set(position.allowed_udlaeg_koder) & allowed) - _disabled.get())]
    if cache is not None:
        cache[key] = result
    return result


def check_expansion(group_ids, n_norm_procenter):
    count = sum(
        prod(len(_options(variant, i)) for i in range(len(variant.positions)))
        for group_id in set(group_ids)
        if is_custom(group_id)
        for variant in group(group_id).variants
    ) * len(set(n_norm_procenter))
    if count > MAX_CUSTOM_CANDIDATES:
        raise RotationDefinitionError(
            f"At most {MAX_CUSTOM_CANDIDATES} custom candidates are allowed; "
            "reduce variants, virkemiddel choices or N-norm levels",
            code="TOO_MANY_CUSTOM_CANDIDATES",
        )


def list_variants(group_id):
    check_expansion([group_id], ["100"])
    return [
        f"{variant.id}~{'-'.join(map(str, codes))}"
        for variant in group(group_id).variants
        for codes in product(*[_options(variant, i) for i in range(len(variant.positions))])
    ]


def resolve_variant(group_id, variant_id):
    try:
        identity, encoded = variant_id.split("~", 1)
        codes = [int(code) for code in encoded.split("-")]
        variant = next(v for v in group(group_id).variants if str(v.id) == identity)
        if len(codes) != len(variant.positions):
            raise ValueError
        if any(
            code and code not in pos.allowed_udlaeg_koder
            for code, pos in zip(codes, variant.positions, strict=True)
        ):
            raise ValueError
    except (ValueError, StopIteration) as error:
        raise RotationDefinitionError(
            "Rotation variant is no longer available", code="ROTATION_VARIANT_UNAVAILABLE"
        ) from error
    return variant, codes


def raw_rotation(group_id, variant_id):
    variant, codes = resolve_variant(group_id, variant_id)
    names = _names.get()
    if names is None:
        names = {
            option.code: option.navn for option in choices.list_udlaeg_koder(driftsform="Økologisk")
        }
        _names.set(names)
    result = []
    for index, (position, code) in enumerate(zip(variant.positions, codes, strict=True)):
        if code not in _options(variant, index):
            code = 0
        result.append((position.afgrode_kode, code or None, names.get(code)))
    return result + [(None, None, None)] * (8 - len(result))


def validate_overrides(ref, overrides, start_year, driftsform):
    if not is_custom(ref.saedskiftevariant):
        return
    variant, codes = resolve_variant(ref.saedskiftevariant, ref.variant)
    primary = {option.code for option in choices.list_afgrode_koder()}
    crops = [variant.positions[(start_year - 1 + i) % len(codes)].afgrode_kode for i in range(8)]
    for override in overrides:
        if override.afgrode_kode not in primary:
            raise RotationDefinitionError("Invalid hovedafgrøde")
        crops[override.position] = override.afgrode_kode
    for override in overrides:
        if not override.udlaeg_set or override.udlaeg_kode is None:
            continue
        position = variant.positions[(start_year - 1 + override.position) % len(codes)]
        allowed = {
            option.code
            for option in choices.list_udlaeg_koder(
                crops[override.position], driftsform, crops[(override.position + 1) % 8]
            )
        }
        if (
            override.udlaeg_kode not in position.allowed_udlaeg_koder
            or override.udlaeg_kode not in allowed
            or override.udlaeg_kode in _disabled.get()
        ):
            raise RotationDefinitionError(
                "Udlæg is not permitted at this rotation position", code="UDLAEG_NOT_PERMITTED"
            )


def contains_crop(code):
    return any(
        position.afgrode_kode == code
        for value in current_groups().values()
        for variant in value.variants
        for position in variant.positions
    )


def with_snapshot_rotations(function):
    @wraps(function)
    def scoped(*args, **kwargs):
        snapshot = kwargs.get("snapshot", args[-1] if args else None)
        if snapshot[0] is None:
            return function(*args, **kwargs)
        with simulation_scope(snapshot[0]):
            return function(*args, **kwargs)

    return scoped
