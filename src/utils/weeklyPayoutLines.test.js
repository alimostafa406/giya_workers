import { expect, it, vi } from 'vitest'
vi.mock('../lib/supabase', () => ({ getSupabaseClient: vi.fn() }))
import { assertWeeklyPayoutDraftReady, assertWeeklyPayoutSnapshotComplete, weeklyPayoutLines, weeklyPayoutSnapshotLines } from './weeklyPayoutLines'
import { payrollDraftEligibleLines, weeklyPayrollTotalsByCurrency } from './weeklyPayrollEligibility'
import { payrollDraftLinePayload } from '../api/payrollOperationsApi'
import { teamWeeklyReport } from './teamWeeklyReport'
import { staleWeeklyPayrollWorkerIds } from './weeklyPayrollDraftFreshness'

const monday = '2026-10-19', saturday = '2026-10-24'
const worker = (id, payment_type = 'weekly', team = 'Team') => ({ id, full_name: id, employee_code: id, team_id: team, team_name: team,
  payment_type, is_active: true, staff_classification: 'normal', monthly_salary: 999999,
  payroll_compensation: { daily_rate: 100, daily_transport_allowance: 10, monthly_salary: 999999, currency_code: 'CDF', overtime_rate_per_hour: 20 } })
const row = (id, date = monday, extra = {}) => ({ worker_id: id, attendance_date: date, status: 'present', attendance_day_fraction: 1, check_in: '08:00', check_out: '23:00', ...extra })
const manual = (minutes) => ({ manual_override: true, emergency_overtime_mode: 'manual_overtime_duration', emergency_overtime_minutes: minutes })
function fixture() {
  return { workers: [worker('override'), worker('daily'), worker('outside'), worker('biometric'), worker('monthly', 'monthly', 'Other')],
    attendance: [row('override'), row('daily', monday, manual(120)), row('daily', '2026-10-20', manual(30)), row('outside'), row('biometric'), row('monthly')],
    weeklyOvertimeOverrides: [{ worker_id: 'override', minutes: 1500 }, { worker_id: 'monthly', minutes: 300 }],
    outsideWorkMovements: [{ id: 'final-movement', work_date: monday, status: 'final', outside_work_movement_workers: [
      { worker_id: 'daily', start_time: '08:00', end_time: '20:00' }, { worker_id: 'outside', start_time: '08:00', end_time: '19:30' }] },
    { id: 'draft', work_date: monday, status: 'draft', outside_work_movement_workers: [{ worker_id: 'biometric', start_time: '08:00', end_time: '23:00' }] }],
    rules: {}, runs: [], holidays: [], payrollLines: [], payrollAdjustments: [] }
}

it('weekly save population includes marked monthly OT only, never monthly salary', () => {
  const d = fixture(), lines = weeklyPayoutLines(d, monday)
  expect(lines.map((line) => line.worker.id)).toEqual(['override','daily','outside','biometric','monthly'])
  expect(payrollDraftEligibleLines('weekly', lines, saturday)).toEqual(lines)
  expect(lines.find((line) => line.worker.id === 'monthly')).toMatchObject({ paymentType: 'monthly', monthlyOvertimeOnly: true,
    baseAmount: 0, attendanceWage: 0, transportAmount: 10, holidayAmount: 0, monthlySalary: 0, absenceDeduction: 0, overtimeHours: 5, overtimeAmount: 100, finalAmount: 110 })
})

