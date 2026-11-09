"""Display projections built from values already calculated by workers."""

from collections import defaultdict
from types import SimpleNamespace

from app.domain.field import FieldRecord
from app.domain.read_model import EconomicsStatement, FieldYearValue
from app.domain.rotation_candidate import RotationCandidateRef
from app.services.economics import statement_posts
from app.services.optimization import crop_area_ranges
from app.services.rotations import saedskifte_kategorier
from app.services.rotations.custom import CUSTOM_CATEGORY
from app.services.scenario.field_history_evaluator import REAL_HISTORY_YEARS

# The leaching detail keys the year strip needs to draw what covers the soil
# after harvest.
_WINTER_COVER_KEYS = (
    "W",
    "W_used",
    "EEA",
    "EMA",
    "ETS",
    "afstromningskategori_ukendt",
    "mellemafgroede_eller_tidlig_saaning",
)


def compact_years(candidate):
    return [
        FieldYearValue(
            year=y.year,
            leaching_kg_n_ha=y.leaching_kg_n_ha,
            db_kr_ha=y.db_kr_ha,
            economics_missing=bool(getattr(y, "db_detail", {}).get("economics_missing")),
            fen_fe_ha=y.fen_fe_ha,
            has_yield_response=getattr(y, "db_detail", {}).get("udbytterespons"),
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
                    "autumn_allocated_kg_n_ha",
                    "husdyrgodning_ton_pr_ha",
                    "afgrode_norm_kgn_ha",
                    "n_norm_pct",
                )
            },
            winter_cover={
                key: value
                for key, value in getattr(y, "leaching_detail", {}).items()
                if key in _WINTER_COVER_KEYS
            },
        ).model_dump(mode="json")
        for y in candidate.years[: candidate.active_len]
    ]


_NOT_A_LINE = {"area_ha", "db", "years", "crops", "posts"}
_STATEMENT_LINES = EconomicsStatement.model_fields.keys() - _NOT_A_LINE
_CALENDAR_YEARS = 8


def _add_year(figures, area, year):
    """Add one rotation year of a field, scaled from kr/ha to kr, to `figures`."""
    figures["area_ha"] += area
    figures["db"] += area * year.db_kr_ha
    for line in _STATEMENT_LINES:
        figures[line] += area * (year.db_detail.get(line) or 0)


def _sparse(figures):
    """Whole kr without the zero lines, so the stored result stays small."""
    rounded = {key: round(value) for key, value in figures.items() if key != "area_ha"}
    rounded = {key: value for key, value in rounded.items() if value != 0}
    return {"area_ha": round(figures["area_ha"], 2), **rounded}


def _post_list(by_name):
    """The posts of one line, biggest first, without those that are 0 in every year."""
    posts = [
        {
            "navn": name,
            "average": round(figures["average"]),
            "years": [round(value) for value in figures["years"]],
        }
        for name, figures in by_name.items()
    ]
    posts = [post for post in posts if post["average"] or any(post["years"])]
    return sorted(posts, key=lambda post: (-abs(post["average"]), post["navn"]))


def economics_statement(fields, candidates, economics_key=""):
    """The farm's regnskab as an average year, per calendar year, crop and post.

    The average is the mean over each field's rotation cycle. The calendar years
    are the candidate's eight years, which repeat the cycle, so a cycle that does
    not divide eight gives years whose mean differs a little from the average.
    `economics_key` is the cache key of the overrides the candidates were priced with;
    the subsidy posts are itemized with it.
    """
    statement = dict.fromkeys(["area_ha", "db", *_STATEMENT_LINES], 0.0)
    years = [defaultdict(float) for _ in range(_CALENDAR_YEARS)]
    crops = {}
    posts = defaultdict(
        lambda: defaultdict(lambda: {"average": 0.0, "years": [0.0] * _CALENDAR_YEARS})
    )

    def crop_figures(year):
        key = (year.year.afgrode_kode, year.year.afgrode_navn)
        return crops.setdefault(
            key,
            {
                "average": defaultdict(float),
                "years": [defaultdict(float) for _ in range(_CALENDAR_YEARS)],
            },
        )

    for field in fields:
        candidate = candidates.get(field["id"])
        cycle = candidate.years[: candidate.active_len] if candidate else []
        if field.get("rotation_id") is None or field.get("economics_missing") or not cycle:
            continue
        area = field["area_ha"]
        weight = area / len(cycle)
        statement["area_ha"] += area
        statement["db"] += field["db2"]
        year_posts = [statement_posts.year_posts(year, economics_key) for year in candidate.years]
        calendar = candidate.years[:_CALENDAR_YEARS]
        for index, year in enumerate(cycle):
            for line in _STATEMENT_LINES:
                statement[line] += weight * (year.db_detail.get(line) or 0)
            _add_year(crop_figures(year)["average"], weight, year)
            for line, name, amount in year_posts[index]:
                posts[line][name]["average"] += weight * amount
        for index, year in enumerate(calendar):
            _add_year(years[index], area, year)
            _add_year(crop_figures(year)["years"][index], area, year)
            for line, name, amount in year_posts[index]:
                posts[line][name]["years"][index] += area * amount

    return {
        **statement,
        "posts": {line: _post_list(by_name) for line, by_name in posts.items()},
        "years": [_sparse(figures) for figures in years],
        "crops": [
            {
                "afgrode_kode": code,
                "afgrode_navn": name,
                "average": _sparse(figures["average"]),
                "years": [_sparse(year) for year in figures["years"]],
            }
            for (code, name), figures in sorted(
                crops.items(), key=lambda item: (-item[1]["average"]["area_ha"], item[0])
            )
        ],
    }


