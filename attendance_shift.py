"""Explicit night attendance window; never infers shift from identity or punches."""
from datetime import datetime, time, timedelta

NIGHT_START = time(17, 0)
NIGHT_END = time(6, 30)

def is_night_worker(worker):
    return bool(worker and worker.get('attendance_shift', 'day') == 'night')

def night_window(target_date, timezone):
    return (datetime.combine(target_date, NIGHT_START, tzinfo=timezone),
            datetime.combine(target_date + timedelta(days=1), NIGHT_END, tzinfo=timezone))

def night_event_date(timestamp):
    clock = timestamp.timetz().replace(tzinfo=None)
    if clock >= NIGHT_START:
        return timestamp.date()
    if clock <= NIGHT_END:
        return timestamp.date() - timedelta(days=1)
    return None
