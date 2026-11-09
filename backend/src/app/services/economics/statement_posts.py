"""The regnskabsposter behind one rotation year's indtægter, tilskud and omkostninger."""

import re

from app.services.economics.db_calculator import calculate_db

# The statement line each budget category adds to.
COST_LINES = {
    "Gødning": "goedning",
    "Andre gødningsstoffer": "andre_goedningsstoffer",
    "Udsæd": "udsaed",
    "Planteværn": "plantevaern",
    "Markarbejde": "markarbejde",
    "Tørring/lagring": "toerring",
    "Andet": "andet",
}

# "Handelsgødning, N (150 kg/ha)" is the same post whatever the quantity.
_QUANTITY = re.compile(r"\s*\(\d+(?:[.,]\d+)? [^)]*\)$")


def _subsidy_posts(year, economics_key):
    # The tilskud depends on the afgrøde, driftsform and prices only, so an
    # evaluation from before the full inputs were kept can be itemized too. An
    # evaluation that does not say whether the afgrøde is a rotation crop is
    # itemized the way that adds up to the tilskud it stored.
    detail = year.db_detail
    stored = detail.get("tilskud") or 0
    if "driftsform" not in detail or "jbnr" not in detail:
        return [("Tilskud", stored)]
    known = (detail.get("calculation_inputs") or {}).get("rotation_crop")
    for rotation_crop in (False, True) if known is None else (known,):
        itemized = calculate_db(
            afgrodekode=detail.get("afgrodekode", year.year.afgrode_kode),
            driftsform=detail["driftsform"],
            jbnr=detail["jbnr"],
            rotation_crop=rotation_crop,
            economics_key=economics_key,
            itemized=True,
        )
        posts = [(line["navn"], line["udgift_kr_ha"]) for line in itemized["tilskud_linjer"]]
        if abs(sum(amount for _, amount in posts) - stored) <= 1:
            return posts
    return [("Tilskud", stored)]


def year_posts(year, economics_key=""):
    """(statement line, post name, kr/ha) for each post the year has.

    Costs are positive, as in the statement's own lines.
    """
    detail = year.db_detail
    if year.year.afgrode_kode <= 0 or detail.get("economics_missing"):
        return []
    straw = detail.get("halm_indtaegt") or 0
    posts = [
        ("indtaegt", "Udbytte", (detail.get("indtaegt") or 0) - straw),
        ("indtaegt", "Halm", straw),
    ]
    posts += [("tilskud", name, amount) for name, amount in _subsidy_posts(year, economics_key)]
    for line in detail.get("linjer", []):
        key = COST_LINES.get(line["kategori"])
        if key is not None:
            posts.append((key, _QUANTITY.sub("", line["behandling"]), line["udgift_kr_ha"]))
    return posts
