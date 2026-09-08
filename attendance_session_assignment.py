"""Pure, non-writing biometric event-to-session assignment rules.

This module is intentionally disconnected from the production attendance write
path.  It is the shared decision model for shadow evaluation before any future
dual-write or timestamp-authoritative cutover is approved.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta
from typing import FrozenSet


VALID_ATTENDANCE_MAJOR = 5
VALID_ATTENDANCE_MINOR = 75
SAFE_MAPPING_STATES = frozenset({'confirmed_exact', 'confirmed_legacy'})
DEFAULT_CONTINUATION_CUTOFF = time(4, 0)
DEFAULT_MAXIMUM_SESSION_DURATION = timedelta(hours=20)
DEFAULT_OVERTIME_REVIEW_THRESHOLD = timedelta(hours=6)
DEFAULT_RECOGNITION_BURST = timedelta(seconds=5)
SESSION_ASSIGNMENT_ALGORITHM_VERSION = 'cross_midnight_session_v1_shadow'


@dataclass(frozen=True)
class BiometricSessionEvent:
    timestamp: datetime
    device_id: str
    device_employee_no: str
    serial_no: str | None = None
    event_id: str | None = None
    major: int | None = VALID_ATTENDANCE_MAJOR
    minor: int | None = VALID_ATTENDANCE_MINOR

    def stable_key(self) -> tuple:
        if self.serial_no is not None and str(self.serial_no).strip():
            return ('serial', self.device_id, str(self.serial_no).strip())
        return (
            'event', self.device_id, self.device_employee_no,
            self.timestamp.isoformat(), self.major, self.minor,
        )


@dataclass(frozen=True)
class AttendanceSessionState:
    work_date: date
    check_in_at: datetime | None = None
    check_out_at: datetime | None = None
    attendance_source: str = 'biometric'
    manual_override: bool = False
    work_authorized: bool = True
    checkout_start: time = time(16, 30)
    official_end: time = time(17, 0)
    recent_accepted_event_at: datetime | None = None

    @property
    def protected(self) -> bool:
        return self.manual_override or self.attendance_source != 'biometric'


@dataclass(frozen=True)
class SessionAssignmentDecision:
    assigned_work_date: date | None
    assignment_result: str
    attendance_role: str
    assignment_reason: str
    review_required: bool
    status_candidate: str | None = None
    overtime_review_required: bool = False
    negative_evidence_allowed: bool = False

    def to_dict(self) -> dict:
        result = asdict(self)
        result['assigned_work_date'] = (
            self.assigned_work_date.isoformat() if self.assigned_work_date else None
        )
        return result


def _decision(
    work_date: date | None,
    result: str,
    role: str,
    reason: str,
    *,
    review: bool = False,
    overtime_review: bool = False,
    coverage_complete: bool = False,
) -> SessionAssignmentDecision:
    return SessionAssignmentDecision(
        assigned_work_date=work_date,
        assignment_result=result,
        attendance_role=role,
        assignment_reason=reason,
        review_required=review,
        status_candidate=(
            'half_day' if role == 'check_in' else 'present' if role == 'check_out' else None
        ),
        overtime_review_required=overtime_review,
        # The assignment model only consumes positive evidence. This flag is
        # exposed so callers cannot accidentally derive a negative decision
        # from incomplete device coverage.
        negative_evidence_allowed=coverage_complete,
    )


def _chronological_boundary(work_date: date, value: time, template: datetime) -> datetime:
    return datetime.combine(work_date, value, tzinfo=template.tzinfo)


def _overtime_needs_review(
    event_at: datetime,
    session: AttendanceSessionState,
    threshold: timedelta,
) -> bool:
    official_end = _chronological_boundary(session.work_date, session.official_end, event_at)
    overtime = event_at - official_end
    return event_at.date() > session.work_date or overtime > threshold


def _role_for_current_session(
    event: BiometricSessionEvent,
    session: AttendanceSessionState,
    *,
    assignment_result: str,
    coverage_complete: bool,
    overtime_review_threshold: timedelta,
) -> SessionAssignmentDecision:
    if session.protected:
        return _decision(
            session.work_date, 'ambiguous_review', 'none', 'current_session_manual_protected',
            review=True, coverage_complete=coverage_complete,
        )
    if not session.work_authorized:
        return _decision(
            session.work_date, 'ambiguous_review', 'none', 'current_day_work_not_authorized',
            review=True, coverage_complete=coverage_complete,
        )
    if session.check_in_at is None or event.timestamp < session.check_in_at:
        reason = 'new_session_check_in' if session.check_in_at is None else 'earlier_session_check_in_candidate'
        return _decision(
            session.work_date, assignment_result, 'check_in', reason,
            coverage_complete=coverage_complete,
        )
    checkout_boundary = _chronological_boundary(
        session.work_date, session.checkout_start, event.timestamp,
    )
    if event.timestamp >= checkout_boundary and event.timestamp > session.check_in_at:
        if session.check_out_at is not None and event.timestamp <= session.check_out_at:
            return _decision(
                session.work_date, assignment_result, 'intermediate',
                'not_later_than_existing_checkout', coverage_complete=coverage_complete,
            )
        return _decision(
            session.work_date, assignment_result, 'check_out', 'latest_eligible_checkout_candidate',
            overtime_review=_overtime_needs_review(
                event.timestamp, session, overtime_review_threshold,
            ),
            coverage_complete=coverage_complete,
        )
    return _decision(
        session.work_date, assignment_result, 'intermediate',
        'intermediate_before_checkout_eligibility', coverage_complete=coverage_complete,
    )


def assign_biometric_event_to_session(
    *,
    event: BiometricSessionEvent,
    mapped_worker_id: str | None,
    mapping_state: str,
    mapping_device_id: str | None,
    previous_session: AttendanceSessionState | None,
    current_session: AttendanceSessionState | None,
    current_work_date: date | None = None,
    current_day_work_authorized: bool = True,
    current_checkout_start: time = time(16, 30),
    current_official_end: time = time(17, 0),
    continuation_cutoff: time = DEFAULT_CONTINUATION_CUTOFF,
    maximum_session_duration: timedelta = DEFAULT_MAXIMUM_SESSION_DURATION,
    overtime_review_threshold: timedelta = DEFAULT_OVERTIME_REVIEW_THRESHOLD,
    recognition_burst: timedelta = DEFAULT_RECOGNITION_BURST,
    seen_event_keys: FrozenSet[tuple] = frozenset(),
    device_coverage_complete: bool = False,
) -> SessionAssignmentDecision:
    """Return one deterministic session decision without writing any state."""
    event_work_date = current_work_date or event.timestamp.date()
    if event.timestamp.tzinfo is None:
        raise ValueError('event timestamp must be timezone-aware')
    if event.major != VALID_ATTENDANCE_MAJOR or event.minor != VALID_ATTENDANCE_MINOR:
        return _decision(
            None, 'invalid_event_type', 'none', 'not_a_valid_attendance_event',
            coverage_complete=device_coverage_complete,
        )
    if event.stable_key() in seen_event_keys:
        return _decision(
            None, 'duplicate', 'none', 'duplicate_device_event_identity',
            coverage_complete=device_coverage_complete,
        )
    if not mapped_worker_id or mapping_state not in SAFE_MAPPING_STATES:
        return _decision(
            None, 'ambiguous_review', 'none', 'identity_not_safely_mapped',
            review=True, coverage_complete=device_coverage_complete,
        )
    if mapping_state == 'confirmed_exact' and mapping_device_id != event.device_id:
        return _decision(
            None, 'ambiguous_review', 'none', 'exact_mapping_device_mismatch',
            review=True, coverage_complete=device_coverage_complete,
        )

    candidate_sessions = [session for session in (previous_session, current_session) if session]
    for session in candidate_sessions:
        recent = session.recent_accepted_event_at
        if recent is not None and timedelta(0) <= event.timestamp - recent <= recognition_burst:
            return _decision(
                session.work_date, 'duplicate', 'none', 'recognition_burst_duplicate',
                coverage_complete=device_coverage_complete,
            )

    before_boundary = event.timestamp.timetz().replace(tzinfo=None) < continuation_cutoff
    if not before_boundary:
        session = current_session or AttendanceSessionState(
            work_date=event_work_date,
            work_authorized=current_day_work_authorized,
            checkout_start=current_checkout_start,
            official_end=current_official_end,
        )
        return _role_for_current_session(
            event, session, assignment_result='current_session',
            coverage_complete=device_coverage_complete,
            overtime_review_threshold=overtime_review_threshold,
        )

    # An independently established current-date session wins. The event must
    # not be pulled backward merely because its clock time is before 04:00.
    if current_session is not None and current_session.check_in_at is not None:
        return _role_for_current_session(
            event, current_session, assignment_result='current_session',
            coverage_complete=device_coverage_complete,
            overtime_review_threshold=overtime_review_threshold,
        )

    if previous_session is not None and previous_session.check_in_at is not None:
        duration = event.timestamp - previous_session.check_in_at
        if previous_session.protected:
            return _decision(
                previous_session.work_date, 'ambiguous_review', 'none',
                'previous_session_manual_protected', review=True,
                coverage_complete=device_coverage_complete,
            )
        if not previous_session.work_authorized:
            return _decision(
                previous_session.work_date, 'ambiguous_review', 'none',
                'previous_session_work_not_authorized', review=True,
                coverage_complete=device_coverage_complete,
            )
        if duration < timedelta(0) or duration > maximum_session_duration:
            return _decision(
                previous_session.work_date, 'ambiguous_review', 'none',
                'maximum_session_duration_exceeded', review=True,
                coverage_complete=device_coverage_complete,
            )
        return _role_for_current_session(
            event, previous_session, assignment_result='previous_session',
            coverage_complete=device_coverage_complete,
            overtime_review_threshold=overtime_review_threshold,
        )

    session = current_session or AttendanceSessionState(
        work_date=event_work_date,
        work_authorized=current_day_work_authorized,
        checkout_start=current_checkout_start,
        official_end=current_official_end,
    )
    decision = _role_for_current_session(
        event, session, assignment_result='current_session',
        coverage_complete=device_coverage_complete,
        overtime_review_threshold=overtime_review_threshold,
    )
    if decision.attendance_role == 'check_in':
        return SessionAssignmentDecision(
            **{
                **asdict(decision),
                'assignment_reason': 'pre_boundary_new_session_no_prior_open_session',
            }
        )
    return decision