it.each(['reviewed','finalized','paid'])('all overtime sources and team/grand totals survive %s snapshot without live recalculation', (status) => {
  const d = fixture(), lines = weeklyPayoutLines(d, monday), current = teamWeeklyReport(d, monday)
  const eligible = payrollDraftEligibleLines('weekly', lines, saturday)
  const payload = eligible.map((line) => payrollDraftLinePayload('run', line, monday, saturday, saturday))
  expect(() => assertWeeklyPayoutDraftReady(payload, eligible)).not.toThrow()
  expect(() => assertWeeklyPayoutSnapshotComplete(payload)).not.toThrow()
  const expectedMinutes = { override: 1500, daily: 150, outside: 150, biometric: 0, monthly: 300 }
  for (const snapshot of payload) {
    const id = snapshot.worker_id
    expect(snapshot.calculation_snapshot.evening_overtime_minutes).toBe(expectedMinutes[id])
    expect(snapshot.overtime_hours).toBe(expectedMinutes[id] / 60)
    expect(snapshot.overtime_amount).toBe(expectedMinutes[id] / 60 * 20)
    expect(snapshot.compensation_snapshot.overtime_rate_per_hour).toBe(20)
    expect(snapshot.attendance_summary_snapshot.weekly_payout_source_version).toBe(3)
    expect(snapshot.attendance_summary_snapshot.effective_overtime_sources).toEqual(id === 'override' || id === 'monthly' ? ['weekly_manual_override'] : id === 'biometric' ? [] : id === 'daily' ? ['daily_manual'] : ['outside_work'])
    expect(snapshot.attendance_summary_snapshot.payable_overtime_days).toEqual(lines.find((line) => line.worker.id === id).payableOvertimeDays)
  }
  expect(payload.find((s) => s.worker_id === 'monthly')).toMatchObject({ payment_type_snapshot: 'monthly', base_amount: 0, transport_amount: 10, final_amount: 110,
    attendance_summary_snapshot: { monthly_overtime_only: true } })
  const frozenPayload = JSON.stringify(payload)
  d.runs = [{ id: 'run', payment_type: 'weekly', weekly_period_start: monday, weekly_period_end: saturday, status }]; d.payrollLines = payload
  // Later data must not change reviewed values or add a new monthly worker.
  d.workers = d.workers.map((w) => ({ ...w, is_active: false, team_id: 'changed', team_name: 'Changed', payroll_compensation: { ...w.payroll_compensation, overtime_rate_per_hour: 999 } }))
  d.workers.push(worker('later-monthly', 'monthly'))
  d.weeklyOvertimeOverrides = [{ worker_id: 'later-monthly', minutes: 3000 }]; d.attendance = []; d.outsideWorkMovements = []
  const final = teamWeeklyReport(d, monday)
  expect(final.lines.map((line) => line.worker.id)).toEqual(current.lines.map((line) => line.worker.id))
  for (const line of final.lines) {
    const before = current.lines.find((old) => old.worker.id === line.worker.id)
    expect(line).toMatchObject({ minutes: before.minutes, basePay: before.basePay, overtimeAmount: before.overtimeAmount, finalAmount: before.finalAmount })
    expect(line.worker.team_id).toBe(before.worker.team_id)
  }
  expect(final.groups.map((g) => [g.id, g.totals])).toEqual(current.groups.map((g) => [g.id, g.totals]))
  expect(final.totals).toEqual(current.totals)
  expect(weeklyPayrollTotalsByCurrency(lines)).toEqual({ CDF: current.totals.currencies.CDF.finalAmount })
  expect(JSON.stringify(payload)).toBe(frozenPayload)
  expect(weeklyPayoutSnapshotLines(lines)).toHaveLength(5)
})

it('a zero monthly override retains canonical transport without changing weekly base payroll scope', () => {
  const d = fixture(); d.weeklyOvertimeOverrides.find((o) => o.worker_id === 'monthly').minutes = 0
  expect(weeklyPayoutLines(d, monday).find((line) => line.monthlyOvertimeOnly)).toMatchObject({ transportAmount: 10, overtimeAmount: 0, finalAmount: 10 })
})
it('rate/source changes make a draft stale even when overtime duration is unchanged', () => {
  const d = fixture(), before = weeklyPayoutLines(d, monday)
  d.workers[0].payroll_compensation.overtime_rate_per_hour = 25
  expect(staleWeeklyPayrollWorkerIds(before, weeklyPayoutLines(d, monday))).toContain('override')
})
it('review gate rejects missing monthly population, stale rate/source and unresolved overtime instead of freezing zero money', () => {
  const d = fixture(), lines = weeklyPayoutLines(d, monday)
  const stored = lines.map((line) => payrollDraftLinePayload('run', line, monday, saturday, saturday))
  expect(() => assertWeeklyPayoutDraftReady(stored.slice(0,-1), lines)).toThrow('population changed')
  const changedRate = structuredClone(lines); changedRate[0].term.overtime_rate_per_hour = 99
  expect(() => assertWeeklyPayoutDraftReady(stored, changedRate)).toThrow('payout changed')
  const unresolved = structuredClone(lines); unresolved.at(-1).missingRateBlocker = true
  expect(() => assertWeeklyPayoutDraftReady(stored, unresolved)).toThrow('unresolved')
  const legacy = structuredClone(stored); delete legacy[0].attendance_summary_snapshot.weekly_payout_source_version
  expect(() => assertWeeklyPayoutSnapshotComplete(legacy)).toThrow('Reopen Reviewed payroll as Draft')
  const missingRate = structuredClone(stored); missingRate.at(-1).compensation_snapshot.overtime_rate_per_hour = null
  expect(() => assertWeeklyPayoutSnapshotComplete(missingRate)).toThrow('snapshot is incomplete')
})
