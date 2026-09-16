import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  isWeeklyPayrollEligibleWorker,
  payrollDraftEligibleLines,
  removableStaleWeeklyPayrollLineIds,
  weeklyPayrollEligibleLines,
  weeklyPayrollCurrencyTotalsMatch,
  weeklyPayrollTotalsByCurrency,
  positiveWeeklyPayrollCurrencyTotals,
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
  assert.match(operations, /invalidAmountLines\.map\(payrollWorkerLabel\)/)
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

test('team amount due sums authoritative finalAmount values without recalculation', () => {
  const present = { ...line({ id: 'present', team_id: 'team-a' }), finalAmount: 120000 }
  const halfDay = { ...line({ id: 'half-day', team_id: 'team-a' }), finalAmount: 87500, transportAmount: 5000 }
  const absent = { ...line({ id: 'absent', team_id: 'team-a' }), finalAmount: 0, overtimeAmount: 9000 }
  assert.deepEqual(weeklyPayrollTotalsByCurrency([present, halfDay, absent]), { CDF: 207500 })
})

test('weekly team totals exclude ineligible and stale lines and keep currencies separate', () => {
  const eligible = weeklyPayrollEligibleLines([
    { ...line({ id: 'cdf', team_id: 'team-a' }, 'CDF'), finalAmount: 100000 },
    { ...line({ id: 'usd', team_id: 'team-a' }, 'USD'), finalAmount: 300 },
    { ...line({ id: 'monthly', payment_type: 'monthly' }, 'CDF'), finalAmount: 500000 },
    { ...line({ id: 'special', staff_classification: 'special_staff' }, 'CDF'), finalAmount: 500000 },
    { ...line({ id: 'inactive', is_active: false }, 'CDF'), finalAmount: 500000 },
    { worker: { id: 'stale' }, currency: 'CDF', finalAmount: 500000 },
  ])
  assert.deepEqual(weeklyPayrollTotalsByCurrency(eligible), { CDF: 100000, USD: 300 })
})

test('overall amount due reconciles exactly with team totals by currency', () => {
  const teams = [
    [{ ...line({ id: 'a1' }, 'CDF'), finalAmount: 100 }, { ...line({ id: 'a2' }, 'USD'), finalAmount: 10 }],
    [{ ...line({ id: 'b1' }, 'CDF'), finalAmount: 250 }, { ...line({ id: 'b2' }, 'USD'), finalAmount: 5 }],
  ]
  const overall = weeklyPayrollTotalsByCurrency(teams.flat())
  const fromTeams = teams.map(weeklyPayrollTotalsByCurrency).reduce((sum, totals) => {
    Object.entries(totals).forEach(([currency, amount]) => { sum[currency] = (sum[currency] || 0) + amount })
    return sum
  }, {})
  assert.deepEqual(overall, fromTeams)
})

test('finalized payroll display uses stored final amounts', () => {
  const operations = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  assert.match(operations, /finalAmount: Number\(stored\.final_amount \|\| 0\)/)
  assert.match(operations, /weeklyRun && weeklyRun\.status !== 'draft' \? weeklyPayrollEligibleLines\(storedLines\) : calculatedLines/)
  assert.match(operations, /amountDueByCurrency: weeklyPayrollTotalsByCurrency\(group\.lines\)/)
  assert.doesNotMatch(operations, /amountDueByCurrency:[^\n]*(daily_rate|transportAmount|overtimeAmount)/)
})

test('team amount display hides zero currencies and keeps positive currencies', () => {
  assert.deepEqual(positiveWeeklyPayrollCurrencyTotals({ CDF: 962000, USD: 0 }), [['CDF', 962000]])
  assert.deepEqual(positiveWeeklyPayrollCurrencyTotals({ CDF: 0, USD: 250 }), [['USD', 250]])
  assert.deepEqual(positiveWeeklyPayrollCurrencyTotals({ CDF: 962000, USD: 250 }), [['CDF', 962000], ['USD', 250]])
})

test('team amount display normalizes duplicate same-currency entries before filtering', () => {
  assert.deepEqual(positiveWeeklyPayrollCurrencyTotals([['CDF', 962000], ['CDF', 0]]), [['CDF', 962000]])
  assert.deepEqual(positiveWeeklyPayrollCurrencyTotals([['cdf', 600000], [' CDF ', 362000]]), [['CDF', 962000]])
})

test('team amount display keeps mixed positive currencies as unique rows', () => {
  const rendered = positiveWeeklyPayrollCurrencyTotals([
    { currency: 'CDF', amount: 962000 },
    { currencyCode: 'USD', total: 250 },
    { currency: 'CDF', amount: 0 },
  ])
  assert.deepEqual(rendered, [['CDF', 962000], ['USD', 250]])
  assert.equal(new Set(rendered.map(([currency]) => currency)).size, rendered.length)
})

test('all-zero team totals produce the display fallback without mutating payroll totals', () => {
  const totals = { CDF: 0, USD: 0 }
  const snapshot = structuredClone(totals)
  assert.deepEqual(positiveWeeklyPayrollCurrencyTotals(totals), [])
  assert.deepEqual(totals, snapshot)
  const operations = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  assert.match(operations, /visibleTotals\.length \? visibleTotals\.map\([\s\S]*?\) : '—'/)
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
