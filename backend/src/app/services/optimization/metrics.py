# ruff: noqa: E501

from enum import Enum

from app.domain.field import Crop, FieldMeasures, Soil

leaching_table_sand = """
62	65	53	19	5	10	51	122	72	67	129	63	63
68	60	60	23	6	10	57	132	76	67	129	63	69
67	65	51	25	7	10	56	130	77	67	129	63	63
82	80	60	30	5	10	49	210	83	67	129	63	90
60	60	49	24	5	10	59	110	70	67	129	63	60
60	60	45	24	5	20	57	120	70	67	129	63	60
82	61	48	24	6	10	50	117	75	67	129	63	58
64	44	32	24	6	4	29	93	79	67	129	63	50
64	68	58	24	7	10	55	124	75	67	129	63	57
67	63	51	24	6	10	28	129	75	67	129	63	63
67	63	51	24	6	10	50	129	75	67	129	63	63
67	63	51	24	6	10	53	129	75	67	129	63	63
65	69	51	26	7	10	55	128	77	67	129	63	63
"""
leaching_table_sand = [e.split("\t") for e in leaching_table_sand.split("\n") if e != ""]

leaching_table_clay = """
52	51	41	14	3	7	39	93	59	52	97	50	51
51	55	45	17	4	7	42	96	63	52	97	50	54
51	54	39	18	5	7	43	96	70	52	97	50	52
64	60	48	5	4	9	39	154	67	52	97	50	74
48	48	37	14	4	7	45	92	57	52	97	50	50
49	50	36	11	4	6	41	95	56	52	97	50	52
62	43	36	14	4	7	39	88	63	52	97	50	47
47	32	24	14	4	1	21	68	62	52	97	50	32
48	52	45	17	5	7	42	93	64	52	97	50	54
52	50	39	14	4	7	39	97	64	52	97	50	52
52	50	39	14	4	7	39	97	64	52	97	50	52
52	50	39	14	4	7	39	97	64	52	97	50	52
50	53	39	18	5	7	43	96	77	52	97	50	52
"""
leaching_table_clay = [e.split("\t") for e in leaching_table_clay.split("\n") if e != ""]

db2_table_sand = """
10400	8500	7000	7000	10800	2500	10000	7800	9500	11500	8300	9200	7000
10400	8500	7000	7000	10800	2500	10000	7800	9500	11500	8300	9200	7000
10400	8500	7000	7000	10800	2500	10000	7800	9500	11500	8300	9200	7000
10400	8500	7000	7000	10800	2500	10000	7800	9500	11500	8300	9200	7000
10400	8500	7000	7000	10800	2500	10000	7800	9500	11500	8300	9200	7000
10400	8500	7000	7000	10800	2500	10000	7800	9500	11500	8300	9200	7000
10400	8500	7000	7000	10800	2500	10000	7800	9500	11500	8300	9200	7000
10400	8500	7000	7000	10800	2500	10000	7800	9500	11500	8300	9200	7000
10400	8500	7000	7000	10800	2500	10000	7800	9500	11500	8300	9200	7000
10400	8500	7000	7000	10800	2500	10000	7800	9500	11500	8300	9200	7000
10400	8500	7000	7000	10800	2500	10000	7800	9500	11500	8300	9200	7000
10400	8500	7000	7000	10800	2500	10000	7800	9500	11500	8300	9200	7000
10400	8500	7000	7000	10800	2500	10000	7800	9500	11500	8300	9200	7000
"""
db2_table_sand = [e.split("\t") for e in db2_table_sand.split("\n") if e != ""]

