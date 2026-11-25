"""Shared rotation definitions and access through current simulation selections."""

from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import delete, func, insert, literal, select, update

from app.data import membership, repository, simulation_store
from app.data.db import saedskifte_rotation_group_member_table as members
from app.data.db import saedskifte_rotation_group_table as groups
from app.data.db import simulation_result_table as results
from app.data.db import simulation_table as setups
from app.data.rotation_snapshot_store import load_selected as load_selected
from app.data.rotation_snapshot_store import resolve_selected as resolve_selected
from app.domain.optimization import ACTIVE_STATUSES
from app.domain.saedskifte import (
    RotationGroup,
    RotationGroupConflictError,
    RotationGroupNotFoundError,
    RotationGroupSnapshot,
    RotationPosition,
    RotationVariant,
)
from app.services.rotations import custom, saedskifte_library


def selected_by_user(session, email):
    return set(session.scalars(membership.rotations.selected_ids(email)))


def _row(session, group_id, email, *, lock=False):
    row = membership.rotations.definition(session, group_id, email, for_edit=lock)
    if row is None:
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


def _model(row):
    return RotationGroup.model_validate({**row._mapping, "can_copy": True})


def list_groups(email, standard=None):
    with repository.SessionLocal() as session:
        standards = []
        if standard is not False:
            allowed = selected_by_user(session, email)
            standards = [
                _standard(group_id).model_copy(update={"can_copy": group_id in allowed})
                for group_id in saedskifte_library.list_saedskifter()
            ]
        if standard:
            return standards
        rows = session.execute(
            membership.rotations.visible(email).order_by(groups.c.created_at, groups.c.id)
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
        .returning(groups, literal("editor").label("effective_role"))
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
            .returning(groups, literal("editor").label("effective_role"))
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
        if custom.is_custom(group_id):
            source = _model(_row(session, group_id, email))
        else:
            if group_id not in selected_by_user(session, email):
                raise RotationGroupNotFoundError
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
            status in ACTIVE_STATUSES for status in states
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
        entries = membership.rotations.list(session, group_id, email)
        if entries is None:
            raise RotationGroupNotFoundError
        return [entry.email for entry in entries]


def add_member(group_id, email, member_email):
    with repository.SessionLocal.begin() as session:
        result = membership.rotations.add(session, group_id, email, member_email)
        if result in ("not_found", "user_not_found"):
            raise RotationGroupNotFoundError
        if result == "already_member":
            raise RotationGroupConflictError("User is already a rotation member")


def remove_member(group_id, email, member_email):
    with repository.SessionLocal.begin() as session:
        result = membership.rotations.change(session, group_id, email, member_email, None)
        if result in ("not_found", "member_not_found"):
            raise RotationGroupNotFoundError
        if result == "last_member":
            raise RotationGroupConflictError("A rotation must have at least one editor")


def resolve_for_farm(farm_id, ids, email):
    with repository.SessionLocal() as session:
        if not repository._member_exists(session, farm_id, email):
            raise RotationGroupNotFoundError
        return resolve_selected(session, ids, email=email)


def available_for_farm(farm_id, email):
    with repository.SessionLocal() as session:
        if not repository._member_exists(session, farm_id, email):
            raise RotationGroupNotFoundError
        groups_by_id = {
            row.id: RotationGroupSnapshot.model_validate(row._mapping)
            for row in session.execute(membership.rotations.visible(email))
        }
        return groups_by_id, groups_by_id.keys() | selected_by_user(session, email)


def snapshots_outdated(session, snapshots):
    if not snapshots:
        return False
    revisions = dict(
        session.execute(
            select(groups.c.id, groups.c.revision).where(groups.c.id.in_(snapshots))
        ).all()
    )
    return any(revisions.get(key) != value["revision"] for key, value in snapshots.items())
