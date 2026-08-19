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
