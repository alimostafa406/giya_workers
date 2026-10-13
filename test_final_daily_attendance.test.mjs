import assert from 'node:assert/strict'
import test from 'node:test'
import { finalAttendanceStatus, isFinalAttendanceRuleDate } from './src/utils/finalAttendanceStatus.js'
import { dailyReportData } from './src/utils/dailyReportCenter.js'
import { classifyWeeklyReportDay, summarizeWeeklyAttendanceDays } from './src/utils/weeklyAttendanceReport.js'
import { calculatePayrollLine } from './src/utils/payrollCalculations.js'
import { buildWorkerControlPages } from './src/utils/workerControlPages.js'
import { buildWorkerHistory } from './src/utils/workerControlHistory.js'

const day = '2026-10-13'
const worker = { id: 'one', full_name: 'ONE', is_active: true, staff_classification: 'normal', team_id: 'team', team: { id: 'team', name: 'Maison' } }
const row = (status, extra = {}) => ({ worker_id: worker.id, attendance_date: day, status, attendance_source: 'biometric', manual_override: false, ...extra })

test('dated classifier makes current one-punch biometric rows full present, preserving old history', () => {
  assert.equal(isFinalAttendanceRuleDate(day), true)
  assert.equal(finalAttendanceStatus(row('half_day', { check_in: '08:10:00' })), 'present')
  assert.equal(finalAttendanceStatus(row('half_day', { check_out: '18:00:00' })), 'present')
  assert.equal(finalAttendanceStatus({ ...row('half_day', { check_in: '08:10:00' }), attendance_date: '2026-10-12' }), 'half_day')
})

test('manual P/O/A/M canonical statuses override biometric evidence', () => {
  for (const [choice, status, reason] of [['P', 'present', null], ['O', 'present', 'working_outside'], ['A', 'absent', null], ['M', 'absent', 'medical']]) {
    const manual = { ...row(status, { check_in: null }), attendance_source: 'manual', manual_override: true,
      biometric_sync_metadata: { supervisor_morning_review: { choice, reason } } }
    assert.equal(finalAttendanceStatus(manual), status)
    assert.equal(manual.biometric_sync_metadata.supervisor_morning_review.reason, reason)
  }
})

test('daily operational summary has no final half-day and keeps current missing rows provisional', () => {
  const current = dailyReportData({ date: day, businessDate: day, workers: [worker], attendance: [row('half_day', { check_in: '08:10:00' })] })
  assert.deepEqual(current.monitoringCounts, { total: 1, present: 1, half_day: 0, absent: 0, not_recorded: 0 })
  assert.equal(current.exceptions.length, 0)
  const missing = dailyReportData({ date: day, businessDate: day, workers: [worker], attendance: [] })
  assert.equal(missing.monitoringCounts.not_recorded, 1)
  assert.equal(missing.monitoringCounts.absent, 0)
  const completed = dailyReportData({ date: day, businessDate: '2026-10-14', workers: [worker], attendance: [] })
  assert.equal(completed.monitoringCounts.absent, 1)
  assert.equal(completed.counts.absent, 1)
})

test('weekly current/future days are present or absent; prior half-day history remains', () => {
  assert.equal(classifyWeeklyReportDay({ date: day, status: 'half_day', businessDate: day }), 'present')
  assert.equal(classifyWeeklyReportDay({ date: '2026-10-14', status: null, businessDate: '2026-10-15' }), 'absent')
  assert.equal(classifyWeeklyReportDay({ date: '2026-10-12', status: 'half_day', businessDate: day }), 'half_day')
  const summary = summarizeWeeklyAttendanceDays({ dates: [day], getStatus: () => 'half_day', businessDate: day })
  assert.equal(summary.presentDays, 1)
  assert.equal(summary.absentDays, 0)
})

test('only new unfinalized payroll drafts use a full present day; old days retain half-day pay', () => {
  const calculate = (date, status) => calculatePayrollLine({ worker, term: { daily_rate: 100 },
    attendanceByDate: new Map([[`${worker.id}|${date}`, { ...row(status, { check_in: '08:10:00' }), attendance_date: date }]]),
    dates: [date], rules: { half_day_multiplier: 0.5 }, holidayDates: new Set(), paymentType: 'weekly',
    futureDatesAreNeutral: true, businessDate: date })
  const current = calculate(day, 'half_day')
  assert.equal(current.presentDays, 1)
  assert.equal(current.halfDays, 0)
  assert.equal(current.attendanceWage, 100)
  const historical = calculate('2026-10-12', 'half_day')
  assert.equal(historical.halfDays, 1)
  assert.equal(historical.attendanceWage, 50)
})

test('Control Center and worker history display a new one-punch day as present without mutating the row', () => {
  const attendance = [row('half_day', { check_in: '08:10:00' })]
  const pages = buildWorkerControlPages({ workers: [worker], attendance, today: day,
    weekStart: '2026-10-12', monthStart: '2026-10-01' })
  assert.equal(pages.details.get(worker.id).today.status, 'present')
  assert.equal(pages.rows['half-day'].length, 0)
  const history = buildWorkerHistory({ worker, attendance, dateFrom: day, dateTo: day })
  assert.equal(history.summary.present, 1)
  assert.equal(history.summary.halfDay, 0)
  assert.equal(attendance[0].status, 'half_day')
})
