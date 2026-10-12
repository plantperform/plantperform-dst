"""Display projections built from values already calculated by workers."""

from types import SimpleNamespace

from app.domain.field import FieldRecord
from app.domain.read_model import FieldYearValue
from app.domain.rotation_candidate import RotationCandidateRef, RotationYear
from app.services.optimization.crop_area_ranges import crop_area_ranges
from app.services.rotations import saedskifte_kategorier


def compact_years(candidate):
    return [
        FieldYearValue(
            year=y.year,
            leaching_kg_n_ha=y.leaching_kg_n_ha,
            db_kr_ha=y.db_kr_ha,
            fen_fe_ha=y.fen_fe_ha,
            **{
                key: getattr(
                    y,
                    key,
                    None if key == "afgrode_norm_kgn_ha" else 100 if key == "n_norm_pct" else 0,
                )
                for key in (
                    "forfrugtsvaerdi_kgn_ha",
                    "tildelt_husdyrgodning_udnyttet_kgn_ha",
                    "tildelt_handelsgodning_kgn_ha",
                    "husdyrgodning_organisk_bundet_kgn_ha",
                    "husdyrgodning_ton_pr_ha",
                    "afgrode_norm_kgn_ha",
                    "n_norm_pct",
                )
            },
            winter_cover={
                key: value
                for key, value in getattr(y, "leaching_detail", {}).items()
                if key in ("W", "W_used", "EEA", "EMA", "ETS", "afstromningskategori_ukendt")
            },
        ).model_dump(mode="json")
        for y in candidate.years[: candidate.active_len]
    ]


def candidate_metadata(candidate):
    return {
        "ref": candidate.ref.model_dump(mode="json"),
        "base_ref": candidate.base_ref.model_dump(mode="json") if candidate.base_ref else None,
        "active_len": candidate.active_len,
        "years": [y.year.model_dump(mode="json") for y in candidate.years],
    }


def overlay_metadata(base, overlays):
    values = {RotationCandidateRef.model_validate(c["ref"]).to_id(): c for c in base}
    for overlay in overlays:
        if overlay:
            values[RotationCandidateRef.model_validate(overlay["ref"]).to_id()] = overlay
    return list(values.values())


def field_contribution(field, candidates):
    thin = [
        SimpleNamespace(
            ref=RotationCandidateRef.model_validate(c["ref"]),
            active_len=c["active_len"],
            years=[SimpleNamespace(year=RotationYear.model_validate(y)) for y in c["years"]],
        )
        for c in candidates
    ]
    return [vars(value) for value in crop_area_ranges([field], {field.id: thin})]


def combine_contributions(contributions):
    combined = {}
    for values in contributions.values():
        for value in values:
            code = value["afgrode_kode"]
            bucket = combined.setdefault(
                code,
                {
                    "afgrode_kode": code,
                    "min_average_ha": 0,
                    "max_average_ha": 0,
                    "min_ha_by_year": [0.0] * 8,
                    "max_ha_by_year": [0.0] * 8,
                    "yearly_max_average_ha": 0,
                },
            )
            for key in ("min_average_ha", "max_average_ha", "yearly_max_average_ha"):
                bucket[key] += value[key]
            for key in ("min_ha_by_year", "max_ha_by_year"):
                bucket[key] = [a + b for a, b in zip(bucket[key], value[key], strict=True)]
    return [combined[code] for code in sorted(combined)]


def yearly_totals(fields, field_years, *, history=False):
    totals = {}
    for field in fields:
        for index, year in enumerate(field_years.get(field.id, [])):
            key = 2019 + index if history else index + 1
            bucket = totals.setdefault(
                key,
                {
                    "year": key,
                    "total_n_load_kg": 0.0,
                    "total_db2": 0.0,
                    "total_fen": 0.0,
                    "field_count": 0,
                },
            )
            if field.kvotegivende:
                bucket["total_n_load_kg"] += (
                    year["leaching_kg_n_ha"] * field.area_ha * (1 - (field.retention or 0) / 100)
                )
            bucket["total_db2"] += year["db_kr_ha"] * field.area_ha
            bucket["total_fen"] += year["fen_fe_ha"] * field.area_ha
            bucket["field_count"] += 1
    return [totals[key] for key in sorted(totals)]


def rotation_catalog(prepared_fields):
    by_pair = {}
    for candidates in prepared_fields.values():
        for candidate in candidates:
            if candidate.get("base_ref") is not None:
                continue
            ref = candidate["ref"]
            by_pair.setdefault((ref["saedskiftevariant"], ref["variant"]), candidate)
    groups = {}
    seen_brak = set()
    for (variant, option_id), candidate in by_pair.items():
        sequence = [year["afgrode_navn"] for year in candidate["years"][: candidate["active_len"]]]
        categories = saedskifte_kategorier.kategorier_for_saedskifte(variant)
        if len(categories) > 1:
            if tuple(sequence) in seen_brak:
                continue
            seen_brak.add(tuple(sequence))
            categories = ["Brak"]
        option = {
            "saedskiftevariant": variant,
            "variant": option_id,
            "crop_sequence": sequence,
            "active_len": candidate["active_len"],
        }
        for category in categories:
            groups.setdefault(category, []).append(option)
    return [
        {
            "kategori": category,
            "saedskifter": sorted(
                groups[category], key=lambda c: (int(c["saedskiftevariant"]), c["variant"])
            ),
        }
        for category in ["Brak", *saedskifte_kategorier.list_kategorier()]
        if category in groups
    ]


def simulation_data(fields, prepared_fields, field_years, saved_result=None, catalog=None):
    contributions = {
        field.id: field_contribution(field, prepared_fields.get(field.id, [])) for field in fields
    }
    data = {
        "fields": [field.model_dump(mode="json") for field in fields],
        "field_years": field_years,
        "yearly_summary": yearly_totals(fields, field_years),
        "crop_area_ranges": combine_contributions(contributions),
        "yearly_optimization_candidates": rotation_catalog(prepared_fields)
        if catalog is None
        else catalog,
        "saved_result": saved_result,
        "comparison_availability": comparison_availability(saved_result),
    }
    return data, contributions


def comparison_availability(saved_result):
    if not saved_result:
        return {"kind": "uncalculated"}
    fields = saved_result["response"]["fields"]
    missing = sum(field.get("rotation_id") is None for field in fields)
    if missing == len(fields):
        return {"kind": "uncalculated"}
    if missing:
        return {"kind": "partial", "missingCount": missing}
    return {"kind": "ready"}


def parsed_fields(data):
    return [FieldRecord.model_validate(field) for field in data["fields"]]
