"""Rotation choices and area bounds require sequences, never calculated alternatives."""

from types import SimpleNamespace

from app.domain.rotation_candidate import RotationCandidateRef, RotationYear
from app.services import read_models
from app.services.rotations import afgroede_normer
from app.services.scenario.candidate_evaluator import prepare_candidates


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


def catalog(simulation):
    return read_models.rotation_catalog(
        {"library": [read_models.candidate_metadata(value) for value in sequences(simulation)]}
    )


def contributions(simulation, fields, setup_fields):
    base = [read_models.compact_candidate_metadata(value) for value in sequences(simulation)]
    output = {}
    for field in fields:
        overlays = []
        for key in ("manual_candidate", "fixed_candidate"):
            value = setup_fields.get(field.id, {}).get(key)
            if value:
                overlays.append(
                    {
                        "id": RotationCandidateRef.model_validate(value["ref"]).to_id(),
                        "codes": [
                            y["year"]["afgrode_kode"] for y in value["years"][: value["active_len"]]
                        ],
                    }
                )
        output[field.id] = read_models.field_contribution(
            field,
            read_models.overlay_metadata(base, overlays),
        )
    return output
