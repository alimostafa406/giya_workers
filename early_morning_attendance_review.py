"""Narrow safety boundary for ambiguous early-morning biometric events.

Events from 01:00 through 05:59 Africa/Kinshasa require an explicit admin
decision.  This module deliberately contains no session-assignment logic.
"""

from __future__ import annotations

from datetime import datetime, time


EARLY_MORNING_REVIEW_START = time(1, 0)
EARLY_MORNING_REVIEW_END_EXCLUSIVE = time(6, 0)


def is_early_morning_review_time(value: datetime | time) -> bool:
    """Return whether a Kinshasa-local wall-clock value needs manual review."""
    wall_time = value.timetz().replace(tzinfo=None) if isinstance(value, datetime) else value.replace(tzinfo=None)
    return EARLY_MORNING_REVIEW_START <= wall_time < EARLY_MORNING_REVIEW_END_EXCLUSIVE


def partition_early_morning_events(
    events: list[dict],
    *,
    parse_timestamp,
) -> tuple[list[dict], list[dict]]:
    """Split events without modifying them; malformed timestamps stay automatic.

    Malformed timestamps continue into the existing planner, which already
    rejects them through its normal parsing path.  This helper therefore does
    not broaden or otherwise alter behavior outside the review window.
    """
    review: list[dict] = []
    automatic: list[dict] = []
    for event in events:
        try:
            needs_review = is_early_morning_review_time(parse_timestamp(str(event.get('time') or '')))
        except (TypeError, ValueError):
            needs_review = False
        (review if needs_review else automatic).append(event)
    return review, automatic
