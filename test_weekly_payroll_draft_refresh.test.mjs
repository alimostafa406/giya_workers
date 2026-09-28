import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculatePayrollLine, weeklyDates } from './src/utils/payrollCalculations.js'
import { applyWeeklyOvertimePay, weeklyPayrollOvertimeForLine } from './src/utils/weeklyPayrollOvertime.js'
import { staleWeeklyPayrollWorkerIds } from './src/utils/weeklyPayrollDraftFreshness.js'
import { buildDailyOvertimeReport } from './src/utils/dailyOperationalReports.js'

const worker = { id: 'w', full_name: 'Worker', is_active: true, staff_classification: 'normal', payment_type: 'weekly', team_id: 't', team: { id: 't', name: 'Zarour' } }
const dates = weeklyDates('2026-09-28')
const preview = (row, rate = 1500) => applyWeeklyOvertimePay(calculatePayrollLine({
  worker, term: { daily_rate: 15000, overtime_rate_per_hour: rate },
  attendanceByDate: new Map([['w|2026-09-28', row]]), dates,
  rules: { half_day_multiplier: 0.5 }, holidayDates: new Set(), paymentType: 'weekly',
  futureDatesAreNeutral: true, businessDate: '2026-09-28',
}))
const saved = line => ({ ...line, details: line.details.map(detail => ({ ...detail, row: detail.row && { ...detail.row } })) })

test('Monday-Saturday current preview: real half day, five future days, no overtime yet', () => {
  assert.deepEqual(dates, ['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03'])
  const line = preview({ status: 'half_day', check_in: '07:54:25', check_out: null })
  assert.deepEqual(line.details.map(day => day.status), ['half_day','future','future','future','future','future'])
  assert.equal(line.attendanceWage, 7500)
  assert.equal(line.eveningOvertimeMinutes, 0)
})
test('draft detects half-day to present correction and later real checkout', () => {
  const initial = saved(preview({ status: 'half_day', check_in: '07:54:25', check_out: null }))
  const corrected = preview({ status: 'present', check_in: '07:54:25', check_out: '17:04:00' })
  const lateCheckout = preview({ status: 'present', check_in: '07:54:25', check_out: '18:30:00' })
  assert.deepEqual(staleWeeklyPayrollWorkerIds([initial], [corrected]), ['w'])
  assert.deepEqual(staleWeeklyPayrollWorkerIds([saved(corrected)], [lateCheckout]), ['w'])
  assert.equal(lateCheckout.eveningOvertimeMinutes, 90)
  assert.equal(lateCheckout.overtimeAmount, 2250)
  assert.deepEqual(staleWeeklyPayrollWorkerIds([saved(lateCheckout)], [lateCheckout]), [])
})
test('cross-midnight checkout and missing rate retain canonical overtime time', () => {
  const old = saved(preview({ status: 'present', check_in: '07:54:25', check_out: '17:04:00' }, null))
  const nextDay = preview({ status: 'present', check_in: '07:54:25', check_out: '00:31:00', biometric_sync_metadata: { check_out_event_timestamp: '2026-09-29T00:31:00+01:00' } }, null)
  assert.equal(nextDay.eveningOvertimeMinutes, 450)
  assert.equal(nextDay.overtimeHours, 7.5)
  assert.equal(nextDay.overtimeAmount, 0)
  assert.deepEqual(staleWeeklyPayrollWorkerIds([old], [nextDay]), ['w'])
  assert.equal(weeklyPayrollOvertimeForLine(nextDay).eveningOvertimeMinutes, 450)
})
test('report-only team and two-hour threshold never filter payroll overtime', () => {
  const row = { worker_id:'w', worker, team:worker.team, attendance_date:'2026-09-28', status:'present', check_in:'08:00:00', check_out:'18:00:00' }
  assert.equal(buildDailyOvertimeReport({ date:'2026-09-28', attendance:[row], overtimeTeamIds:[] }).length, 0)
  assert.equal(preview(row).eveningOvertimeMinutes, 60)
  assert.equal(preview(row).overtimeAmount, 1500)
})
test('existing safe draft refresh path is wired only for draft; finalized and paid remain snapshots', () => {
  const source = readFileSync('./src/components/Payroll/PayrollOperations.jsx','utf8')
  assert.match(source, /onClick=\{draftRun \? refreshDraftFromAttendance : \(\) => load\(\)\}/)
  assert.match(source, /await persistPayrollDraftRequest\(\{[\s\S]*lines: weeklyLinesFor\(refreshed, monday\)/)
  assert.match(source, /weeklyRun && weeklyRun\.status !== 'draft' \? weeklyPayrollEligibleLines\(storedLines\) : calculatedLines/)
  const api = readFileSync('./src/api/payrollOperationsApi.js','utf8')
  assert.match(api, /neq\('status', 'draft'\)/)
  assert.match(api, /applyPayrollAdjustments\(line, existingLineId/)
  assert.doesNotMatch(source, /isOvertimeReportEligible|overtimeTeamIds/)
})
