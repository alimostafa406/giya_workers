import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ from: vi.fn(), query: null }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => mock }))
import { getPayrollOutsideWork } from './payrollOutsideWorkApi'
import { payrollDraftLinePayload } from './payrollOperationsApi'
import { applyManualWeeklyOvertime } from '../utils/weeklyManualOvertime'
beforeEach(() => {
  const q = {}
  for (const key of ['select', 'eq', 'gte', 'lte', 'order']) q[key] = vi.fn(() => q)
  q.range = vi.fn().mockResolvedValue({ data: [], error: null })
  mock.query = q; mock.from.mockReset().mockReturnValue(q)
})
it('bulk reads only FINAL movements in the requested period, without attendance/biometric writes', async () => {
  await getPayrollOutsideWork('2026-10-19', '2026-10-24')
  expect(mock.from.mock.calls).toEqual([['outside_work_movements']])
  expect(mock.query.eq).toHaveBeenCalledWith('status', 'final')
  expect(mock.query.gte).toHaveBeenCalledWith('work_date', '2026-10-19')
  expect(mock.query.lte).toHaveBeenCalledWith('work_date', '2026-10-24')
  expect(mock.query.select.mock.calls[0][0]).toContain('outside_work_movement_workers(worker_id,start_time,end_time)')
})
it('paginates without losing movements; fails closed on a read error', async () => {
  mock.query.range.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null }).mockResolvedValueOnce({ data: [{ id: 500 }], error: null })
  expect(await getPayrollOutsideWork('2026-10-19', '2026-10-24')).toHaveLength(501)
  expect(mock.query.range).toHaveBeenLastCalledWith(500, 999)
  mock.query.range.mockResolvedValue({ data: null, error: new Error('unavailable') })
  await expect(getPayrollOutsideWork('2026-10-19', '2026-10-24')).rejects.toThrow('unavailable')
})
it('draft snapshots preserve effective outside-work minutes, rate, money and source IDs without fake punches', () => {
  const source = { worker: { id: 'w', full_name: 'Worker' }, paymentType: 'weekly', currency: 'CDF',
    term: { currency_code: 'CDF', overtime_rate_per_hour: 10 }, rules: {}, finalAmount: 100, overtimeAmount: 0,
    details: [{ date: '2026-10-19', status: 'present', row: { check_in: null, check_out: null } }] }
  const movement = { id: 'outside', status: 'final', work_date: '2026-10-19', outside_work_movement_workers: [{ worker_id: 'w', start_time: '08:00', end_time: '19:30' }] }
  const before = JSON.stringify(source)
  const effective = applyManualWeeklyOvertime(source, null, [movement])
  const snapshot = payrollDraftLinePayload('run', effective, '2026-10-19', '2026-10-24', '2026-10-24')
  expect(snapshot).toMatchObject({ overtime_hours: 2.5, overtime_amount: 25, final_amount: 125,
    attendance_summary_snapshot: { payable_overtime_source_version: 2, payable_overtime_days: [{ date: '2026-10-19', minutes: 150, source: 'outside_work', movement_ids: ['outside'] }], days: [{ check_in: null, check_out: null }] },
    calculation_snapshot: { evening_overtime_minutes: 150, overtime_pay: 25 } })
  expect(JSON.stringify(source)).toBe(before)
})
