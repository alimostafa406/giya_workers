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
        self.assertIn('on conflict on constraint worker_staff_classification_pkey do nothing', source)
        self.assertIn('set "worker_id" = v_worker_id', source)
        self.assertIn('where m.id = v_existing_mapping_id', source)
        self.assertIn('return query select v_worker_id, v_mapping_id', source)
        normalized = source.lower()
        self.assertNotIn('insert into public.attendance', normalized)
        self.assertNotIn('update public.attendance', normalized)
        self.assertNotIn('delete from public.attendance', normalized)

    def test_returns_table_out_parameters_cannot_collide_with_conflict_targets(self):
        source = (ROOT / 'supabase' / 'sql' / 'create_worker_and_confirm_biometric_mapping.sql').read_text(encoding='utf-8').lower()
        self.assertIn('returns table (worker_id uuid, mapping_id uuid)', source)
        self.assertIn('#variable_conflict error', source)
        self.assertNotRegex(source, r'on\s+conflict\s*\(\s*"?worker_id"?\s*\)')
        self.assertNotRegex(source, r'where\s+worker_id\s*=')
        self.assertNotRegex(source, r'where\s+device_employee_no\s*=')
        self.assertIn('where m.device_employee_no = v_device_employee_no', source)
        self.assertIn('where m.id = v_existing_mapping_id', source)

    def test_database_errors_are_rethrown_with_stage_and_original_diagnostics(self):
        source = (ROOT / 'supabase' / 'sql' / 'create_worker_and_confirm_biometric_mapping.sql').read_text(encoding='utf-8').lower()
        expected_stages = (
            'admin validation',
            'input validation',
            'team validation',
            'employee-code validation',
            'existing mapping lookup',
            'worker insert',
            'worker_payroll_profile insert',
            'worker_staff_classification insert',
            'biometric_worker_mapping insert',
            'biometric_worker_mapping update',
            'return result',
        )
        for stage in expected_stages:
            self.assertIn(f"v_stage := '{stage}'", source)
        self.assertIn('exception\n  when others then', source)
        self.assertIn('get stacked diagnostics', source)
        self.assertIn('v_error_sqlstate = returned_sqlstate', source)
        self.assertIn('v_error_message = message_text', source)
        self.assertIn('v_error_detail = pg_exception_detail', source)
        self.assertIn('v_error_hint = pg_exception_hint', source)
        self.assertIn('v_error_context = pg_exception_context', source)
        self.assertIn('errcode = v_error_sqlstate', source)
        self.assertIn('v_stage,\n          v_error_message', source)
        self.assertIn('original detail:', source)
        self.assertIn('original context:', source)

    def test_exception_instrumentation_preserves_atomic_contract_and_return_shape(self):
        source = (ROOT / 'supabase' / 'sql' / 'create_worker_and_confirm_biometric_mapping.sql').read_text(encoding='utf-8').lower()
        self.assertIn('returns table (worker_id uuid, mapping_id uuid)', source)
        self.assertGreaterEqual(source.count('raise exception using'), 2)
        self.assertNotRegex(source, r'\b(commit|rollback|begin\s+transaction)\b')
        self.assertNotIn('return null', source)

    def test_existing_worker_mapping_uses_direct_guarded_table_path(self):
        source = (ROOT / 'src' / 'pages' / 'BiometricMapping.jsx').read_text(encoding='utf-8')
        api = (ROOT / 'src' / 'api' / 'biometricMappingApi.js').read_text(encoding='utf-8')
        self.assertIn('await completeCriticalBiometricMappingSave({', source)
        self.assertIn("saveMapping: () => saveBiometricMappingRequest({ deviceUser, workerId, reviewState: 'confirmed' })", source)
        save_path = api.split('export const saveBiometricMappingRequest', 1)[1].split('export const setBiometricMappingReviewStateRequest', 1)[0]
        self.assertIn("from('biometric_worker_mapping')", save_path)
        self.assertIn(".eq('device_employee_no', employeeNo)", save_path)
        self.assertIn('String(existingDeviceRecord.worker_id) !== String(workerId)', save_path)
        self.assertNotIn('.rpc(', save_path)

    def test_new_worker_mapping_uses_the_atomic_rpc_path(self):
        source = (ROOT / 'src' / 'pages' / 'BiometricMapping.jsx').read_text(encoding='utf-8')
        api = (ROOT / 'src' / 'api' / 'biometricMappingApi.js').read_text(encoding='utf-8')
        self.assertIn('createWorkerAndConfirmBiometricMappingRequest', source)
        self.assertIn('await completeCriticalBiometricWorkerCreation({', source)
        self.assertIn('createWorker: () => createWorkerAndConfirmBiometricMappingRequest({ deviceUser, fullName, employeeCode, teamId })', source)
        self.assertIn("rpc('create_worker_and_confirm_biometric_mapping'", api)


if __name__ == '__main__':
    unittest.main()
