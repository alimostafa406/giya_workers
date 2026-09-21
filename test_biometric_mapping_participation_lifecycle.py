"""Regression checks for confirmed-mapping participation lifecycle SQL."""

import unittest
from pathlib import Path
from types import SimpleNamespace

from hikvision_attendance_verification import biometric_verification_scope, worker_identity_queries


MIGRATION = Path(__file__).parent / 'supabase' / 'sql' / 'biometric_mapping_participation_lifecycle.sql'


def resolution(state='enrolled'):
    return {
        'workers': {'kasiki': {'id': 'kasiki', 'is_active': True}, 'ben2': {'id': 'ben2', 'is_active': True}},
        'classifications': {'kasiki': 'normal', 'ben2': 'normal'},
        'biometric_participation': {'kasiki': state, 'ben2': 'not_enrolled'},
        'confirmed': {('office-main', '73'): {'worker_id': 'kasiki', 'device_id': 'office-main', 'device_employee_no': '73'}},
        'unconfirmed': set(), 'mapping_conflicts': set(), 'ignored': set(), 'existing_attendance': {},
    }


class BiometricMappingParticipationLifecycleTests(unittest.TestCase):
    def test_confirmed_mapping_trigger_enrolls_future_mapping_atomically(self):
        sql = MIGRATION.read_text(encoding='utf-8')
        self.assertIn('after insert or update on public.biometric_worker_mapping', sql)
        self.assertIn("new.is_active is true and new.mapping_review_state = 'confirmed'", sql)
        self.assertIn("'confirmed_active_mapping_trigger'", sql)
        self.assertIn("participation_state = 'enrolled'", sql)
        self.assertIn('security definer', sql)

    def test_backfill_repairs_missing_or_unknown_confirmed_mapping_participation(self):
        sql = MIGRATION.read_text(encoding='utf-8')
        self.assertIn("'confirmed_active_mapping_lifecycle_backfill'", sql)
        self.assertIn("where public.worker_biometric_participation.participation_state = 'unknown'", sql)
        self.assertIn("mapping.is_active is true", sql)
        self.assertIn("mapping.mapping_review_state = 'confirmed'", sql)

    def test_explicit_not_enrolled_is_not_changed_by_backfill(self):
        sql = MIGRATION.read_text(encoding='utf-8')
        backfill = sql.split('-- Backfill the lifecycle gap', 1)[1]
        self.assertNotIn("participation_state = 'not_enrolled'", backfill)
        self.assertIn("participation_state = 'unknown'", backfill)

    def test_enrolled_confirmed_mapping_is_in_verification_scope_and_queries_exact_device_identity(self):
        current = resolution()
        scope = biometric_verification_scope(current)
        self.assertIn('kasiki', scope['enrolled'])
        self.assertNotIn('kasiki', scope['unknown'])
        queries = worker_identity_queries('kasiki', current, [SimpleNamespace(device_id='office-main')])
        self.assertEqual([(device.device_id, identity) for device, identity in queries], [('office-main', '73')])

    def test_unrelated_not_enrolled_worker_remains_outside_enrolled_scope(self):
        scope = biometric_verification_scope(resolution())
        self.assertIn('ben2', scope['not_enrolled'])
        self.assertNotIn('ben2', scope['enrolled'])


if __name__ == '__main__':
    unittest.main()
