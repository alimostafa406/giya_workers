"""Windows-local Attendance Agent for a Hikvision device and Supabase.

Runs only on the office LAN.  It never creates workers or biometric mappings and
only writes attendance through the existing protected/idempotent sync functions.
"""

from __future__ import annotations

import argparse
import logging
import os
import socket
import sys
import time as time_module
from datetime import date as date_type, timedelta
from logging.handlers import RotatingFileHandler
from pathlib import Path

import requests

from hikvision_attendance_sync import (
    RequestDiagnostics,
    SupabaseReadClient,
    attendance_apply_blocked_reason,
    apply_biometric_attendance,
    auto_reactivate_inactive_workers,
    hikvision_events,
    hikvision_events_with_devices,
    load_resolution_data,
    local_now,
    plan_attendance,
    resolved_biometric_event_rows,
    workday_schedule,
    write_summary,
)
from hikvision_user_sync import check_hikvision_reachable, sync_users_dataset
from hikvision_devices import configured_devices
from hikvision_local_config import load_local_hikvision_config, require_local_settings


TEST_ONLY_DATE = date_type(2026, 8, 10)


def previous_workday(today: date_type) -> date_type:
    """Return the immediately preceding scheduled workday; Sunday is skipped."""
    candidate = today - timedelta(days=1)
    while workday_schedule(candidate) is None:
        candidate -= timedelta(days=1)
    return candidate


def completion_plans(plans: list[dict], existing_attendance: dict) -> list[dict]:
    """Recovery may only improve a row that already exists for that workday."""
    return [plan for plan in plans if existing_attendance.get(plan['worker_id'])]


def positive_int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except ValueError:
        return default


def truthy_env(name: str) -> bool:
    return os.environ.get(name, '').strip().lower() in {'1', 'true', 'yes'}


def configured_logger() -> logging.Logger:
    logger = logging.getLogger('hikvision_attendance_agent')
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(formatter)
    logger.addHandler(stream)
    logs_dir = Path(os.environ.get('HIKVISION_AGENT_LOG_DIR', Path(__file__).with_name('logs')))
    logs_dir.mkdir(parents=True, exist_ok=True)
    file_handler = RotatingFileHandler(logs_dir / 'hikvision_attendance_agent.log', maxBytes=1_000_000, backupCount=5, encoding='utf-8')
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    return logger


