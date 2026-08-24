import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { calculatePayrollLine, currentBusinessDate } from './src/utils/payrollCalculations.js'

test('current week future days are neutral and contribute zero', () => {
  const worker = { id: 'worker-1' }
  const attendanceByDate = new Map([
    ['worker-1|2026-08-24', { status: 'present', check_out: '18:00:00' }],
    ['worker-1|2026-08-25', { status: 'present', check_out: '19:00:00' }],
  ])
  const line = calculatePayrollLine({
    worker,
    term: { daily_rate: 100, daily_transport_allowance: 10, overtime_rate_per_hour: 20, overtime_start_time: '17:00:00' },
    attendanceByDate,
    dates: ['2026-08-24', '2026-08-25', '2026-08-26'],
    rules: { transport_eligibility: 'present_and_half_day' },
    holidayDates: new Set(),
    paymentType: 'weekly',
    futureDatesAreNeutral: true,
    businessDate: '2026-08-24',
  })

  assert.equal(line.details[0].status, 'present')
  assert.equal(line.details[1].status, 'future')
  assert.equal(line.details[1].row, null)
  assert.equal(line.details[2].status, 'future')
  assert.equal(line.presentDays, 1)
  assert.equal(line.absentDays, 0)
  assert.equal(line.unresolvedDays, 0)
  assert.equal(line.attendanceWage, 100)
  assert.equal(line.transportAmount, 10)
  assert.equal(line.overtimeHours, 1)
  assert.equal(line.finalAmount, 130)
})

test('historical missing days keep their existing absent behavior', () => {
  const line = calculatePayrollLine({
    worker: { id: 'worker-1' },
    term: { daily_rate: 100 },
    attendanceByDate: new Map(),
    dates: ['2026-08-17', '2026-08-18'],
    rules: {},
    holidayDates: new Set(),
    paymentType: 'weekly',
    futureDatesAreNeutral: true,
    businessDate: '2026-08-24',
  })

  assert.equal(line.absentDays, 2)
  assert.deepEqual(line.details.map((detail) => detail.status), ['absent', 'absent'])
})

test('business date uses the Lagos office timezone', () => {
  assert.equal(currentBusinessDate(new Date('2026-08-23T23:30:00Z')), '2026-08-24')
})

test('weekly and monthly payroll use only explicit per-worker profile types', () => {
  const workersApi = readFileSync('./src/api/workersApi.js', 'utf8')
  const weeklyOperations = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  const monthlyOperations = readFileSync('./src/components/Payroll/MonthlyPayrollOperations.jsx', 'utf8')

  assert.match(workersApi, /payment_type: payrollProfile\?\.payment_type \|\| null/)
  assert.doesNotMatch(workersApi, /staffClassification === 'special_staff' \? 'monthly' : 'weekly'/)
  assert.match(weeklyOperations, /worker\.payment_type === 'weekly'/)
  assert.match(monthlyOperations, /worker\.payment_type === 'monthly'/)
})
