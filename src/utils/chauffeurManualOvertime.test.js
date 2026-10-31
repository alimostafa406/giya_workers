import { expect, it } from 'vitest'
import { weeklyPayoutLines } from './weeklyPayoutLines'
import { teamWeeklyReport } from './teamWeeklyReport'
import { weeklyPayrollOvertimeForDetail, weeklyPayrollOvertimeForLine } from './weeklyPayrollOvertime'
import { biometricOvertimeMinutes, biometricReviewRows } from './biometricOvertimeReview'
import { isWeeklyOvertimeEligibleWorker, isBiometricOvertimeEligibleWorker } from './overtimeWorkerScope'
import { teamReportDayOvertime } from './teamWeeklyReportDayOvertime'
const week = '2026-10-26'
function data() {
  const worker = { id: 'payike', full_name: 'PAYIKE', employee_code: '63', team_id: 'driver', team_name: 'Chauffeur', payment_type: 'monthly',
    is_active: true, staff_classification: 'normal', payroll_compensation: { daily_rate: null, daily_transport_allowance: 25000, monthly_salary: 0, currency_code: 'CDF', overtime_rate_per_hour: 3500 } }
  return { workers: [worker], attendance: [{ id: 'a', worker_id: worker.id, attendance_date: week, status: 'present', attendance_day_fraction: 1,
    attendance_source: 'biometric', manual_override: false, check_in: '08:00:00', check_out: '23:00:00' }],
    rules: {}, holidays: [], runs: [], payrollLines: [], weeklyOvertimeOverrides: [] }
}
it('PAYIKE manual weekly override is payable at 3500 with zero base and no daily duplication', () => {
  const d = data(); d.weeklyOvertimeOverrides = [{ worker_id: 'payike', minutes: 300 }]
  Object.assign(d.attendance[0], { manual_override: true, emergency_overtime_mode: 'manual_overtime_duration', emergency_overtime_minutes: 120 })
  const before = JSON.stringify(d), line = weeklyPayoutLines(d, week)[0]
  const transport = weeklyPayoutLines(data(), week)[0].transportAmount
  expect(isWeeklyOvertimeEligibleWorker(d.workers[0], '2026-10-31')).toBe(true)
  expect(line).toMatchObject({ baseAmount: 0, eveningOvertimeMinutes: 300, overtimeAmount: 17500, transportAmount: transport, finalAmount: transport + 17500 })
  expect(weeklyPayrollOvertimeForLine(line).eveningOvertimeMinutes).toBe(300)
  expect(teamWeeklyReport(d, week).lines[0]).toMatchObject({ basePay: 0, minutes: 300, overtimeAmount: 17500, finalAmount: transport + 17500 })
  expect(teamReportDayOvertime(teamWeeklyReport(d, week).lines[0], week)).toBe(0)
  expect(JSON.stringify(d)).toBe(before)
})
it('daily manual duration is payable when weekly override absent; explicit zero still overrides it', () => {
  const d = data(); Object.assign(d.attendance[0], { manual_override: true, emergency_overtime_mode: 'manual_overtime_duration', emergency_overtime_minutes: 120 })
  const line = weeklyPayoutLines(d, week)[0]
  const transport = weeklyPayoutLines(data(), week)[0].transportAmount
  expect(line).toMatchObject({ eveningOvertimeMinutes: 120, overtimeAmount: 7000, baseAmount: 0, finalAmount: transport + 7000 })
  expect(weeklyPayrollOvertimeForDetail({ date: week, worker: d.workers[0], row: d.attendance[0] }).eveningOvertimeMinutes).toBe(120)
  expect(teamReportDayOvertime(teamWeeklyReport(d, week).lines[0], week)).toBe(120)
  d.weeklyOvertimeOverrides = [{ worker_id: 'payike', minutes: 0 }]
  expect(weeklyPayoutLines(d, week)[0]).toMatchObject({ eveningOvertimeMinutes: 0, overtimeAmount: 0, finalAmount: transport })
})
it('Chauffeur real late checkout, biometric review and FINAL outside-work OT remain automatic exclusions', () => {
  const d = data(), worker = d.workers[0], row = d.attendance[0]
  d.outsideWorkMovements = [{ id: 'final', status: 'final', work_date: week, outside_work_movement_workers: [{ worker_id: worker.id, start_time: '08:00', end_time: '23:00' }] }]
  d.biometricOvertimeReviews = [{ worker, attendance: row, source_fingerprint: 'x', review: { decision: 'approved', minutes: 360, source_fingerprint: 'x' } }]
  expect(isBiometricOvertimeEligibleWorker(worker, week)).toBe(false)
  expect(biometricOvertimeMinutes(worker, row, week)).toBe(0)
  expect(biometricReviewRows(d.biometricOvertimeReviews)).toEqual([])
  expect(weeklyPayrollOvertimeForDetail({ date: week, worker, row }).eveningOvertimeMinutes).toBe(0)
  expect(weeklyPayrollOvertimeForLine({ worker, details: [{ date: week, row }] }).eveningOvertimeMinutes).toBe(0)
  expect(weeklyPayoutLines(d, week)[0]).toMatchObject({ eveningOvertimeMinutes: 0, overtimeAmount: 0 })
})
