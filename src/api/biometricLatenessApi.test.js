import { expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => mock }))
import { getBiometricLatenessReviews, decideBiometricLateness } from './biometricLatenessApi'
it('uses only the canonical admin RPCs, preserving evidence/version and exact manual amount', async () => {
  mock.rpc.mockResolvedValue({ data: [], error: null })
  await getBiometricLatenessReviews('2026-11-09', '2026-11-14')
  expect(mock.rpc).toHaveBeenLastCalledWith('admin_get_biometric_lateness_review', { p_start: '2026-11-09', p_end: '2026-11-14' })
  await decideBiometricLateness('2026-11-09', { worker: { id: 'w' }, evidence: { source_fingerprint: 'raw' }, review: { version: 2 } }, 'approved', 30, 2000.25, 'Confirmed')
  expect(mock.rpc).toHaveBeenLastCalledWith('admin_decide_biometric_lateness', { p_date: '2026-11-09', p_entries: [{ worker_id: 'w', decision: 'approved', approved_minutes: 30, deduction_amount: 2000.25, note: 'Confirmed', source_fingerprint: 'raw', expected_version: 2 }] })
  mock.rpc.mockResolvedValue({ error: new Error('Payroll locked') })
  await expect(getBiometricLatenessReviews('2026-11-09')).rejects.toThrow('Payroll locked')
})
