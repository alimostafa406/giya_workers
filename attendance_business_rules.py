"""Central attendance-day boundaries shared by Hikvision services.

The official shift start is 08:00.  The earlier 04:00 boundary only separates
the current workday from genuine after-midnight/previous-day device activity;
it is configurable on the office machine without changing attendance code.
"""

from __future__ import annotations

import os
from datetime import date, time


VALID_ATTENDANCE_MAJOR = 5
VALID_ATTENDANCE_MINOR = 75
DEFAULT_WORKDAY_BOUNDARY = time(4, 0)
OFFICIAL_START = time(8, 0)
WEEKDAY_OFFICIAL_END = time(17, 0)
SATURDAY_OFFICIAL_END = time(14, 30)
WEEKDAY_CHECKOUT_START = time(16, 30)
SATURDAY_CHECKOUT_START = time(14, 0)
WEEKDAY_FINALIZATION = time(17, 15)
SATURDAY_FINALIZATION = time(14, 45)
END_OF_DAY = time(23, 59, 59)


def _configured_time(name: str, default: time) -> time:
    value = os.environ.get(name, "").strip()
    if not value:
        return default
    try:
        return time.fromisoformat(value).replace(tzinfo=None)
    except ValueError as error:
        raise RuntimeError(f"Invalid {name}; expected HH:MM or HH:MM:SS") from error


def workday_boundary() -> time:
    return _configured_time("HIKVISION_ATTENDANCE_WORKDAY_BOUNDARY", DEFAULT_WORKDAY_BOUNDARY)


def workday_schedule(target_date: date) -> dict | None:
    """Return the one authoritative Monday-Saturday schedule snapshot."""
    weekday = target_date.weekday()
    common = {
        "workday_boundary": workday_boundary(),
        "official_start": OFFICIAL_START,
        "valid_event_major": VALID_ATTENDANCE_MAJOR,
        "valid_event_minor": VALID_ATTENDANCE_MINOR,
        "checkout_end": END_OF_DAY,
    }
    if weekday <= 4:
        return {
            **common,
            "label": "monday_friday",
            "official_end": WEEKDAY_OFFICIAL_END,
            "checkout_start": WEEKDAY_CHECKOUT_START,
            "finalization_time": WEEKDAY_FINALIZATION,
        }
    if weekday == 5:
        return {
            **common,
            "label": "saturday",
            "official_end": SATURDAY_OFFICIAL_END,
            "checkout_start": SATURDAY_CHECKOUT_START,
            "finalization_time": SATURDAY_FINALIZATION,
        }
    return None


def public_schedule(target_date: date) -> dict | None:
    schedule = workday_schedule(target_date)
    if schedule is None:
        return None
    return {
        key: value.strftime("%H:%M:%S") if isinstance(value, time) else value
        for key, value in schedule.items()
    }
