"""Stable catalogue identities shared by lookup resolution, validation and the API."""

import json

from sqlalchemy import select

from app.data.db import (
    SessionLocal,
    afgroede_norm_lookup_table,
    afgroede_table,
    arbejdsmaengde_table,
    arbejdssats_table,
    dyrkningsomkostning_table,
    halmudbytte_table,
    prisliste_table,
    salgspris_table,
)


def identifier(namespace, *parts):
    return namespace + ":" + json.dumps(parts, ensure_ascii=False, separators=(",", ":"))


def quantity_id(crop, namespace, *parts):
    return f"{crop}/{identifier(namespace, *parts)}"


def assumptions():
    """Raw context variants, rather than a fictitious uniform farm budget.

    Work rate/quantity units were not retained by the existing importers;
    generic units are intentional. Reference row ordering is never an identity.
    """
    prices, quantities = {}, {}
    yields, straw_yields = [], []
    with SessionLocal() as session:
        crops = dict(
            session.execute(select(afgroede_table.c.afgroedekode, afgroede_table.c.navn)).all()
        )
        units = dict(
            session.execute(
                select(afgroede_table.c.afgroedekode, afgroede_table.c.udbytteenhed)
            ).all()
        )
        for row in session.execute(select(afgroede_norm_lookup_table)):
            yields.append(
                dict(
                    cropCode=row.afgroedekode,
                    jbNr=row.jb_nr,
                    farmingSystem=row.driftsform,
                    irrigation=row.vanding,
                    expectedYield=row.udbyttenorm,
                    unit=units.get(row.afgroedekode),
                    nitrogenNorm=row.n_norm,
                )
            )
        for row in session.execute(select(halmudbytte_table)):
            straw_yields.append(
                dict(
                    cropCode=row.afgroedekode,
                    soilGroup=row.jordbonitet,
                    expectedYield=row.halm_udbytte_kg_ha,
                    unit="kg/ha",
                )
            )
        for row in session.execute(select(salgspris_table)):
            context = dict(
                cropCode=row.afgroedekode, farmingSystem=row.driftsform, quality=row.kvalitet
            )
            for namespace, value, unit in (
                ("sale", row.salgspris, row.enhed),
                ("straw", row.halm_pris_kr_kg, "kr/kg"),
            ):
                key = identifier(namespace, row.afgroedekode, row.driftsform, row.kvalitet)
                prices[key] = dict(id=key, value=value, unit=unit, context=context)
        for row in session.execute(select(arbejdssats_table)):
            key = identifier(
                "rate", row.behandling, row.jordbonitet, row.afgroedekode, row.driftsform
            )
            prices[key] = dict(
                id=key,
                label=row.behandling,
                value=row.pris_kr_per_enhed,
                unit="kr/enhed",
                context=dict(
                    cropCode=row.afgroedekode,
                    farmingSystem=row.driftsform,
                    soilGroup=row.jordbonitet,
                ),
            )
        for row in session.execute(select(arbejdsmaengde_table)):
            key = quantity_id(
                row.afgroedekode,
                "work",
                row.driftsform,
                row.jordbonitet,
                row.kvalitet,
                row.kategori,
                row.behandling,
            )
            quantities[key] = dict(
                id=key,
                lineId=key.split("/", 1)[1],
                label=row.behandling,
                value=row.antal,
                unit="enheder/ha",
                context=dict(
                    cropCode=row.afgroedekode,
                    farmingSystem=row.driftsform,
                    soilGroup=row.jordbonitet,
                    quality=row.kvalitet,
                    category=row.kategori,
                ),
            )
        for row in session.execute(select(dyrkningsomkostning_table)):
            if row.kategori == "Gødning":
                continue
            key = identifier("cost", row.afgroedekode, row.driftsform, row.kategori, row.behandling)
            context = dict(
                cropCode=row.afgroedekode, farmingSystem=row.driftsform, category=row.kategori
            )
            prices[key] = dict(
                id=key, label=row.behandling, value=row.udgift_kr_ha, unit="kr/ha", context=context
            )
            qty = quantity_id(
                row.afgroedekode, "cost", row.driftsform, row.kategori, row.behandling
            )
            quantities[qty] = dict(
                id=qty, lineId=qty.split("/", 1)[1], value=1.0, unit="ha", context=context
            )
        posts = list(session.execute(select(prisliste_table)))
        for row in posts:
            key = identifier("list", row.post)
            prices[key] = dict(
                id=key,
                label=row.post,
                value=row.pris,
                unit=row.enhed,
                context=dict(category=row.kategori, type=row.type),
            )
            for crop in crops:
                qty = quantity_id(crop, "list", row.post)
                quantities[qty] = dict(
                    id=qty,
                    lineId=qty.split("/", 1)[1],
                    value=1.0,
                    unit="enheder/ha",
                    context=dict(cropCode=crop),
                )
        # Fertilizer quantities are priced independently from physical N allocations.
        for crop in crops:
            for purpose in ("mineralN", "mineralSpreading", "manureSpreading"):
                qty = quantity_id(crop, "fertiliser", purpose)
                quantities[qty] = dict(
                    id=qty,
                    lineId=qty.split("/", 1)[1],
                    value=None,
                    unit="kg N/ha" if purpose == "mineralN" else "ha",
                    context=dict(cropCode=crop),
                    dynamic=True,
                )
    return dict(
        yields=yields,
        strawYields=straw_yields,
        prices=list(prices.values()),
        quantities=list(quantities.values()),
        crops=[dict(cropCode=code, cropName=name) for code, name in crops.items()],
    )


def validate_identifiers(overrides):
    if not any((overrides.prices, overrides.quantities, overrides.yield_pct)):
        return
    catalog = assumptions()
    for values, allowed, kind in (
        (overrides.prices, {row["id"] for row in catalog["prices"]}, "price"),
        (overrides.quantities, {row["id"] for row in catalog["quantities"]}, "quantity"),
        (overrides.yield_pct, {str(row["cropCode"]) for row in catalog["crops"]}, "crop"),
    ):
        unknown = set(values) - allowed
        if unknown:
            raise ValueError(f"Unknown economics {kind} identifiers: {sorted(unknown)}")
