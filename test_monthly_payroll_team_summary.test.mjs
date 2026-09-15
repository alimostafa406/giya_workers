import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { monthlyPayrollTeamSummary } from './src/utils/monthlyPayrollTeamSummary.js'

const line = (currency, values = {}) => ({ currency, monthlySalary: 1000, transportAmount: 0, overtimeAmount: 0, absenceDeduction: 0, halfDayDeduction: 0, deductionAmount: 0, advanceAmount: 0, finalAmount: 1000, ...values })

test('monthly summary has one row per team, correct EFF, canonical totals, and separate currencies', () => {
  const groups = [{ id:'a',name:'A',lines:[line('CDF'),line('USD',{monthlySalary:20,finalAmount:18,absenceDeduction:2})]},{id:'b',name:'B',lines:[line('CDF',{finalAmount:900,transportAmount:10})]}]
  const before = structuredClone(groups)
  const result = monthlyPayrollTeamSummary(groups)
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0].workers, 2)
  assert.equal(result.totals.workers, 3)
  assert.equal(result.totals.byCurrency.CDF.total, 1900)
  assert.equal(result.totals.byCurrency.USD.total, 18)
  assert.deepEqual(groups, before)
})

test('monthly UI preserves eligibility and cycle grouping while using team selection', () => {
  const source = readFileSync('./src/components/Payroll/MonthlyPayrollOperations.jsx','utf8')
  assert.match(source, /worker\.is_active !== false && worker\.payment_type === 'monthly'/)
  assert.match(source, /const key = `\$\{line\.cycle\.due\}\|\$\{line\.currency\}`/)
  assert.match(source, /<MonthlyPayrollTeamSummary groups=\{teamGroups\}/)
  assert.match(source, /data=\{teamLines\}/)
  assert.doesNotMatch(source, /incompleteWorkers\.map\(\(worker\) => worker\.full_name\)\.join/)
  assert.match(source, /setupRequiredCount/)
  assert.match(source, /orientation:'landscape'/)
})

test('optional monthly money uses a display-only dash and final amount remains authoritative', () => {
  const source = readFileSync('./src/components/Payroll/MonthlyPayrollOperations.jsx','utf8')
  const summary = readFileSync('./src/components/Payroll/MonthlyPayrollTeamSummary.jsx','utf8')
  const aggregation = readFileSync('./src/utils/monthlyPayrollTeamSummary.js','utf8')
  assert.match(source, /Number\(value \|\| 0\) === 0 \? '—' : money\(value\)/)
  assert.match(aggregation, /current\.total \+= amount\(line\.finalAmount\)/)
  assert.match(summary, /values\(row\.byCurrency, 'transport', true\)/)
  assert.match(summary, /values\(row\.byCurrency, 'overtime', true\)/)
  assert.match(summary, /values\(row\.byCurrency, 'deductions', true\)/)
})
