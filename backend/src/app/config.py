"""Application configuration loaded from the backend environment."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_BACKEND_ROOT / ".env")
load_dotenv()

_DEFAULT_ROTATION_START_CALENDAR_YEAR = 2027


def _read_rotation_start_calendar_year() -> int:
    value = os.getenv(
        "ROTATION_START_CALENDAR_YEAR",
        str(_DEFAULT_ROTATION_START_CALENDAR_YEAR),
    )
    try:
        year = int(value)
    except ValueError as error:
        raise RuntimeError(
            "ROTATION_START_CALENDAR_YEAR must be a positive integer"
        ) from error
    if year < 1:
        raise RuntimeError("ROTATION_START_CALENDAR_YEAR must be a positive integer")
    return year


ROTATION_START_CALENDAR_YEAR = _read_rotation_start_calendar_year()