db2_table_clay = """
11500	9000	7500	8000	12000	2500	10500	8100	10000	12500	8700	10000	7200
11500	9000	7500	8000	12000	2500	10500	8100	10000	12500	8700	10000	7200
11500	9000	7500	8000	12000	2500	10500	8100	10000	12500	8700	10000	7200
11500	9000	7500	8000	12000	2500	10500	8100	10000	12500	8700	10000	7200
11500	9000	7500	8000	12000	2500	10500	8100	10000	12500	8700	10000	7200
11500	9000	7500	8000	12000	2500	10500	8100	10000	12500	8700	10000	7200
11500	9000	7500	8000	12000	2500	10500	8100	10000	12500	8700	10000	7200
11500	9000	7500	8000	12000	2500	10500	8100	10000	12500	8700	10000	7200
11500	9000	7500	8000	12000	2500	10500	8100	10000	12500	8700	10000	7200
11500	9000	7500	8000	12000	2500	10500	8100	10000	12500	8700	10000	7200
11500	9000	7500	8000	12000	2500	10500	8100	10000	12500	8700	10000	7200
11500	9000	7500	8000	12000	2500	10500	8100	10000	12500	8700	10000	7200
11500	9000	7500	8000	12000	2500	10500	8100	10000	12500	8700	10000	7200
"""
db2_table_clay = [e.split("\t") for e in db2_table_clay.split("\n") if e != ""]


class Transition(Enum):
    LEACHING_SAND = leaching_table_sand
    LEACHING_CLAY = leaching_table_clay
    DB2_SAND = db2_table_sand
    DB2_CLAY = db2_table_clay


def get_index(crop: Crop) -> int:
    return list(Crop).index(crop)


def get_transition(
    from_crop: Crop,
    to_crop: Crop,
    soil: Soil,
    area: float,
    transition: Transition,
) -> float | None:
    try:
        value_per_ha = transition.value[get_index(from_crop)][get_index(to_crop)]

        if value_per_ha == "" or value_per_ha == "-":
            return None

        value = int(value_per_ha) * area

        return value
    except IndexError as error:
        raise Exception(
            f"Transition is not legal. \n {from_crop} -> {to_crop} {soil} {area}, {get_index(from_crop)}, {get_index(to_crop)}"
        ) from error


def _field_metric(
    area_ha: float,
    soil: Soil,
    crop_rotation: list[Crop] | tuple[Crop, ...],
    transition: Transition,
    measures: FieldMeasures | None = None,
) -> float:
    values = []
    measures = measures or FieldMeasures()
    for idx, crop in enumerate(crop_rotation):
        # We specifically want -1 if it is the first crop, since it is a rotation.
        previous_crop = crop_rotation[idx - 1]
        value = get_transition(
            from_crop=previous_crop,
            to_crop=crop,
            soil=soil,
            area=area_ha,
            transition=transition,
        )

        if value is None:
            raise Exception(
                f"The existing data should not contain invalid transitions \n {transition}, {previous_crop} -> {crop} = {value}"
            )

        if transition in {Transition.LEACHING_SAND, Transition.LEACHING_CLAY}:
            if idx in measures.cover_crop_years:
                value *= 0.55
            if idx in measures.early_sowing_years:
                value *= 0.91
        elif idx in measures.cover_crop_years:
            value -= 500 * area_ha

        values.append(value)

    return sum(values) / len(values)


def field_db2(
    area_ha: float,
    soil: Soil,
    crop_rotation: list[Crop] | tuple[Crop, ...],
    measures: FieldMeasures | None = None,
) -> float:
    transition = Transition.DB2_SAND if soil == Soil.SAND else Transition.DB2_CLAY
    return _field_metric(area_ha, soil, crop_rotation, transition, measures)


def field_n_load(
    area_ha: float,
    retention: float | None,
    soil: Soil,
    crop_rotation: list[Crop] | tuple[Crop, ...],
    measures: FieldMeasures | None = None,
) -> float:
    measures = measures or FieldMeasures()
    retention = retention if retention is not None else 0
    leaching = field_leaching(area_ha, soil, crop_rotation, measures)
    nload = leaching * ((100 - retention) / 100)
    if measures.precision_farming:
        nload *= 0.96
    return nload


def field_leaching(
    area_ha: float,
    soil: Soil,
    crop_rotation: list[Crop] | tuple[Crop, ...],
    measures: FieldMeasures | None = None,
) -> float:
    transition = Transition.LEACHING_SAND if soil == Soil.SAND else Transition.LEACHING_CLAY
    return _field_metric(area_ha, soil, crop_rotation, transition, measures)
