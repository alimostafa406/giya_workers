import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { calculatePayrollLine } from './src/utils/payrollCalculations.js'
import { formatEveningOvertimeMinutes, formatOvertimeMinutes, weeklyPayrollDisplayStatus, weeklyPayrollOvertimeForDetail, weeklyPayrollOvertimeForLine } from './src/utils/weeklyPayrollOvertime.js'

const monday = (checkIn, checkOut) => ({ date: '2026-09-14', status: 'present', row: { check_in: checkIn, check_out: checkOut } })

test('morning overtime is disabled until worker schedules are approved', () => {
  assert.equal(weeklyPayrollOvertimeForDetail(monday('08:00:00', null)).morningOvertimeMinutes, 0)
  assert.equal(weeklyPayrollOvertimeForDetail(monday('07:48:00', null)).morningOvertimeMinutes, 0)
  assert.equal(weeklyPayrollOvertimeForDetail(monday('07:30:00', null)).morningOvertimeMinutes, 0)
  assert.equal(weeklyPayrollOvertimeForDetail(monday('06:56:00', null)).morningOvertimeMinutes, 0)
  assert.equal(weeklyPayrollOvertimeForDetail(monday('06:30:00', null)).morningOvertimeMinutes, 0)
  assert.equal(weeklyPayrollOvertimeForDetail(monday('06:00:00', null)).morningOvertimeMinutes, 0)
})

test('evening overtime awards the first completed hour then completed half-hour blocks', () => {
  assert.equal(weeklyPayrollOvertimeForDetail(monday('09:08:30', '16:07:50')).eveningOvertimeMinutes, 0)
  assert.equal(weeklyPayrollOvertimeForDetail(monday('08:00:00', '17:00:00')).eveningOvertimeMinutes, 0)
  assert.equal(weeklyPayrollOvertimeForDetail(monday('08:00:00', '17:15:00')).eveningOvertimeMinutes, 0)
  assert.equal(weeklyPayrollOvertimeForDetail(monday('08:00:00', '17:59:00')).eveningOvertimeMinutes, 0)
  for (const time of ['18:00:00', '18:20:00', '18:29:00']) assert.equal(weeklyPayrollOvertimeForDetail(monday('08:00:00', time)).eveningOvertimeMinutes, 60)
  for (const time of ['18:30:00', '18:59:00']) assert.equal(weeklyPayrollOvertimeForDetail(monday('08:00:00', time)).eveningOvertimeMinutes, 90)
  for (const time of ['19:00:00', '19:29:00']) assert.equal(weeklyPayrollOvertimeForDetail(monday('08:00:00', time)).eveningOvertimeMinutes, 120)
  assert.equal(weeklyPayrollOvertimeForDetail(monday('08:00:00', '19:30:00')).eveningOvertimeMinutes, 150)
  assert.equal(weeklyPayrollOvertimeForDetail(monday('08:00:00', '22:00:00')).eveningOvertimeMinutes, 300)
  assert.equal(weeklyPayrollOvertimeForDetail(monday('08:00:00', null)).eveningOvertimeMinutes, 0)
})

test('missing checkout stays half day, earns no evening overtime, and is not mutated', () => {
  const detail = { ...monday('08:00:00', null), status: 'late' }
  const before = structuredClone(detail)
  assert.equal(weeklyPayrollDisplayStatus(detail), 'half_day')
  assert.equal(weeklyPayrollOvertimeForDetail(detail).eveningOvertimeMinutes, 0)
  assert.deepEqual(detail, before)
})

test('evening overtime displays zero as a dash and positive minutes as hours/minutes', () => {
  assert.equal(formatEveningOvertimeMinutes(0), '—')
  assert.equal(formatEveningOvertimeMinutes(60), '1h00')
  assert.equal(formatEveningOvertimeMinutes(90), '1h30')
  assert.equal(formatEveningOvertimeMinutes(120), '2h00')
  assert.equal(formatEveningOvertimeMinutes(150), '2h30')
  assert.equal(formatEveningOvertimeMinutes(300), '5h00')
})

test('morning overtime remains zero while approved evening overtime is retained', () => {
  assert.deepEqual(weeklyPayrollOvertimeForLine({ details: [monday('06:00:00', '19:00:00')] }), {
    morningOvertimeMinutes: 0,
    eveningOvertimeMinutes: 120,
  })
})

test('disabled morning overtime renders as a dash', () => {
  assert.equal(formatOvertimeMinutes(0), '—')
})

test('Saturday never derives weekday overtime and keeps existing full-day payroll rule', () => {
  const saturday = { date: '2026-09-12', status: 'present', row: { check_in: '06:00:00', check_out: null } }
  assert.deepEqual(weeklyPayrollOvertimeForDetail(saturday), { morningOvertimeMinutes: 0, eveningOvertimeMinutes: 0 })
  const line = calculatePayrollLine({ worker: { id: 'sat' }, term: { daily_rate: 20000, daily_transport_allowance: 1000, overtime_rate_per_hour: 5000, overtime_start_time: '14:30:00' }, attendanceByDate: new Map([['sat|2026-09-12', { status: 'present', check_in: '08:00:00', check_out: null, attendance_day_fraction: 1 }]]), dates: ['2026-09-12'], rules: { transport_eligibility: 'present_and_half_day' }, holidayDates: new Set(), paymentType: 'weekly', businessDate: '2026-09-12' })
  assert.equal(line.attendanceWage, 20000)
  assert.equal(line.overtimeHours, 0)
})

test('overtime display helper does not change payroll monetary totals', () => {
  const line = { details: [monday('06:00:00', '19:00:00')], finalAmount: 123456, attendanceWage: 100000, overtimeAmount: 0 }
  const before = structuredClone(line)
  weeklyPayrollOvertimeForLine(line)
  assert.deepEqual(line, before)
})

test('weekly table source contains exactly the approved data columns and worker trigger', () => {
  const sheet = readFileSync('./src/components/Payroll/WeeklyPayrollSheet.jsx', 'utf8')
  assert.match(sheet, /data-weekly-payroll-sheet/)
  assert.match(sheet, /workDayPay/)
  assert.match(sheet, /morningOvertime/)
  assert.match(sheet, /eveningOvertime/)
  assert.match(sheet, /onClick=\{\(\) => onEdit\(line\.worker\.id\)\}/)
  assert.match(sheet, /money\(line\.attendanceWage, line\)/)
  assert.match(sheet, /transportConfigured \? money\(line\.transportAmount, line\) : '—'/)
  assert.doesNotMatch(sheet, /sundayStatusLabel|sundayWork|dailyRate|finalPay|common\.actions|common\.edit|simpleWeeklyPayrollForLine/)
})
