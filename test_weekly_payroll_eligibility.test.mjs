import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  isWeeklyPayrollEligibleWorker,
  payrollDraftEligibleLines,
  removableStaleWeeklyPayrollLineIds,
  weeklyPayrollEligibleLines,
  weeklyPayrollCurrencyTotalsMatch,
} from './src/utils/weeklyPayrollEligibility.js'
import { assertPayrollLineCurrencies, payrollWorkerLabel } from './src/utils/payrollLineCurrency.js'

const worker = (overrides = {}) => ({
  id: 'worker-1',
  full_name: 'Weekly Worker',
  employee_code: '1',
  is_active: true,
  payment_type: 'weekly',
  staff_classification: 'normal',
  ...overrides,
})
const line = (workerOverrides = {}, currency = 'CDF') => ({ worker: worker(workerOverrides), currency })

test('weekly eligibility includes only active normal weekly workers', () => {
  assert.equal(isWeeklyPayrollEligibleWorker(worker()), true)
  assert.equal(isWeeklyPayrollEligibleWorker(worker({ staff_classification: 'special_staff' })), false)
  assert.equal(isWeeklyPayrollEligibleWorker(worker({ payment_type: 'monthly' })), false)
  assert.equal(isWeeklyPayrollEligibleWorker(worker({ is_active: false })), false)
})

test('special staff is excluded from currency validation and draft persistence input', () => {
  const special = line({ id: 'special', staff_classification: 'special_staff' }, null)
  const eligible = line({ id: 'weekly' }, 'CDF')
  const filtered = payrollDraftEligibleLines('weekly', [special, eligible])
  assert.deepEqual(filtered.map((item) => item.worker.id), ['weekly'])
  assert.doesNotThrow(() => assertPayrollLineCurrencies(filtered))
})

test('special staff does not contribute to weekly worker or team counts', () => {
  const lines = weeklyPayrollEligibleLines([
    line({ id: 'weekly-a', team_id: 'team-a' }),
    line({ id: 'special', team_id: 'foreign', staff_classification: 'special_staff' }),
    line({ id: 'weekly-b', team_id: 'team-b' }),
  ])
  assert.equal(lines.length, 2)
  assert.deepEqual(new Set(lines.map((item) => item.worker.team_id)), new Set(['team-a', 'team-b']))
})

test('genuine weekly worker with missing currency remains a clear blocker', () => {
  assert.throws(
    () => assertPayrollLineCurrencies(payrollDraftEligibleLines('weekly', [line({}, null)])),
    /Weekly Worker #1/,
  )
})

test('monthly draft lines are not reinterpreted by weekly eligibility', () => {
  const monthly = line({ payment_type: 'monthly' }, 'USD')
  assert.deepEqual(payrollDraftEligibleLines('monthly', [monthly]), [monthly])
})

test('weekly selection, validation, persistence, and counts use the shared rule', () => {
  const operations = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  const api = readFileSync('./src/api/payrollOperationsApi.js', 'utf8')
  assert.match(operations, /\.filter\(isWeeklyPayrollEligibleWorker\)/)
  assert.match(operations, /const currentWeeklyWorkerIds = new Set\(calculatedLines\.map/)
  assert.match(operations, /const teamGroups = useMemo[\s\S]*lines\.forEach/)
  assert.match(api, /eligibleLines = payrollDraftEligibleLines\(paymentType, lines\)/)
  assert.match(api, /assertPayrollLineCurrencies\(eligibleLines\)/)
  assert.match(api, /const payload = eligibleLines\.map/)
  assert.match(api, /removableStaleLineIds/)
  assert.match(api, /from\('payroll_line'\)\.delete\(\)\.in\('id', removableStaleLineIds\)/)
})

test('blocker labels use the canonical worker full name', () => {
  assert.equal(payrollWorkerLabel(line({ full_name: 'JOEL', employee_code: '56' }, null)), 'JOEL #56')
  const operations = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  assert.match(operations, /invalidCompensationLines\.map\(payrollWorkerLabel\)/)
})

test('draft totals reconcile independently by currency', () => {
  assert.equal(weeklyPayrollCurrencyTotalsMatch(
    [{ currency: 'CDF', finalAmount: 100 }, { currency: 'USD', finalAmount: 10 }],
    [{ currency: 'USD', finalAmount: 10 }, { currency: 'CDF', finalAmount: 100 }],
  ), true)
  assert.equal(weeklyPayrollCurrencyTotalsMatch(
    [{ currency: 'CDF', finalAmount: 110 }],
    [{ currency: 'CDF', finalAmount: 100 }, { currency: 'USD', finalAmount: 10 }],
  ), false)
})

test('review validation requires the current eligible persisted worker set', () => {
  const operations = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  assert.match(operations, /currentStoredLines\.length !== calculatedLines\.length/)
  assert.match(operations, /weeklyPayrollCurrencyTotalsMatch\(currentStoredLines, calculatedLines\)/)
})

test('draft refresh removes only obsolete adjustment-free payroll lines', () => {
  const existing = [
    { id: 'eligible-line', worker_id: 'eligible' },
    { id: 'obsolete-line', worker_id: 'monthly-now' },
    { id: 'audited-line', worker_id: 'special-now' },
  ]
  const eligible = [line({ id: 'eligible' })]
  const adjustments = new Map([['audited-line', [{ id: 'adjustment' }]]])
  assert.deepEqual(removableStaleWeeklyPayrollLineIds(existing, eligible, adjustments), ['obsolete-line'])
  assert.deepEqual(removableStaleWeeklyPayrollLineIds(existing, eligible, adjustments), ['obsolete-line'])
})
