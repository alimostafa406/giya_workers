import unittest
from collections import Counter
from datetime import date
import json
from pathlib import Path

from hikvision_attendance_sync import (
    auto_reactivate_inactive_workers,
    persisted_biometric_events,
    plan_attendance,
    resolved_biometric_event_rows,
)


TARGET_DATE = date(2026, 8, 31)
WORKER_ID = 'inactive-worker'


def event(serial='morning', employee_no='15', value='07:55:39', device_id='office-main'):
    return {
        'major': 5,
        'minor': 75,
        'employeeNoString': employee_no,
        'serialNo': serial,
        'time': f'2026-08-31T{value}+01:00',
        '_device_id': device_id,
    }


def resolution(active=False, confirmed=True):
    mapping = {
        'worker_id': WORKER_ID,
        'device_id': None,
        'device_employee_no': '15',
        'mapping_review_state': 'confirmed' if confirmed else 'needs_review',
    }
    return {
        'confirmed': {(None, '15'): mapping} if confirmed else {},
        'unconfirmed': {(None, '15')} if not confirmed else set(),
        'ignored': set(),
        'workers': {WORKER_ID: {'id': WORKER_ID, 'full_name': 'CHADRACK', 'is_active': active, 'team_id': 'team-kept'}},
        'classifications': {WORKER_ID: 'normal'},
        'existing_attendance': {},
    }


class ReactivationClient:
    def __init__(self, outcome='reactivated'):
        self.outcome = outcome
        self.calls = []

    def reactivate_worker_from_persisted_biometric_event(self, device_id, event_identity):
        self.calls.append((device_id, event_identity))
        return {'worker_id': WORKER_ID if self.outcome != 'ambiguous_mapping' else None, 'outcome': self.outcome}


class PersistedEventClient:
    def read(self, table, select, **filters):
        assert table == 'biometric_attendance_events'
        assert filters == {'attendance_date': 'eq.2026-08-31'}
        return [{
            'id': 'event-row',
            'attendance_date': '2026-08-31',
            'event_timestamp': '2026-08-31T06:55:39+00:00',
            'device_id': 'office-main',
            'device_employee_no': '15',
            'device_name': 'chadrack',
            'event_identity': json.dumps(['serial', 'office-main', 'real-device-serial'], separators=(',', ':')),
        }]


class BiometricAutoReactivationTests(unittest.TestCase):
    def test_inactive_confirmed_owner_uses_persisted_event_reference(self):
        inactive = resolution(active=False)
        rows = resolved_biometric_event_rows([event()], inactive, TARGET_DATE)
        self.assertIsNone(rows[0]['worker_id'])
        client = ReactivationClient()

        result = auto_reactivate_inactive_workers(client, rows, inactive)

        self.assertEqual(result['reactivated'], 1)
        self.assertEqual(result['reload_required'], 1)
        self.assertEqual(client.calls, [('office-main', rows[0]['event_identity'])])

    def test_active_unmapped_and_needs_review_workers_never_request_reactivation(self):
        cases = [
            resolution(active=True),
            {**resolution(active=False), 'confirmed': {}},
            resolution(active=False, confirmed=False),
        ]
        for candidate in cases:
            with self.subTest(candidate=candidate):
                rows = resolved_biometric_event_rows([event()], candidate, TARGET_DATE)
                client = ReactivationClient()
                result = auto_reactivate_inactive_workers(client, rows, candidate)
                self.assertEqual(client.calls, [])
                self.assertEqual(result, Counter())

    def test_database_ambiguity_outcome_never_requests_reload(self):
        inactive = resolution(active=False)
        rows = resolved_biometric_event_rows([event()], inactive, TARGET_DATE)
        client = ReactivationClient('ambiguous_mapping')
        result = auto_reactivate_inactive_workers(client, rows, inactive)
        self.assertEqual(result['ambiguous_mapping'], 1)
        self.assertEqual(result['reload_required'], 0)

    def test_reloaded_worker_uses_real_timestamp_and_existing_attendance_rules(self):
        active = resolution(active=True)
        punches = [
            event('morning', value='07:55:39'),
            event('midday', value='13:44:27', device_id='office-secondary'),
        ]
        plans, _ = plan_attendance(punches, active, TARGET_DATE)
        self.assertEqual(len(plans), 1)
        self.assertEqual(plans[0]['check_in'], '07:55:39')
        self.assertIsNone(plans[0]['check_out'])
        self.assertEqual(plans[0]['proposed_status'], 'half_day')
        self.assertEqual(active['workers'][WORKER_ID]['team_id'], 'team-kept')

    def test_historical_reprocessing_uses_persisted_event_timestamp_and_reference(self):
        events, rows = persisted_biometric_events(PersistedEventClient(), TARGET_DATE)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['employeeNoString'], '15')
        self.assertEqual(events[0]['serialNo'], 'real-device-serial')
        self.assertEqual(events[0]['time'], '2026-08-31T07:55:39+01:00')
        self.assertEqual(events[0]['_persisted_event_id'], 'event-row')
        self.assertEqual(rows[0]['event_identity'], '["serial","office-main","real-device-serial"]')

    def test_existing_manual_override_remains_protected_after_reactivation(self):
        active = resolution(active=True)
        active['existing_attendance'] = {WORKER_ID: {
            'id': 'manual-row',
            'attendance_source': 'manual',
            'manual_override': True,
            'status': 'present',
            'check_in': '08:10:00',
            'check_out': '17:10:00',
        }}
        plans, _ = plan_attendance([event()], active, TARGET_DATE)
        self.assertEqual(plans[0]['existing_attendance_protection'], 'manual_protected')

    def test_sql_is_atomic_audited_and_never_guesses_or_changes_team(self):
        sql = Path('supabase/sql/biometric_auto_reactivation.sql').read_text(encoding='utf-8')
        self.assertIn("m.mapping_review_state = 'confirmed'", sql)
        self.assertIn('m.device_id = v_event.device_id or m.device_id is null', sql)
        self.assertIn('count(distinct m.worker_id)', sql)
        self.assertIn("source = 'biometric_auto_reactivation'", sql)
        self.assertIn('biometric_event_id', sql)
        self.assertIn('set is_active = true', sql)
        self.assertNotIn('set team_id', sql)
        self.assertNotIn('employee_code =', sql)
        self.assertNotIn('full_name =', sql)

    def test_agent_orders_persistence_reactivation_reload_and_planning(self):
        source = Path('hikvision_attendance_agent.py').read_text(encoding='utf-8')
        today = source[source.index('def process_today_attendance'):source.index('def complete_previous_workday')]
        self.assertLess(today.index('persist_observed_biometric_events'), today.index('auto_reactivate_inactive_workers'))
        self.assertLess(today.index('auto_reactivate_inactive_workers'), today.index('load_resolution_data', today.index('auto_reactivate_inactive_workers')))
        self.assertLess(today.index('load_resolution_data', today.index('auto_reactivate_inactive_workers')), today.index('plan_attendance'))


if __name__ == '__main__':
    unittest.main()
