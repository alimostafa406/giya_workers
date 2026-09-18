"""Central attendance-day boundaries shared by Hikvision services."""

from __future__ import annotations

import os
from datetime import date, time


VALID_ATTENDANCE_MAJOR = 5
VALID_ATTENDANCE_MINOR = 75
DEFAULT_WORKDAY_BOUNDARY = time(4, 0)
NORMAL_WORKDAY_START = time(7, 0)
NORMAL_NEXT_DAY_END = time(2, 0)
OFFICIAL_START = time(8, 0)
# Retained original biometric morning window. Normal Monday-Friday attendance
# may accept a later real arrival, but only this bounded window earns the
# Saturday no-checkout full-day exception.
MORNING_CHECKIN_START = time(7, 0)
MORNING_CHECKIN_END = time(9, 0)
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
        # Normal attendance is grouped from 07:00 through 02:00 on the next
        # calendar day.  The configurable legacy boundary is retained for the
        # Chauffeur team until its dedicated night schedule is defined.
        "workday_boundary": NORMAL_WORKDAY_START,
        "legacy_workday_boundary": workday_boundary(),
        "next_day_checkout_end": NORMAL_NEXT_DAY_END,
        "official_start": OFFICIAL_START,
        "morning_checkin_start": MORNING_CHECKIN_START,
        "morning_checkin_end": MORNING_CHECKIN_END,
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