class AttendanceAgent:
    def __init__(self, dry_run: bool, logger: logging.Logger) -> None:
        self.dry_run = dry_run
        self.logger = logger
        self.agent_id = os.environ.get('HIKVISION_AGENT_ID', socket.gethostname()).strip() or socket.gethostname()
        self.machine_name = socket.gethostname()
        self.last_user_sync_at: str | None = None
        self.last_attendance_sync_at: str | None = None
        self.hikvision_reachable = False
        self.hikvision_probe_failures = 0
        self.last_error: str | None = None
        self.client: SupabaseReadClient | None = None
        self.device_statuses = {device.device_id: {'reachable': False, 'last_successful_read_at': None, 'last_error': None} for device in configured_devices()}

    def status_payload(self, supabase_reachable: bool) -> dict:
        return {
            'agent_id': self.agent_id,
            'machine_name': self.machine_name,
            'last_seen_at': local_now().isoformat(),
            'hikvision_reachable': self.hikvision_reachable,
            'supabase_reachable': supabase_reachable,
            'last_user_sync_at': self.last_user_sync_at,
            'last_attendance_sync_at': self.last_attendance_sync_at,
            'last_error': self.last_error,
        }

    def mark_attendance_sync_success(self) -> None:
        """Record only a completed write cycle; heartbeat remains independent."""
        self.last_attendance_sync_at = local_now().isoformat()

    def probe_hikvision(self) -> tuple[bool, str | None]:
        return check_hikvision_reachable()

    def heartbeat(self) -> None:
        reachable, probe_error = self.probe_hikvision()
        if reachable:
            self.hikvision_probe_failures = 0
            self.hikvision_reachable = True
        else:
            self.hikvision_probe_failures += 1
            # A transient disconnected socket must not immediately turn a known
            # healthy device into a permanent-looking dashboard failure.
            if self.hikvision_probe_failures >= 2:
                self.hikvision_reachable = False
        if probe_error:
            self.last_error = probe_error
        elif self.last_error and self.last_error.startswith('Hikvision '):
            self.last_error = None
        payload = self.status_payload(True)
        # A restarted Agent has no in-memory processing timestamp yet.  Do not
        # erase the last known successful processing time from Supabase merely
        # because a heartbeat happens before the next successful apply cycle.
        if payload['last_attendance_sync_at'] is None:
            payload.pop('last_attendance_sync_at')
        try:
            if self.client is None:
                self.client = SupabaseReadClient(RequestDiagnostics(False))
            self.logger.info('Supabase heartbeat: POST host=%s table=attendance_agent_status on_conflict=agent_id', self.client.host)
            self.client.upsert_agent_status(payload)
            self.client.upsert_agent_device_statuses(self.agent_id, self.device_statuses)
            self.logger.info('Supabase heartbeat succeeded: agent_id=%s', self.agent_id)
        except (RuntimeError, requests.RequestException) as status_error:
            self.logger.error('Supabase status heartbeat failed: %s', self.safe_heartbeat_error(status_error))

    @staticmethod
    def safe_heartbeat_error(error: Exception) -> str:
        """Make configuration/HTTP failures actionable without exposing secrets."""
        if isinstance(error, RuntimeError):
            # require_env errors include only a variable name, never its value.
            return str(error)
        response = getattr(error, 'response', None)
        if response is not None:
            return f'{type(error).__name__} (Supabase HTTP {response.status_code})'
        return f'{type(error).__name__} (Supabase request failed; check URL and network)'

    def sync_users(self) -> bool:
        try:
            result = sync_users_dataset()
            self.last_user_sync_at = local_now().isoformat()
            for device_id in result.get('device_failures', {}):
                self.device_statuses[device_id].update(reachable=False, last_error=result['device_failures'][device_id])
            for device_id, status in self.device_statuses.items():
                if device_id not in result.get('device_failures', {}):
                    status.update(reachable=True, last_successful_read_at=self.last_user_sync_at, last_error=None)
            self.hikvision_reachable = True
            self.hikvision_probe_failures = 0
            self.logger.info('User sync complete: total=%s new=%s existing=%s disappeared=%s', result['total'], result['new'], result['existing'], result['disappeared'])
            return True
        except (RuntimeError, requests.RequestException, ValueError) as error:
            self.logger.error('Hikvision user sync failed: %s: %s', type(error).__name__, error)
            return False

    def persist_observed_biometric_events(self, events: list[dict], resolution: dict, target_date) -> list[dict]:
        """Persist positive observations and return only rows backed by a successful write."""
        rows = resolved_biometric_event_rows(events, resolution, target_date)
        if not rows:
            return []
        try:
            self.client.insert_biometric_attendance_events(rows)
            self.logger.info(
                'Biometric monitoring observations persisted: date=%s observed_events=%s',
                target_date.isoformat(), len(rows),
            )
            return rows
        except (RuntimeError, requests.RequestException, ValueError) as error:
            # Monitoring is deliberately isolated: a failure here must never
            # block or alter the established attendance workflow.
            self.logger.error('Biometric monitoring event persistence failed: %s: %s', type(error).__name__, error)
            return []

    def process_today_attendance(self) -> tuple[bool, str | None]:
        target_date = local_now().date()
        if target_date == TEST_ONLY_DATE:
            self.logger.warning('Attendance cycle skipped: 2026-08-10 is test-only and is never imported automatically.')
            return True, None
        if workday_schedule(target_date) is None:
            self.logger.info('Attendance cycle skipped: Sunday has no automatic normal attendance.')
            return True, None
        diagnostics = RequestDiagnostics(False)
        try:
            events, device_reads = hikvision_events_with_devices(target_date, diagnostics)
            now = local_now().isoformat()
            for device_id, result in device_reads.items():
                if result.get('state') == 'complete':
                    self.device_statuses[device_id].update(reachable=True, last_successful_read_at=now, last_error=None)
                elif result.get('state') == 'partial':
                    self.device_statuses[device_id].update(reachable=True, last_successful_read_at=now, last_error=result.get('error'))
                else:
                    self.device_statuses[device_id].update(reachable=False, last_error=result.get('error'))
            self.client = self.client or SupabaseReadClient(diagnostics)
            resolution = load_resolution_data(self.client, target_date, for_apply=True)
            persisted_rows = self.persist_observed_biometric_events(events, resolution, target_date)
            apply_blocked_reason = attendance_apply_blocked_reason(device_reads)
            reactivation_results = None
            if not self.dry_run and not apply_blocked_reason and persisted_rows:
                reactivation_results = auto_reactivate_inactive_workers(self.client, persisted_rows, resolution)
                if reactivation_results.get('reload_required'):
                    resolution = load_resolution_data(self.client, target_date, for_apply=True)
                self.logger.info('Biometric auto-reactivation: %s', dict(reactivation_results))
            plans, counters = plan_attendance(events, resolution, target_date)
            summary = write_summary(plans, resolution['existing_attendance'], counters)
            if self.dry_run:
                self.logger.info('Attendance dry run: events=%s device_reads=%s %s', len(events), device_reads, dict(summary))
            elif apply_blocked_reason:
                self.logger.error('%s No attendance writes were attempted.', apply_blocked_reason)
                return False, apply_blocked_reason
            else:
                results = apply_biometric_attendance(self.client, plans, resolution['existing_attendance'])
                result_counts = dict(results)
                result_counts['unmapped'] = counters.get('unmapped', 0)
                result_counts['needs_review'] = counters.get('needs_review', 0)
                if reactivation_results is not None:
                    result_counts['workers_reactivated'] = reactivation_results.get('reactivated', 0)
                    result_counts['reactivation_errors'] = reactivation_results.get('errors', 0)
                if results.get('aborted_structural_error'):
                    self.logger.error('Attendance write cycle aborted after structural Supabase error.')
                else:
                    self.logger.info('Attendance apply complete: events=%s %s', len(events), result_counts)
                    self.mark_attendance_sync_success()
            self.hikvision_reachable = True
            self.hikvision_probe_failures = 0
            return True, 'partial_device_failure' if apply_blocked_reason else None
        except (RuntimeError, requests.RequestException, ValueError) as error:
            message = f'{type(error).__name__}: {error}'
            self.logger.error('Attendance cycle failed: %s', message)
            return False, message
        except Exception as error:
            # A malformed device event or planning bug must fail this cycle only.
            # The scheduler loop and its independent heartbeat continue normally.
            message = f'{type(error).__name__}: {error}'
            self.logger.error('Attendance planning cycle failed: %s', message)
            return False, message

    def complete_previous_workday(self) -> tuple[bool, str | None]:
        target_date = previous_workday(local_now().date())
        if target_date == TEST_ONLY_DATE:
            self.logger.warning('Previous workday completion skipped: 2026-08-10 is test-only and is never imported automatically.')
            return True, None
        diagnostics = RequestDiagnostics(False)
        try:
            events, device_reads = hikvision_events_with_devices(target_date, diagnostics)
            now = local_now().isoformat()
            for device_id, result in device_reads.items():
                if result.get('state') == 'complete':
                    self.device_statuses[device_id].update(reachable=True, last_successful_read_at=now, last_error=None)
                elif result.get('state') == 'partial':
                    self.device_statuses[device_id].update(reachable=True, last_successful_read_at=now, last_error=result.get('error'))
                else:
                    self.device_statuses[device_id].update(reachable=False, last_error=result.get('error'))
            self.client = self.client or SupabaseReadClient(diagnostics)
            resolution = load_resolution_data(self.client, target_date, for_apply=True)
            persisted_rows = self.persist_observed_biometric_events(events, resolution, target_date)
            apply_blocked_reason = attendance_apply_blocked_reason(device_reads)
            previously_inactive_ids = {
                worker_id for worker_id, worker in resolution.get('workers', {}).items()
                if worker.get('is_active') is False
            }
            reactivation_results = None
            if not self.dry_run and not apply_blocked_reason and persisted_rows:
                reactivation_results = auto_reactivate_inactive_workers(self.client, persisted_rows, resolution)
                if reactivation_results.get('reload_required'):
                    resolution = load_resolution_data(self.client, target_date, for_apply=True)
                self.logger.info('Previous-workday biometric auto-reactivation: %s', dict(reactivation_results))
            reactivated_worker_ids = {
                worker_id for worker_id in previously_inactive_ids
                if resolution.get('workers', {}).get(worker_id, {}).get('is_active') is True
            }
            plans, counters = plan_attendance(events, resolution, target_date)
            existing = resolution['existing_attendance']
            recovery_plans = [
                plan for plan in plans
                if existing.get(plan['worker_id']) or plan['worker_id'] in reactivated_worker_ids
            ]
            summary = write_summary(recovery_plans, existing, counters)
            if self.dry_run:
                updated = summary.get('update', 0)
                unchanged = summary.get('unchanged', 0) + summary.get('skipped_manual_protected', 0)
            elif apply_blocked_reason:
                self.logger.error('%s No previous-workday attendance writes were attempted.', apply_blocked_reason)
                return False, apply_blocked_reason
            else:
                results = apply_biometric_attendance(self.client, recovery_plans, existing)
                updated = results.get('updated', 0)
                unchanged = results.get('unchanged', 0) + results.get('skipped_manual_protected', 0)
                if results.get('aborted_structural_error'):
                    self.logger.error('Previous-workday attendance write cycle aborted after structural Supabase error.')
                else:
                    self.mark_attendance_sync_success()
            self.logger.info(
                'Previous workday completion: date=%s events=%s updated=%s unchanged=%s',
                target_date.isoformat(), len(events), updated, unchanged,
            )
            self.hikvision_reachable = True
            self.hikvision_probe_failures = 0
            return True, 'partial_device_failure' if apply_blocked_reason else None
        except (RuntimeError, requests.RequestException, ValueError) as error:
            message = f'{type(error).__name__}: {error}'
            self.logger.error('Previous workday completion failed: %s', message)
            return False, message
        except Exception as error:
            message = f'{type(error).__name__}: {error}'
            self.logger.error('Previous workday completion failed: %s', message)
            return False, message

    def run_cycle(self, run_users: bool, run_attendance: bool) -> None:
        error: str | None = None
        if run_users:
            if not self.sync_users():
                error = 'Hikvision user synchronization failed.'
        if run_attendance:
            attendance_ok, attendance_error = self.process_today_attendance()
            error = error or attendance_error
        if error:
            self.last_error = error
        elif run_users or run_attendance:
            self.last_error = None


