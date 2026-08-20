"""Static safety checks for the manual-only atomic worker-and-mapping RPC."""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class CreateWorkerBiometricMappingRpcTests(unittest.TestCase):
    def test_rpc_is_transactional_admin_only_and_does_not_touch_attendance(self):
        source = (ROOT / 'supabase' / 'sql' / 'create_worker_and_confirm_biometric_mapping.sql').read_text(encoding='utf-8')
        self.assertIn('create_worker_and_confirm_biometric_mapping', source)
        self.assertIn('security definer', source)
        self.assertIn('not public.is_admin()', source)
        self.assertIn('insert into public.workers', source)
        self.assertIn('insert into public.biometric_worker_mapping', source)
        self.assertIn("mapping_review_state = 'confirmed'", source)
        self.assertIn('grant execute', source)
        self.assertIn('public.teams as t where t.id = p_team_id and t.is_active', source)
        self.assertIn('public.workers as w where lower(btrim(w.employee_code))', source)
        self.assertIn('from public.biometric_worker_mapping as m', source)
        self.assertIn('where m.device_employee_no = v_device_employee_no', source)
        self.assertIn('("worker_id", payment_type)', source)
        self.assertIn('on conflict ("worker_id") do nothing', source)
        self.assertIn('set "worker_id" = v_worker_id', source)
        self.assertIn('where m.id = v_existing_mapping_id', source)
        self.assertIn('select v_worker_id as "worker_id", v_mapping_id as "mapping_id"', source)
        normalized = source.lower()
        self.assertNotIn('insert into public.attendance', normalized)
        self.assertNotIn('update public.attendance', normalized)
        self.assertNotIn('delete from public.attendance', normalized)

    def test_mapping_page_uses_the_atomic_rpc_path(self):
        source = (ROOT / 'src' / 'pages' / 'BiometricMapping.jsx').read_text(encoding='utf-8')
        api = (ROOT / 'src' / 'api' / 'biometricMappingApi.js').read_text(encoding='utf-8')
        self.assertIn('createWorkerAndConfirmBiometricMappingRequest', source)
        self.assertIn("rpc('create_worker_and_confirm_biometric_mapping'", api)


if __name__ == '__main__':
    unittest.main()
