"""Rotation choices and area bounds require sequences, never calculated alternatives."""

from types import SimpleNamespace

from app.domain.rotation_candidate import (
    RotationCandidateRef,
    RotationPositionOverride,
    RotationYear,
)
from app.domain.saedskifte import RotationDefinitionError
from app.services import read_models
from app.services.rotations import afgroede_normer, custom, saedskifte_library
from app.services.rotations.custom import current_groups, with_simulation_rotations
from app.services.scenario.candidate_evaluator import prepare_candidates


@with_simulation_rotations
def sequences(simulation):
    values = []
    for option in prepare_candidates(
        simulation.rotation_saedskiftevarianter,
        simulation.rotation_n_norm_procenter,
        simulation.tidlig_saaning,
        simulation.mellemafgrode,
    ):
        years = [
            SimpleNamespace(
                year=RotationYear(
                    afgrode_kode=code,
                    afgrode_navn=afgroede_normer.lookup_crop_params(code).get("navn", str(code)),
                    udlaeg_kode=under,
                    udlaeg_navn=name,
                )
            )
            for code, under, name in option.rotation
        ]
        values.append(
            SimpleNamespace(
                ref=option.ref, base_ref=None, active_len=option.active_len, years=years
            )
        )
    return values


@with_simulation_rotations
def catalog(simulation):
    categories = read_models.rotation_catalog(
        {"library": [read_models.candidate_metadata(value) for value in sequences(simulation)]}
    )

    for category in categories:
        for option in category["saedskifter"]:
            option["canCopy"] = True
            group = current_groups().get(option["saedskiftevariant"])
            if group is not None:
                option["name"] = group.name
    return categories


def _overlay_codes(value, simulation):
    source = RotationCandidateRef.model_validate(value.get("base_ref") or value["ref"])
    if not custom.is_custom(source.saedskiftevariant):
        return [y["year"]["afgrode_kode"] for y in value["years"][: value["active_len"]]]
    if (
        source.saedskiftevariant not in simulation.rotation_saedskiftevarianter
        or source.n_norm_pct not in simulation.rotation_n_norm_procenter
    ):
        return None
    overrides = [
        RotationPositionOverride.model_validate(item) for item in value.get("overrides", [])
    ]
    start = value.get("start_year", 1)
    try:
        custom.validate_overrides(source, overrides, start, simulation.godning.driftsform)
        rotation = saedskifte_library.generate_rotation(
            source.saedskiftevariant, source.variant, start
        )
    except RotationDefinitionError:
        return None
    codes = [position[0] for position in rotation]
    for override in overrides:
        codes[override.position] = override.afgrode_kode
    return codes


@with_simulation_rotations
def contributions(simulation, fields, setup_fields):
    base = [read_models.compact_candidate_metadata(value) for value in sequences(simulation)]
    output = {}
    for field in fields:
        overlays = []
        for key in ("manual_candidate", "fixed_candidate"):
            value = setup_fields.get(field.id, {}).get(key)
            if value:
                codes = _overlay_codes(value, simulation)
                if codes is None:
                    continue
                overlays.append(
                    {
                        "id": RotationCandidateRef.model_validate(value["ref"]).to_id(),
                        "codes": codes,
                    }
                )
        output[field.id] = read_models.field_contribution(
            field,
            read_models.overlay_metadata(base, overlays),
        )
    return output
