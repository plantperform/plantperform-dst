"""Standard crop budgets, row by row, as the calculator prices them.

Each row is a quantity times a unit price, with the identifiers an economics
module overrides it by, so a client can show the budget, apply a module's
overrides and arrive at the dækningsbidrag the calculator would.
"""

from collections import Counter

from sqlalchemy import select

from app.data.db import SessionLocal, afgroede_table
from app.data.repository import list_fields, list_simulations, scenario_afgrodekoder
from app.services.economics.db_calculator import OEKOLOGISK, calculate_db, soil_variants
from app.services.economics.overrides import price_unit

_PRICE_LABELS = {"Udbytte": "Salgspris", "Halm": "Halmpris"}


def _quantity_unit(unit):
    per = unit.split("/", 1)[1]
    if per == "gang":
        return "gange"
    if per == "enhed":
        return "enheder/ha"
    if per in ("ha", "mm"):
        return per
    return f"{per}/ha"


def _line(line, prices):
    unit = price_unit(line["enhed"])
    if line["pris_id"] is not None:
        prices.setdefault(
            line["pris_id"],
            dict(
                id=line["pris_id"],
                label=_PRICE_LABELS.get(line["navn"], line["navn"]),
                unit=unit,
                value=line["pris"],
                source=line["kilde"],
            ),
        )
    return dict(
        label=line["navn"],
        category=line["kategori"],
        quantity=line["maengde"],
        quantityUnit=_quantity_unit(unit),
        quantityId=line["maengde_id"],
        priceId=line["pris_id"],
        followsYield=line["foelger_udbytte"],
    )


def crop_budgets(crop_codes, jb_nr, farming_system, only_organic, org_mineral_n=0.0):
    with SessionLocal() as session:
        crops = {
            row.afgroedekode: row
            for row in session.execute(
                select(
                    afgroede_table.c.afgroedekode,
                    afgroede_table.c.navn,
                    afgroede_table.c.forfrugtsvaerdi,
                ).where(afgroede_table.c.afgroedekode.in_(crop_codes))
            )
        }
    prices = {}
    budgets = []
    inputs = dict(only_organic=only_organic, itemized=True)
    for code in crop_codes:
        crop = crops.get(code)
        if crop is None:
            continue
        detail = calculate_db(code, farming_system, jb_nr, **inputs)
        manure_n = min(org_mineral_n, detail["mncs"])
        if manure_n > 0:
            detail = calculate_db(
                code, farming_system, jb_nr, org_mineral_n_applied=manure_n, **inputs
            )
        budgets.append(
            dict(
                cropCode=code,
                cropName=crop.navn or str(code),
                precedingCropValueKgNHa=crop.forfrugtsvaerdi or 0.0,
                revenue=[_line(line, prices) for line in detail["indtaegt_linjer"]],
                subsidies=[_line(line, prices) for line in detail["tilskud_linjer"]],
                costs=[_line(line, prices) for line in detail["linjer"]],
            )
        )
    used = set(prices).union(
        line["quantityId"]
        for crop in budgets
        for line in (*crop["revenue"], *crop["subsidies"], *crop["costs"])
    )
    variants = soil_variants()
    return dict(
        jbNr=jb_nr,
        farmingSystem=farming_system,
        prices=list(prices.values()),
        crops=budgets,
        soilVariants={
            key: [dict(id=variant, value=value) for variant, value in variants[key]]
            for key in sorted(used & variants.keys())
        },
    )


def _dominant_jbnr(fields):
    areas = Counter()
    for field in fields:
        if field.jbnr is not None:
            areas[field.jbnr] += field.area_ha
    return max(areas, key=lambda jbnr: (areas[jbnr], -jbnr)) if areas else None


def _grown_areas(fields):
    areas = Counter()
    for field in fields:
        for year in field.crop_rotation:
            if year.afgrode_kode > 0:
                areas[year.afgrode_kode] += field.area_ha / len(field.crop_rotation)
    return areas


def farm_budgets(farm_id, email, farming_system, simulation_id=None):
    fields = list_fields(farm_id, email)
    simulations = list_simulations(farm_id, email)
    if fields is None or simulations is None:
        return None
    only_organic = farming_system == OEKOLOGISK
    org_mineral_n = 0.0
    if simulation_id is not None:
        simulation = next((entry for entry in simulations if entry.id == simulation_id), None)
        if simulation is None:
            return None
        farming_system = simulation.godning.driftsform
        only_organic = simulation.godning.only_organic
        org_mineral_n = simulation.godning.org_mineral_n
    jb_nr = _dominant_jbnr(fields)
    if jb_nr is None:
        return dict(jbNr=None, farmingSystem=farming_system, prices=[], crops=[], soilVariants={})
    grown = _grown_areas(fields)
    possible = set().union(*(scenario_afgrodekoder(entry) for entry in simulations)) - set(grown)
    crop_codes = [code for code, _ in grown.most_common()] + sorted(possible)
    return crop_budgets(crop_codes, jb_nr, farming_system, only_organic, org_mineral_n)
