import { expect, it, vi } from 'vitest'
vi.mock('../lib/supabase', () => ({ getSupabaseClient: vi.fn() }))
import { applyWeeklyLateDeductions, latenessStatus } from './biometricLateness'
import { calculateWeeklyPayoutLine, assertWeeklyPayoutDraftReady, assertWeeklyPayoutSnapshotComplete } from './weeklyPayoutLines'
import { payrollDraftLinePayload } from '../api/payrollOperationsApi'
import { applyPayrollAdjustments } from './payrollCalculations'
import { teamWeeklyReport } from './teamWeeklyReport'

const date = '2026-11-09', end = '2026-11-14'
const worker = (payment_type = 'weekly') => ({ id: 'w', full_name: 'Late worker', employee_code: '1', team_id: 't', team_name: 'Team', payment_type, is_active: true,
  staff_classification: 'normal', payroll_compensation: { daily_rate: 10000, daily_transport_allowance: 6000, currency_code: 'CDF', overtime_rate_per_hour: 1000, monthly_salary: 999999 } })
const attendance = { id: 'a', worker_id: 'w', attendance_date: date, attendance_source: 'biometric', status: 'present', attendance_day_fraction: 1, check_in: '08:35:19', check_out: '17:00:00' }
const source = () => ({ worker: worker(), attendance: { ...attendance }, evidence: { scheduled_start: `${date}T08:00:00`, raw_check_in: `${date}T08:35:19`, raw_minutes: 35, source_fingerprint: 'fingerprint' },
  review: { decision: 'approved', version: 1, raw_minutes: 35, approved_minutes: 30, deduction_amount: 2000, source_fingerprint: 'fingerprint' },
  payroll_source: { date, version: 1, source_fingerprint: 'fingerprint', approved_minutes: 30, deduction_amount: 2000, actor: 'admin', decided_at: '2026-11-11T10:00:00+00:00' } })
const data = (payment) => ({ workers: [worker(payment)], attendance: [{ ...attendance }], rules: {}, holidays: [], runs: [], payrollLines: [], latenessReviews: [source()] })

it.each(['weekly', 'monthly'])('%s: approved deduction applies exactly once, preserving wages, transport, OT and raw evidence', (payment) => {
  const d = data(payment), before = JSON.stringify(d)
  const plain = calculateWeeklyPayoutLine({ ...d, latenessReviews: [] }, date, d.workers[0])
  const line = calculateWeeklyPayoutLine(d, date, d.workers[0])
  expect(line.lateDeduction).toBe(2000)
  expect(line.finalAmount).toBe(plain.finalAmount - 2000)
  expect(line.deductionAmount).toBe(2000)
  expect(line.baseAmount).toBe(plain.baseAmount)
  if (payment === 'monthly') { expect(line.baseAmount).toBe(0); expect(line.finalAmount).toBe(line.transportAmount + line.overtimeAmount - 2000) }
  expect(applyWeeklyLateDeductions(line, [...d.latenessReviews, ...d.latenessReviews])).toEqual(line)
  expect(JSON.stringify(d)).toBe(before)
  const adjusted = applyPayrollAdjustments(line, [{ adjustment_type: 'deduction', amount: 500 }])
  expect(adjusted.deductionAmount).toBe(2500)
  expect(adjusted.finalAmount).toBe(line.finalAmount - 500)
})

it.each(['pending', 'rejected', 'stale'])('%s reviews never deduct', (status) => {
  const d = data(), s = d.latenessReviews[0]
  if (status === 'pending') s.review = null
  else if (status === 'stale') s.evidence.source_fingerprint = 'changed'
  else s.review.decision = status
  expect(latenessStatus(s)).toBe(status)
  expect(calculateWeeklyPayoutLine(d, date, d.workers[0]).lateDeduction).toBe(0)
})

it('changed check-in between separate payroll/review reads cannot deduct; CDF is never treated as another currency', () => {
  const d = data(); d.attendance[0].check_in = '08:30:00'
  expect(calculateWeeklyPayoutLine(d, date, d.workers[0]).lateDeduction).toBe(0)
  d.workers[0].payroll_compensation.currency_code = 'USD'
  expect(calculateWeeklyPayoutLine(d, date, d.workers[0]).lateDeduction).toBe(0)
})

it.each(['weekly', 'monthly'])('%s report, team/grand totals and frozen snapshot deduct once; review versions protect draft', (payment) => {
  const d = data(payment), line = calculateWeeklyPayoutLine(d, date, d.workers[0])
  const payload = payrollDraftLinePayload('run', line, date, end, end)
  expect(payload.calculation_snapshot.late_deduction).toBe(2000)
  expect(payload.attendance_summary_snapshot.lateness_deductions).toEqual([source().payroll_source])
  expect(() => assertWeeklyPayoutDraftReady([payload], [line])).not.toThrow()
  expect(() => assertWeeklyPayoutSnapshotComplete([payload])).not.toThrow()
  expect(() => assertWeeklyPayoutDraftReady([payload], [{ ...line, latenessDeductions: [{ ...source().payroll_source, version: 2 }] }])).toThrow('payout changed')
  const report = teamWeeklyReport(d, date)
  expect(report.lines[0].finalAmount).toBe(line.finalAmount)
  expect(report.lines[0].lateDeduction).toBe(2000)
  expect(report.lines[0].basePay).toBe(line.attendanceWage)
  expect(report.groups[0].totals.currencies.CDF.lateDeduction).toBe(2000)
  expect(report.totals.currencies.CDF.finalAmount).toBe(line.finalAmount)
  d.payrollLines = [payload]; d.runs = [{ id: 'run', payment_type: 'weekly', weekly_period_start: date, weekly_period_end: end, status: 'paid' }]
  d.latenessReviews = []; d.attendance = []
  expect(teamWeeklyReport(d, date).totals).toEqual(report.totals)
})