def run_agent_loop(
    agent: AttendanceAgent,
    *,
    attendance_interval: int,
    users_interval: int,
    heartbeat_interval: int,
    once: bool = False,
    max_iterations: int | None = None,
) -> None:
    """Run scheduled work indefinitely; one unexpected cycle error is never fatal."""
    last_users = 0.0
    last_attendance = 0.0
    last_heartbeat = 0.0
    iterations = 0
    while True:
        now = time_module.monotonic()
        users_due = now - last_users >= users_interval
        attendance_due = now - last_attendance >= attendance_interval
        try:
            if users_due or attendance_due:
                agent.run_cycle(users_due, attendance_due)
                if users_due:
                    last_users = now
                if attendance_due:
                    last_attendance = now
        except KeyboardInterrupt:
            raise
        except Exception as error:
            agent.last_error = f'{type(error).__name__}: {error}'
            agent.logger.exception('Attendance Agent scheduled cycle failed; continuing: %s', agent.last_error)

        heartbeat_due = now - last_heartbeat >= heartbeat_interval
        try:
            if heartbeat_due:
                agent.heartbeat()
                last_heartbeat = now
        except KeyboardInterrupt:
            raise
        except Exception as error:
            agent.last_error = f'{type(error).__name__}: {error}'
            agent.logger.exception('Attendance Agent heartbeat failed; continuing: %s', agent.last_error)

        iterations += 1
        if once or (max_iterations is not None and iterations >= max_iterations):
            return
        next_users = max(0.0, users_interval - (time_module.monotonic() - last_users))
        next_attendance = max(0.0, attendance_interval - (time_module.monotonic() - last_attendance))
        next_heartbeat = max(0.0, heartbeat_interval - (time_module.monotonic() - last_heartbeat))
        time_module.sleep(max(1.0, min(60.0, next_users, next_attendance, next_heartbeat)))


