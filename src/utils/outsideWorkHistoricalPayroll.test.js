import { expect, it, vi } from 'vitest'
vi.mock('../lib/supabase', () => ({ getSupabaseClient: vi.fn() }))
import { weeklyPayoutLines } from './weeklyPayoutLines'
import { teamWeeklyReport } from './teamWeeklyReport'

it.each([true, false])('canonical historical FINAL outside-work day remains payable (active=%s), without a supervisor decision', (is_active) => {
  const data = {
    workers: [{ id: 'w', full_name: 'Worker', employee_code: '24', team_id: 't', team_name: 'Team',
      is_active, payment_type: 'weekly', staff_classification: 'normal',
      payroll_compensation: { daily_rate: 100, daily_transport_allowance: 0, overtime_rate_per_hour: 60, currency_code: 'CDF' } }],
    attendance: [{ worker_id: 'w', attendance_date: '2026-10-13', status: 'present', attendance_day_fraction: 1,
      attendance_source: 'outside_work', manual_override: false, check_in: null, check_out: null,
      biometric_sync_metadata: { outside_work: { movement_ids: ['m'], reason: 'working_outside' } } }],
    outsideWorkMovements: [{ id: 'm', status: 'final', work_date: '2026-10-13',
      outside_work_movement_workers: [{ worker_id: 'w', start_time: '08:00', end_time: '17:00' }] }],
    rules: {}, holidays: [], runs: [], payrollLines: [],
  }
  const before = JSON.stringify(data)
  const line = weeklyPayoutLines(data, '2026-10-12')[0]
  expect(line).toMatchObject({ presentDays: 1, baseAmount: 100, finalAmount: 100 })
  const report = teamWeeklyReport(data, '2026-10-12')
  expect(report.lines).toHaveLength(1)
  expect(report.lines[0]).toMatchObject({ basePay: 100, finalAmount: 100 })
  expect(JSON.stringify(data)).toBe(before)
})
