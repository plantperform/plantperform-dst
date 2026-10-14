"""Personal labels are independent of field snapshots and calculation revisions."""

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from app.data import repository
from app.data.db import field_table, simulation_table, user_field_alias_table
from app.domain.field_alias import FieldAlias


def field_key(data: dict) -> str:
    imk_id = data.get("imk_id")
    return f"imk:{imk_id}" if imk_id is not None else f"field:{data['id']}"


def list_aliases(email: str) -> dict[str, str]:
    with repository.SessionLocal() as session:
        return dict(
            session.execute(
                select(user_field_alias_table.c.field_key, user_field_alias_table.c.alias).where(
                    user_field_alias_table.c.email == email
                )
            ).all()
        )


def update_alias(farm_id, field_id, email, alias, *, simulation_id=None) -> FieldAlias | None:
    with repository.SessionLocal.begin() as session:
        if not repository._member_exists(session, farm_id, email):
            return None
        if simulation_id is None:
            data = session.execute(
                select(field_table.c.data).where(
                    field_table.c.farm_id == farm_id, field_table.c.id == field_id
                )
            ).scalar_one_or_none()
        else:
            data = session.execute(
                select(simulation_table.c.fields[field_id]).where(
                    simulation_table.c.farm_id == farm_id,
                    simulation_table.c.id == simulation_id,
                )
            ).scalar_one_or_none()
        if data is None:
            return None
        key = field_key({**data, "id": field_id})
        if alias is None:
            session.execute(
                delete(user_field_alias_table).where(
                    user_field_alias_table.c.email == email,
                    user_field_alias_table.c.field_key == key,
                )
            )
        else:
            session.execute(
                insert(user_field_alias_table)
                .values(email=email, field_key=key, alias=alias)
                .on_conflict_do_update(
                    index_elements=[
                        user_field_alias_table.c.email,
                        user_field_alias_table.c.field_key,
                    ],
                    set_={"alias": alias},
                )
            )
        return FieldAlias(field_key=key, alias=alias)
