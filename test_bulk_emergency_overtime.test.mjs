import assert from 'node:assert/strict'
import { test } from 'node:test'
import { weeklyPayrollOvertimeForDetail } from './src/utils/weeklyPayrollOvertime.js'
import { calculatePayrollLine } from './src/utils/payrollCalculations.js'

const date = '2026-09-21'
const worker = { id: 'worker-1', team_name: 'Zarour' }
const line = (row) => calculatePayrollLine({
  worker, term: { overtime_rate_per_hour: 1800, overtime_start_time: '17:00:00', daily_rate: 3000 },
  attendanceByDate: new Map([[`${worker.id}|${date}`, row]]), dates: [date], rules: {},
  holidayDates: new Set(), paymentType: 'weekly', businessDate: '2026-09-22',
})

test('manual checkout reuses the existing canonical evening overtime helper', () => {
  const row = { status: 'present', check_in: '07:30:00', check_out: '21:00:00', manual_override: true, emergency_overtime_mode: 'manual_checkout' }
  assert.equal(weeklyPayrollOvertimeForDetail({ date, row, worker }).eveningOvertimeMinutes, 240)
  assert.equal(weeklyPayrollOvertimeForDetail({ date, row: { ...row, emergency_overtime_mode: null }, worker }).eveningOvertimeMinutes, 240)
})

test('direct duration has no fabricated checkout and is visible to normal payroll', () => {
  const row = { status: 'half_day', check_in: '07:30:00', check_out: null, manual_override: true, emergency_overtime_mode: 'manual_overtime_duration', emergency_overtime_minutes: 210 }
  assert.equal(row.check_out, null)
  assert.equal(weeklyPayrollOvertimeForDetail({ date, row, worker }).eveningOvertimeMinutes, 210)
  assert.equal(line(row).overtimeHours, 3.5)
  assert.equal(line(row).overtimeAmount, 6300)
  assert.equal(line(row).halfDays, 1)
})

test('an unprotected row cannot claim direct emergency overtime', () => {
  const row = { status: 'half_day', check_in: '07:30:00', check_out: null, manual_override: false, emergency_overtime_mode: 'manual_overtime_duration', emergency_overtime_minutes: 210 }
  assert.equal(weeklyPayrollOvertimeForDetail({ date, row, worker }).eveningOvertimeMinutes, 0)
})

test('Chauffeur is excluded even when a manual duration is present', () => {
  const chauffeur = { ...worker, team_name: 'Chauffeur' }
  const row = { status: 'present', check_in: '07:30:00', check_out: null, manual_override: true, emergency_overtime_mode: 'manual_overtime_duration', emergency_overtime_minutes: 210 }
  assert.equal(weeklyPayrollOvertimeForDetail({ date, row, worker: chauffeur }).eveningOvertimeMinutes, 0)
  assert.equal(calculatePayrollLine({ worker: chauffeur, term: { overtime_rate_per_hour: 1800 }, attendanceByDate: new Map([[`${worker.id}|${date}`, row]]), dates: [date], rules: {}, holidayDates: new Set(), paymentType: 'weekly' }).overtimeAmount, 0)
})
