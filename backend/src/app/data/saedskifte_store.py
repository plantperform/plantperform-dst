"""Shared group lifecycle and explicit access through current simulation selections."""

from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import delete, func, insert, select, update

from app.data import repository, simulation_store
from app.data.db import app_user_table, farm_member_table
from app.data.db import saedskifte_rotation_group_member_table as members
from app.data.db import saedskifte_rotation_group_table as groups
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.data.membership import has_remaining_editor
from app.data.rotation_snapshot_store import is_member as _is_member
from app.data.rotation_snapshot_store import load_selected as load_selected
from app.data.rotation_snapshot_store import resolve_selected as resolve_selected
from app.domain.saedskifte import (
    RotationGroup,
    RotationGroupConflictError,
    RotationGroupNotFoundError,
    RotationGroupSnapshot,
    RotationPosition,
    RotationVariant,
)
from app.services.rotations import custom, saedskifte_library


def selected_by_user(session, email, farm_id=None):
    query = (
        select(setups.c.data["rotation_saedskiftevarianter"])
        .join(farm_member_table, farm_member_table.c.farm_id == setups.c.farm_id)
        .where(farm_member_table.c.email == email)
    )
    if farm_id is not None:
        query = query.where(setups.c.farm_id == farm_id)
    return {group_id for ids in session.execute(query).scalars() for group_id in (ids or [])}


def copyable_ids(session, email):
    return selected_by_user(session, email) | set(
        session.execute(select(members.c.group_id).where(members.c.email == email)).scalars()
    )


def _row(session, group_id, email, *, lock=False):
    query = select(groups).where(groups.c.id == group_id)
    row = session.execute(query.with_for_update() if lock else query).first()
    if row is None or not _is_member(session, group_id, email):
        raise RotationGroupNotFoundError
    return row


def _standard(group_id):
    variants = []
    for variant_id in saedskifte_library.list_variants(group_id):
        raw = saedskifte_library.get_raw_rotation(group_id, variant_id)
        active = raw[: saedskifte_library.rotation_active_len(raw)]
        variants.append(
            RotationVariant(
                id=uuid5(NAMESPACE_URL, f"plantperform:saedskifte:{group_id}:{variant_id}"),
                positions=[
                    RotationPosition(
                        afgrode_kode=code, allowed_udlaeg_koder=[under] if under else []
                    )
                    for code, under, _ in active
                ],
            )
        )
    if not variants:
        raise RotationGroupNotFoundError
    form = saedskifte_library.get_driftsform(group_id)
    return RotationGroup(
        id=group_id,
        name=f"Sædskifte {group_id}",
        variants=variants,
        is_standard=True,
        driftsform=form if form in ("Konventionel", "Økologisk") else None,
    )


def _model(row, *, can_copy=True):
    return RotationGroup.model_validate({**dict(row._mapping), "can_copy": can_copy})


def list_groups(email):
    with repository.SessionLocal() as session:
        allowed = copyable_ids(session, email)
        standards = [
            _standard(group_id).model_copy(update={"can_copy": group_id in allowed})
            for group_id in saedskifte_library.list_saedskifter()
        ]
        rows = session.execute(
            select(groups)
            .join(members)
            .where(members.c.email == email)
            .order_by(groups.c.created_at, groups.c.id)
        )
        return [*standards, *map(_model, rows)]


def get_group(group_id, email):
    with repository.SessionLocal() as session:
        if not custom.is_custom(group_id):
            return _standard(group_id).model_copy(
                update={"can_copy": group_id in selected_by_user(session, email)}
            )
        return _model(_row(session, group_id, email))


def _insert(session, name, variants, driftsform, email):
    group_id = str(uuid4())
    row = session.execute(
        insert(groups)
        .values(
            id=group_id,
            name=name,
            driftsform=driftsform,
            variants=[variant.model_dump(mode="json") for variant in variants],
        )
        .returning(groups)
    ).one()
    session.execute(insert(members).values(group_id=group_id, email=email))
    return _model(row)


def create_group(request, email):
    custom.validate_definition(request.variants, request.driftsform)
    with repository.SessionLocal.begin() as session:
        return _insert(session, request.name, request.variants, request.driftsform, email)


