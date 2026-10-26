import { expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => mock }))
import { persistPayrollDraftRequest } from './payrollOperationsApi'
import { weeklyPayoutLines } from '../utils/weeklyPayoutLines'
import { teamWeeklyReport } from '../utils/teamWeeklyReport'

it('real Save Draft API persists monthly OT-only line and frozen source metadata, without touching monthly salary/attendance', async () => {
  let payload, protectedRun = false
  mock.from.mockImplementation((table) => {
    const query = { table, protected: false, saved: false }
    for (const method of ['select','eq','is','limit','in']) query[method] = () => query
    query.neq = () => { query.protected = true; return query }
    query.upsert = (next) => { payload = next; query.saved = true; return query }
    query.then = (resolve) => Promise.resolve({ error: null, data: table === 'payroll_run'
      ? query.protected ? protectedRun ? [{ id: 'run', status: 'paid' }] : [] : [{ id: 'run', status: 'draft' }]
      : query.saved ? payload.map((p) => ({ id: p.worker_id, worker_id: p.worker_id })) : [] }).then(resolve)
    return query
  })
  const worker = { id: 'monthly', full_name: 'Monthly worker', employee_code: '123', is_active: true, staff_classification: 'normal', payment_type: 'monthly', team_id: 't', team_name: 'Team',
    monthly_salary: 999999, payroll_compensation: { monthly_salary: 999999, currency_code: 'CDF', overtime_rate_per_hour: 20 } }
  const data = { workers: [worker], weeklyOvertimeOverrides: [{ worker_id: worker.id, minutes: 300, version: 2 }], rules: {}, attendance: [] }
  const before = JSON.stringify(data), lines = weeklyPayoutLines(data, '2026-10-19')
  const request = { paymentType: 'weekly', periodStart: '2026-10-19', periodEnd: '2026-10-24', dueDate: '2026-10-24', currency: 'CDF', lines }
  await persistPayrollDraftRequest(request)
  expect(payload).toHaveLength(1)
  expect(payload[0]).toMatchObject({ worker_id: 'monthly', overtime_hours: 5, overtime_amount: 100, base_amount: 0, transport_amount: 0, final_amount: 100,
    attendance_summary_snapshot: { monthly_overtime_only: true, weekly_payout_source_version: 3, weekly_manual_overtime_override_version: 2 } })
  const final = teamWeeklyReport({ ...data, runs: [{ id: 'run', payment_type: 'weekly', weekly_period_start: '2026-10-19', weekly_period_end: '2026-10-24', status: 'finalized' }], payrollLines: payload }, '2026-10-19')
  expect(final.lines[0]).toMatchObject({ minutes: 300, basePay: 0, overtimeAmount: 100, finalAmount: 100 })
  expect(mock.from.mock.calls.every(([table]) => ['payroll_run', 'payroll_line'].includes(table))).toBe(true)
  expect(JSON.stringify(data)).toBe(before)
  protectedRun = true; payload = undefined
  await expect(persistPayrollDraftRequest(request)).rejects.toThrow('cannot be refreshed as Draft')
  expect(payload).toBeUndefined()
})
