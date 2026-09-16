import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { calculatePayrollLine } from './src/utils/payrollCalculations.js'

test('weekly draft validation ignores saved lines for workers no longer weekly', () => {
  const source = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')

  assert.match(source, /currentWeeklyWorkerIds = new Set\(calculatedLines\.map/)
  assert.match(source, /currentStoredLines = storedLines\.filter/)
  assert.doesNotMatch(source, /storedLines\.length !== calculatedLines\.length/)
  assert.match(source, /invalidAmountLines = currentStoredLines\.filter\(\(line\) => !Number\.isFinite\(line\.finalAmount\) \|\| line\.unresolvedDays > 0\)/)
  assert.doesNotMatch(source, /weeklyLinesFor\([^)]*\)\.filter\(\(line\) => line\.term\?\.daily_rate != null\)/)
})

test('normal past-day absence is resolved payroll attendance', () => {
  const line = calculatePayrollLine({
    worker: { id: 'weekly-worker' },
    term: { daily_rate: 20000 },
    attendanceByDate: new Map(),
    dates: ['2026-09-07'],
    rules: {},
    holidayDates: new Set(),
    paymentType: 'weekly',
    businessDate: '2026-09-12',
  })

  assert.equal(line.absentDays, 1)
  assert.equal(line.unresolvedDays, 0)
  assert.equal(line.finalAmount, 0)
})
