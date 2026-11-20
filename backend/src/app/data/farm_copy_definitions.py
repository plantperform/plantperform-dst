"""Copy course-farm definitions and relink their stored simulation references."""

from collections import defaultdict
from uuid import UUID, uuid4, uuid5

from sqlalchemy import insert, select

from app.data.db import (
    economics_module_member_table,
    economics_module_table,
    saedskifte_rotation_group_member_table,
    saedskifte_rotation_group_table,
    simulation_table,
)
from app.domain.economics import STANDARD_ID, EconomicsSnapshot
from app.domain.farm_copy import FarmCopyConflictError
from app.domain.rotation_candidate import RotationCandidateRef
from app.domain.saedskifte import RotationGroupSnapshot, is_custom


def _documents(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _documents(child)
    elif isinstance(value, list):
        for child in value:
            yield from _documents(child)


def _remember(snapshots, source_id, definition):
    if source_id not in snapshots or definition["revision"] > snapshots[source_id]["revision"]:
        snapshots[source_id] = definition


def _definitions(session, table, selected, snapshots, ids, label):
    # Only current selections authorize reading a live definition. Older results
    # can outlive both access to the source and the source itself.
    definitions = snapshots.copy()
    if selected:
        for row in session.execute(select(table).where(table.c.id.in_(selected))).mappings():
            definitions[row.id] = row
    if ids.keys() - definitions.keys():
        raise FarmCopyConflictError(f"{label} mangler i bedriftens gemte data.")
    return definitions


def _variant_id(new_group, variant):
    # The UUID is scoped to its group. The suffix describes udlæg, shifts and manual edits.
    identity, separator, suffix = variant.partition("~")
    return f"{uuid5(UUID(new_group), identity)}{separator}{suffix}"


def _rotation_definition(definition, new_id):
    return {
        **definition,
        "id": new_id,
        "variants": [
            {**variant, "id": _variant_id(new_id, variant["id"])}
            for variant in definition["variants"]
        ],
    }


def _candidate(value, groups):
    group = value.partition(":")[0]
    if not is_custom(group) or value.count(":") < 2:
        return value
    ref = RotationCandidateRef.from_id(value)
    ref.saedskiftevariant = groups[group]
    ref.variant = _variant_id(ref.saedskiftevariant, ref.variant)
    return ref.to_id()


def _rewrite_rotations(doc, groups, snapshots):
    for key in ("rotation_saedskiftevarianter", "saedskiftevarianter"):
        if doc.get(key):
            doc[key] = [groups[v] if is_custom(v) else v for v in doc[key]]
    group_id = doc.get("saedskiftevariant")
    if group_id and is_custom(group_id):
        doc["saedskiftevariant"] = groups[group_id]
        if doc.get("variant"):
            doc["variant"] = _variant_id(groups[group_id], doc["variant"])
    for key in ("rotation_id", "from_rotation_id", "to_rotation_id"):
        if doc.get(key):
            doc[key] = _candidate(doc[key], groups)
    if "codes" in doc and isinstance(doc.get("id"), str):
        doc["id"] = _candidate(doc["id"], groups)
    for key in ("allowed_rotation_ids", "globally_allowed_rotation_ids"):
        if doc.get(key):
            doc[key] = [_candidate(value, groups) for value in doc[key]]
    if doc.get("rotation_groups"):
        copied = {}
        for group_id, definition in doc["rotation_groups"].items():
            if not is_custom(group_id):
                copied[group_id] = definition
                continue
            snapshot = RotationGroupSnapshot.model_validate(definition)
            _remember(snapshots, group_id, snapshot.model_dump(mode="json"))
            copied[groups[group_id]] = _rotation_definition(definition, groups[group_id])
        doc["rotation_groups"] = copied


def copy_definitions(session, state, email):
    setups = [row["data"] for row in state[simulation_table]]
    selected_modules = {
        data["economics_module_id"]
        for data in setups
        if data.get("economics_module_id") not in (None, STANDARD_ID)
    }
    selected_groups = {
        group_id
        for data in setups
        for group_id in data.get("rotation_saedskiftevarianter", [])
        if is_custom(group_id)
    }
    module_ids, group_ids = defaultdict(lambda: str(uuid4())), defaultdict(lambda: str(uuid4()))
    module_snapshots, group_snapshots = {}, {}
    for rows in state.values():
        for doc in _documents(rows):
            if doc.get("source_id") and doc["source_id"] != STANDARD_ID:
                snapshot = EconomicsSnapshot.model_validate(doc)
                _remember(
                    module_snapshots,
                    snapshot.source_id,
                    snapshot.model_dump(mode="json", by_alias=True),
                )
                doc["source_id"] = module_ids[snapshot.source_id]
            module = doc.get("economics_module_id")
            if module and module != STANDARD_ID:
                doc["economics_module_id"] = module_ids[module]
            _rewrite_rotations(doc, group_ids, group_snapshots)

    modules = _definitions(
        session,
        economics_module_table,
        selected_modules,
        module_snapshots,
        module_ids,
        "Et økonomimodul",
    )
    for source_id, new_id in module_ids.items():
        values = {key: modules[source_id][key] for key in ("name", "revision", "overrides")}
        session.execute(insert(economics_module_table).values(id=new_id, **values))
        session.execute(insert(economics_module_member_table).values(module_id=new_id, email=email))

    groups = _definitions(
        session,
        saedskifte_rotation_group_table,
        selected_groups,
        group_snapshots,
        group_ids,
        "Et sædskifte",
    )
    for source_id, new_id in group_ids.items():
        definition = _rotation_definition(groups[source_id], new_id)
        values = {key: definition[key] for key in ("id", "name", "revision", "variants")}
        session.execute(
            insert(saedskifte_rotation_group_table).values(
                **values, driftsform=definition.get("driftsform")
            )
        )
        session.execute(
            insert(saedskifte_rotation_group_member_table).values(group_id=new_id, email=email)
        )
