import unittest
from datetime import date
from pathlib import Path

from hikvision_attendance_sync import plan_attendance, resolved_biometric_event_rows

TARGET_DATE = date(2026, 8, 31)
WORKER_ID = 'inactive-worker'

def event():
    return {'major': 5, 'minor': 75, 'employeeNoString': '15', 'serialNo': 'morning', 'time': '2026-08-31T07:55:39+01:00', '_device_id': 'office-main'}

def inactive_resolution():
    mapping = {'worker_id': WORKER_ID, 'device_id': None, 'device_employee_no': '15', 'mapping_review_state': 'confirmed'}
    return {
        'confirmed': {(None, '15'): mapping}, 'unconfirmed': set(), 'ignored': set(),
        'workers': {WORKER_ID: {'id': WORKER_ID, 'full_name': 'CHADRACK', 'is_active': False, 'team_id': 'team-kept'}},
        'classifications': {WORKER_ID: 'normal'}, 'existing_attendance': {},
    }

class ManualOnlyReactivationTests(unittest.TestCase):
    def test_inactive_worker_event_is_preserved_without_operational_worker_ownership(self):
        rows = resolved_biometric_event_rows([event()], inactive_resolution(), TARGET_DATE)
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]['worker_id'])
        self.assertEqual(rows[0]['device_employee_no'], '15')

    def test_attendance_planning_never_reactivates_or_reenters_inactive_worker(self):
        resolution = inactive_resolution()
        plans, counters = plan_attendance([event()], resolution, TARGET_DATE)
        self.assertEqual(plans, [])
        self.assertEqual(counters['ignored_inactive_worker'], 1)
        self.assertFalse(resolution['workers'][WORKER_ID]['is_active'])

    def test_agent_and_sync_have_no_automatic_reactivation_caller(self):
        agent = Path('hikvision_attendance_agent.py').read_text(encoding='utf-8')
        sync = Path('hikvision_attendance_sync.py').read_text(encoding='utf-8')
        combined = f'{agent}\n{sync}'
        self.assertNotIn('auto_reactivate_inactive_workers', combined)
        self.assertNotIn('reactivate_worker_from_persisted_biometric_event', combined)
        self.assertNotIn('/rpc/reactivate_worker_from_biometric_event', combined)

    def test_legacy_service_role_rpc_is_disabled_with_42501(self):
        sql = Path('supabase/sql/disable_biometric_auto_reactivation.sql').read_text(encoding='utf-8')
        self.assertIn('from public, anon, authenticated, service_role', sql)
        self.assertIn("errcode='42501'", sql)
        self.assertNotIn('set is_active = true', sql)

    def test_only_explicit_admin_helper_sets_worker_active(self):
        api = Path('src/api/workersApi.js').read_text(encoding='utf-8')
        page = Path('src/pages/InactiveWorkers.jsx').read_text(encoding='utf-8')
        self.assertIn('export const reactivateWorkerRequest', api)
        self.assertIn('is_active: true', api)
        self.assertIn('window.confirm(text.reactivateConfirm)', page)
        self.assertIn('await reactivateWorkerRequest(worker)', page)
        self.assertIn('updateWorkerRequest(worker.id', api)

if __name__ == '__main__':
    unittest.main()