def candidate_metadata(candidate):
    return {
        "ref": candidate.ref.model_dump(mode="json"),
        "base_ref": candidate.base_ref.model_dump(mode="json") if candidate.base_ref else None,
        "active_len": candidate.active_len,
        "years": [y.year.model_dump(mode="json") for y in candidate.years],
    }


def compact_candidate_metadata(candidate):
    """Only identity and active main-crop codes affect crop-area bounds."""
    if isinstance(candidate, dict):
        if "id" in candidate:
            return {"id": candidate["id"], "codes": list(candidate["codes"])}
        return {
            "id": RotationCandidateRef.model_validate(candidate["ref"]).to_id(),
            "codes": [
                year["afgrode_kode"] for year in candidate["years"][: candidate["active_len"]]
            ],
        }
    return {
        "id": candidate.ref.to_id(),
        "codes": [year.year.afgrode_kode for year in candidate.years[: candidate.active_len]],
    }


class PreparedMetadata:
    """Intern ordered base sets; overlays and contributions remain field-specific."""

    def __init__(self):
        self.data = {"version": 2, "candidate_sets": [], "fields": {}, "contributions": {}}
        self._sets = {}

    def add_field(self, field_id, base, overlays):
        compact = [compact_candidate_metadata(candidate) for candidate in base]
        key = tuple((candidate["id"], tuple(candidate["codes"])) for candidate in compact)
        index = self._sets.get(key)
        if index is None:
            index = len(self.data["candidate_sets"])
            self._sets[key] = index
            self.data["candidate_sets"].append(compact)
        self.data["fields"][field_id] = {
            "base_set": index,
            "overlays": {
                name: compact_candidate_metadata(value) if value else None
                for name, value in overlays.items()
            },
        }


def normalize_prepared(prepared):
    """Convert legacy documents only on full publication, never on view reads."""
    if prepared.get("version") == 2:
        return prepared
    builder = PreparedMetadata()
    for field_id, entry in prepared.get("fields", {}).items():
        builder.add_field(field_id, entry.get("base", []), entry.get("overlays", {}))
    builder.data["contributions"] = prepared.get("contributions", {})
    return builder.data


def prepared_base(prepared, entry):
    if "base_set" in entry:
        return prepared["candidate_sets"][entry["base_set"]]
    return entry.get("base", [])


def ensure_prepared_field(prepared, field_id):
    if field_id not in prepared["fields"]:
        sets = prepared["candidate_sets"]
        index = next((index for index, values in enumerate(sets) if not values), len(sets))
        if index == len(sets):
            sets.append([])
        prepared["fields"][field_id] = {"base_set": index, "overlays": {}}
    return prepared["fields"][field_id]


def _metadata_id(candidate):
    return (
        candidate["id"]
        if "id" in candidate
        else RotationCandidateRef.model_validate(candidate["ref"]).to_id()
    )


def overlay_metadata(base, overlays):
    values = {_metadata_id(candidate): candidate for candidate in base}
    for overlay in overlays:
        if overlay:
            values[_metadata_id(overlay)] = overlay
    return list(values.values())


def field_contribution(field, candidates):
    compact = [compact_candidate_metadata(candidate) for candidate in candidates]
    thin = [
        SimpleNamespace(
            ref=RotationCandidateRef.from_id(candidate["id"]),
            active_len=len(candidate["codes"]),
            years=[
                SimpleNamespace(year=SimpleNamespace(afgrode_kode=code))
                for code in candidate["codes"]
            ],
        )
        for candidate in compact
    ]
    return [vars(value) for value in crop_area_ranges.crop_area_ranges([field], {field.id: thin})]


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


def _without_economics(years):
    """A mark has no economics when every year of its rotation has none."""
    return bool(years) and all(year.get("economics_missing") for year in years)


def flag_fields_without_economics(response, field_years):
    return {
        **response,
        "fields": [
            {**field, "economics_missing": _without_economics(field_years.get(field["id"], []))}
            for field in response["fields"]
        ],
    }


def yearly_totals(fields, field_years, *, history=False):
    totals = {}
    for field in fields:
        for index, year in enumerate(field_years.get(field.id, [])):
            key = REAL_HISTORY_YEARS.start + index if history else index + 1
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


class RotationCatalog:
    """Retain the first eligible display entry per pair while scanning fields."""

    def __init__(self):
        self._by_pair = {}

    def add(self, candidates):
        for candidate in candidates:
            if candidate.get("base_ref") is not None:
                continue
            ref = candidate["ref"]
            self._by_pair.setdefault((ref["saedskiftevariant"], ref["variant"]), candidate)

    def build(self):
        return _rotation_catalog(self._by_pair)


def rotation_catalog(prepared_fields):
    catalog = RotationCatalog()
    for candidates in prepared_fields.values():
        catalog.add(candidates)
    return catalog.build()


def _rotation_catalog(by_pair):
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
                groups[category], key=lambda c: (
                    not c["saedskiftevariant"].isdigit(),
                    int(c["saedskiftevariant"]) if c["saedskiftevariant"].isdigit()
                    else c["saedskiftevariant"], c["variant"],
                )
            ),
        }
        for category in ["Brak", *saedskifte_kategorier.list_kategorier(), CUSTOM_CATEGORY]
        if category in groups
    ]


def simulation_data(
    fields, prepared_fields, field_years, saved_result=None, catalog=None, *, contributions=None
):
    if contributions is None:
        contributions = {
            field.id: field_contribution(field, prepared_fields.get(field.id, []))
            for field in fields
        }
    data = {
        "fields": [
            field.model_copy(
                update={"economics_missing": _without_economics(field_years.get(field.id, []))}
            ).model_dump(mode="json")
            for field in fields
        ],
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
