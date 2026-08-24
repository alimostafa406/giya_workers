import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { applyPayrollAdjustments, applySundayCarry, calculatePayrollLine, currentBusinessDate, sundayBefore, weeklyDates } from './src/utils/payrollCalculations.js'

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

test('unpaid Sunday double pay is carried once and paid Sunday is excluded', () => {
  const baseLine = {
    worker: { id: 'worker-1' }, currency: 'CDF', baseAmount: 60000, transportAmount: 0,
    overtimeAmount: 0, holidayAmount: 0, finalAmount: 60000,
  }
  const unpaid = { id: 'sun-1', worker_id: 'worker-1', work_date: '2026-08-23', daily_value: 10000, multiplier: 2, amount: 20000, currency_code: 'CDF', payment_status: 'unpaid', settled_payroll_run_id: null }
  const carried = applySundayCarry(baseLine, [unpaid], null, '2026-08-29')
  assert.equal(carried.sundayCarryAmount, 20000)
  assert.equal(carried.finalAmount, 80000)
  assert.equal(applyPayrollAdjustments(carried).finalAmount, 80000)

  const paid = applySundayCarry(baseLine, [{ ...unpaid, payment_status: 'paid' }], null, '2026-08-29')
  assert.equal(paid.sundayCarryAmount, 0)
  assert.equal(paid.finalAmount, 60000)
})

test('assigned Sunday remains in its run and cannot enter another settlement', () => {
  const baseLine = { worker: { id: 'worker-1' }, currency: 'CDF', finalAmount: 60000 }
  const assigned = { id: 'sun-1', worker_id: 'worker-1', work_date: '2026-08-23', amount: 20000, currency_code: 'CDF', payment_status: 'unpaid', settled_payroll_run_id: 'run-1' }
  assert.equal(applySundayCarry(baseLine, [assigned], 'run-1', '2026-08-29').sundayCarryAmount, 20000)
  assert.equal(applySundayCarry(baseLine, [assigned], 'run-2', '2026-09-05').sundayCarryAmount, 0)
  assert.equal(applySundayCarry(baseLine, [{ ...assigned, payment_status: 'paid' }], null, '2026-09-05').sundayCarryAmount, 0)
})

test('monthly approved daily value is salary divided by 26', () => {
  const line = calculatePayrollLine({
    worker: { id: 'monthly-1' }, term: { monthly_salary: 260000 }, attendanceByDate: new Map(),
    dates: [], rules: { monthly_working_day_divisor: 26 }, holidayDates: new Set(), paymentType: 'monthly',
  })
  assert.equal(line.dailyValue, 10000)
  assert.equal(line.dailyValue * 2, 20000)
})

test('Sunday migration enforces auditability, uniqueness, and atomic settlement', () => {
  const sql = readFileSync('./supabase/sql/worker_sunday_payments.sql', 'utf8')
  assert.match(sql, /unique \(worker_id, work_date\)/i)
  assert.match(sql, /payment_type_snapshot text not null/i)
  assert.match(sql, /multiplier numeric\(8,4\) not null default 2 check \(multiplier = 2\)/i)
  assert.match(sql, /Future Sunday work cannot be confirmed/)
  assert.match(sql, /settled_payroll_run_id is not null and v_payment\.settled_payroll_run_id <> v_run\.id/)
  assert.match(sql, /mark_payroll_run_paid_with_sundays/)
  assert.match(sql, /update public\.worker_sunday_payment set payment_status = 'paid'/)
  assert.doesNotMatch(sql, /delete from public\.worker_sunday_payment/i)
})

test('worker editor week starts with the preceding Sunday and keeps Monday through Saturday unchanged', () => {
  assert.equal(sundayBefore('2026-08-24'), '2026-08-23')
  assert.deepEqual(weeklyDates('2026-08-24'), ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29'])
  const editor = readFileSync('./src/components/Payroll/WeeklyPayrollWorkerEditPanel.jsx', 'utf8')
  assert.ok(editor.indexOf('line.sundayDate') < editor.indexOf('dates.map((date)'))
  assert.match(editor, /value=\{sundayWorked \? 'present' : 'absent'\}/)
})

test('Sunday present and absent use the shared auditable payment record workflow', () => {
  const operations = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  const sql = readFileSync('./supabase/sql/worker_sunday_payments.sql', 'utf8')
  assert.match(operations, /confirmSundayWorkRequest\(\{ workerId: line\.worker\.id, workDate: line\.sundayDate \}\)/)
  assert.match(operations, /cancelSundayWorkRequest\(line\.sundayPayment\.id\)/)
  assert.match(sql, /payment_status in \('unpaid', 'paid', 'cancelled'\)/)
  assert.match(sql, /payment_status = 'cancelled'/)
  assert.match(sql, /payment_status = 'unpaid'[\s\S]*settled_payroll_run_id is null[\s\S]*settled_payroll_line_id is null/)
  assert.match(sql, /already been financially processed and cannot be reversed/)
  assert.match(sql, /if v_payment\.payment_status <> 'cancelled' then return v_payment/)
  assert.match(sql, /payment_status = 'unpaid',[\s\S]*cancelled_at = null/)
})

test('future Sunday is shown neutral and cannot be edited', () => {
  const editor = readFileSync('./src/components/Payroll/WeeklyPayrollWorkerEditPanel.jsx', 'utf8')
  assert.match(editor, /const isFuture = line\.sundayDate > currentBusinessDate\(\)/)
  assert.match(editor, /isFuture \? <span[^>]*>—<\/span> : <select/)
})
