import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => mocks }))
import { saveWeeklyOvertime } from './weeklyOvertimeApi'
it('writes worker/week minutes only, strips display fields and never writes attendance', async () => {
  mocks.rpc.mockResolvedValue({ data: [{ minutes: 1500 }], error: null })
  await saveWeeklyOvertime({ week: '2026-10-19', entries: [{ worker_id: 'worker', minutes: 1500, expected_version: 2, check_out: '23:00', attendance_date: '2026-10-23' }] })
  expect(mocks.rpc).toHaveBeenCalledWith('admin_set_weekly_overtime', { p_week_start: '2026-10-19', p_entries: [{ worker_id: 'worker', minutes: 1500, expected_version: 2 }] })
  expect(mocks.from).not.toHaveBeenCalled()
})
it('supports explicit zero and clear distinctly, rejects fractional/negative/oversized durations', async () => {
  for (const minutes of [0, null]) await saveWeeklyOvertime({ week: '2026-10-19', entries: [{ worker_id: 'worker', minutes, expected_version: 1 }] })
  for (const minutes of [-1, 8641, 1.5]) await expect(saveWeeklyOvertime({ week: '2026-10-19', entries: [{ worker_id: 'worker', minutes, expected_version: 1 }] })).rejects.toThrow('Invalid weekly duration')
})
