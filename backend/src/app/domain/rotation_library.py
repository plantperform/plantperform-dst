import json
from pathlib import Path

from pydantic import TypeAdapter

from app.domain.rotation import NamedRotation

CURRENT_ROTATION_ID = "current"
ROTATIONS_PATH = Path(__file__).parent / "rotations.json"


def _load_rotation_library() -> list[NamedRotation]:
    rotations = TypeAdapter(list[NamedRotation]).validate_python(
        json.loads(ROTATIONS_PATH.read_text()),
    )
    ids = [rotation.id for rotation in rotations]

    if CURRENT_ROTATION_ID in ids:
        raise ValueError(f"Rotation id '{CURRENT_ROTATION_ID}' is reserved")

    if len(set(ids)) != len(ids):
        raise ValueError("Rotation ids must be unique")

    return rotations


ROTATION_LIBRARY = _load_rotation_library()
ROTATION_LIBRARY_BY_ID = {rotation.id: rotation for rotation in ROTATION_LIBRARY}


def default_allowed_rotation_ids() -> list[str]:
    return [CURRENT_ROTATION_ID, *ROTATION_LIBRARY_BY_ID.keys()]


def validate_allowed_rotation_ids(value: list[str]) -> list[str]:
    if not value:
        raise ValueError("Allowed rotations must contain at least one rotation")

    unknown_ids = [
        rotation_id
        for rotation_id in value
        if rotation_id != CURRENT_ROTATION_ID and rotation_id not in ROTATION_LIBRARY_BY_ID
    ]
    if unknown_ids:
        raise ValueError(f"Unknown allowed rotation id: {unknown_ids[0]}")

    if len(set(value)) != len(value):
        raise ValueError("Allowed rotations must be unique")

    return value
