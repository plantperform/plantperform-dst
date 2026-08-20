from app.domain.field import FieldRecord
from app.services.optimization.metrics import field_db2, field_leaching, field_n_load


def compute_field_metrics(field: FieldRecord) -> tuple[float, float, float]:
    db2 = field_db2(field.area_ha, field.soil, field.crop_rotation, field.measures)
    n_load = field_n_load(
        field.area_ha,
        field.retention,
        field.soil,
        field.crop_rotation,
        field.measures,
    )
    leaching = field_leaching(field.area_ha, field.soil, field.crop_rotation, field.measures)
    return db2, n_load, leaching