def update_group(group_id, request, email):
    with repository.SessionLocal.begin() as session:
        row = _row(session, group_id, email, lock=True)
        if row.revision != request.expected_revision:
            raise RotationGroupConflictError("Rotation changed; reload before saving")
        values = request.model_dump(mode="json", exclude_unset=True, exclude={"expected_revision"})
        if not values:
            return _model(row)
        updated = RotationGroupSnapshot.model_validate({**dict(row._mapping), **values})
        custom.validate_definition(updated.variants, updated.driftsform)
        row = session.execute(
            update(groups)
            .where(groups.c.id == group_id)
            .values(**values, revision=row.revision + 1, updated_at=func.now())
            .returning(groups)
        ).one()
        selecting = select(setups.c.id).where(
            setups.c.data["rotation_saedskiftevarianter"].contains([group_id])
        )
        # Do not invalidate a running job's setup revision or captured inputs.
        session.execute(
            update(results)
            .where(results.c.simulation_id.in_(selecting), results.c.status == "completed")
            .values(status="outdated")
        )
        return _model(row)


def duplicate_group(group_id, email, name=None):
    with repository.SessionLocal.begin() as session:
        if group_id not in copyable_ids(session, email):
            raise RotationGroupNotFoundError
        if custom.is_custom(group_id):
            row = session.execute(select(groups).where(groups.c.id == group_id)).first()
            if row is None:
                raise RotationGroupNotFoundError
            source = _model(row)
        else:
            source = _standard(group_id)
        variants = [
            variant.model_copy(update={"id": uuid4()}, deep=True) for variant in source.variants
        ]
        return _insert(
            session, name or f"Kopi af {source.name}", variants, source.driftsform, email
        )


def delete_group(group_id, email):
    with repository.SessionLocal.begin() as session:
        _row(session, group_id, email, lock=True)
        selecting = session.execute(
            select(setups)
            .where(setups.c.data["rotation_saedskiftevarianter"].contains([group_id]))
            .order_by(setups.c.id)
            .with_for_update()
        ).all()
        states = session.execute(
            select(results.c.status)
            .where(results.c.simulation_id.in_([row.id for row in selecting]))
            .with_for_update()
        ).scalars()
        if any(row.creation_status in ("queued", "running") for row in selecting) or any(
            status in ("queued", "in_progress") for status in states
        ):
            raise RotationGroupConflictError("A simulation is being calculated; try again later")
        for row in selecting:
            data = {
                **row.data,
                "rotation_saedskiftevarianter": [
                    value
                    for value in row.data.get("rotation_saedskiftevarianter", [])
                    if value != group_id
                ],
            }
            session.execute(update(setups).where(setups.c.id == row.id).values(data=data))
            simulation_store.invalidate(session, row.id)
        session.execute(delete(groups).where(groups.c.id == group_id))


def list_members(group_id, email):
    with repository.SessionLocal() as session:
        _row(session, group_id, email)
        return list(
            session.execute(
                select(members.c.email)
                .where(members.c.group_id == group_id)
                .order_by(members.c.email)
            ).scalars()
        )


def add_member(group_id, email, member_email):
    with repository.SessionLocal.begin() as session:
        _row(session, group_id, email, lock=True)
        user = session.execute(
            select(app_user_table.c.verified_at).where(app_user_table.c.email == member_email)
        ).first()
        if user is None or user.verified_at is None:
            raise RotationGroupNotFoundError
        if _is_member(session, group_id, member_email):
            raise RotationGroupConflictError("User is already a rotation member")
        session.execute(insert(members).values(group_id=group_id, email=member_email))


def remove_member(group_id, email, member_email):
    with repository.SessionLocal.begin() as session:
        _row(session, group_id, email, lock=True)
        emails = list(
            session.execute(select(members.c.email).where(members.c.group_id == group_id)).scalars()
        )
        if member_email not in emails:
            raise RotationGroupNotFoundError
        if not has_remaining_editor(session, emails, member_email):
            raise RotationGroupConflictError("A rotation must have at least one editor")
        session.execute(
            delete(members).where(members.c.group_id == group_id, members.c.email == member_email)
        )


def resolve_for_farm(farm_id, ids, email):
    with repository.SessionLocal() as session:
        if not repository._member_exists(session, farm_id, email):
            raise RotationGroupNotFoundError
        return resolve_selected(
            session, ids, email=email, existing=selected_by_user(session, email, farm_id)
        )


def available_for_farm(farm_id, email):
    with repository.SessionLocal() as session:
        if not repository._member_exists(session, farm_id, email):
            raise RotationGroupNotFoundError
        ids = selected_by_user(session, email, farm_id) | set(
            session.execute(select(members.c.group_id).where(members.c.email == email)).scalars()
        )
        return resolve_selected(session, ids), copyable_ids(session, email)


def snapshots_outdated(session, snapshots):
    if not snapshots:
        return False
    revisions = dict(
        session.execute(
            select(groups.c.id, groups.c.revision).where(groups.c.id.in_(snapshots))
        ).all()
    )
    return any(revisions.get(key) != value["revision"] for key, value in snapshots.items())