def main() -> int:
    parser = argparse.ArgumentParser(description='Run the local Hikvision Attendance Agent.')
    parser.add_argument('--once', action='store_true', help='Run due user and attendance cycles once, then exit.')
    parser.add_argument('--dry-run', action='store_true', help='Never write attendance; still reads device data and sends status heartbeat.')
    args = parser.parse_args()
    try:
        load_local_hikvision_config()
        configured_devices()
        require_local_settings('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
    except RuntimeError as error:
        print(f'Attendance Agent configuration error: {error}', file=sys.stderr)
        return 2
    logger = configured_logger()
    attendance_interval = positive_int_env('HIKVISION_AGENT_ATTENDANCE_INTERVAL_SECONDS', 300)
    users_interval = positive_int_env('HIKVISION_AGENT_USERS_INTERVAL_SECONDS', 1800)
    heartbeat_interval = positive_int_env('HIKVISION_AGENT_HEARTBEAT_INTERVAL_SECONDS', 60)
    attendance_writes_enabled = truthy_env('HIKVISION_AGENT_ENABLE_ATTENDANCE_WRITES') and not args.dry_run
    agent = AttendanceAgent(not attendance_writes_enabled, logger)
    logger.info('Attendance Agent started: agent_id=%s dry_run=%s attendance_interval=%ss users_interval=%ss heartbeat_interval=%ss', agent.agent_id, agent.dry_run, attendance_interval, users_interval, heartbeat_interval)

    try:
        recovery_ok, recovery_error = agent.complete_previous_workday()
        if not recovery_ok:
            agent.last_error = recovery_error
    except KeyboardInterrupt:
        raise
    except Exception as error:
        agent.last_error = f'{type(error).__name__}: {error}'
        logger.exception('Previous-workday startup recovery failed; continuing: %s', agent.last_error)

    run_agent_loop(
        agent,
        attendance_interval=attendance_interval,
        users_interval=users_interval,
        heartbeat_interval=heartbeat_interval,
        once=args.once,
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
