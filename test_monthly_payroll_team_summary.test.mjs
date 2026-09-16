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

test('monthly summary deductions include only explicit deductions and advances', () => {
  const groups = [{ id:'a',name:'A',lines:[
    line('CDF',{monthlySalary:1000,absenceDeduction:100,halfDayDeduction:50,deductionAmount:25,advanceAmount:0,finalAmount:999}),
    line('CDF',{monthlySalary:1000,absenceDeduction:20,halfDayDeduction:30,deductionAmount:0,advanceAmount:10,finalAmount:1}),
  ]}]
  const before = structuredClone(groups)
  const result = monthlyPayrollTeamSummary(groups)
  assert.equal(result.rows[0].byCurrency.CDF.deductions, 35)
  assert.equal(result.rows[0].byCurrency.CDF.total, 1000)
  assert.deepEqual(groups, before)
})

test('attendance deductions alone remain outside the monthly summary deduction column', () => {
  const result = monthlyPayrollTeamSummary([{ id:'a',name:'A',lines:[
    line('CDF',{absenceDeduction:100,halfDayDeduction:50,finalAmount:850}),
  ]}])
  assert.equal(result.rows[0].byCurrency.CDF.deductions, 0)
  assert.equal(result.rows[0].byCurrency.CDF.total, 850)
})

test('monthly UI preserves eligibility and cycle grouping while using team selection', () => {
  const source = readFileSync('./src/components/Payroll/MonthlyPayrollOperations.jsx','utf8')
  assert.match(source, /import \{ isActiveWorker \} from '\.\.\/\.\.\/utils\/activeWorkers'/)
  assert.match(source, /isActiveWorker\(worker\) && worker\.payment_type === 'monthly'/)
  assert.match(source, /const key = `\$\{line\.cycle\.due\}\|\$\{line\.currency\}`/)
  assert.match(source, /<MonthlyPayrollTeamSummary groups=\{teamGroups\}/)
  assert.match(source, /data=\{teamLines\}/)
  assert.doesNotMatch(source, /incompleteWorkers\.map\(\(worker\) => worker\.full_name\)\.join/)
  assert.match(source, /setupRequiredCount/)
  assert.match(source, /orientation:'landscape'/)
  assert.match(source, /datesForRange\(cycle\.start, cycle\.end\)\.filter\(\(date\) => !isSunday\(date\)\)/)
  assert.match(source, /paymentType: 'monthly', futureDatesAreNeutral: true/)
  assert.match(source, /setSelectedTeamId\(''\)[\s\S]*payroll\.back/)
})

test('optional monthly money uses a display-only dash and final amount remains authoritative', () => {
  const source = readFileSync('./src/components/Payroll/MonthlyPayrollOperations.jsx','utf8')
  const summary = readFileSync('./src/components/Payroll/MonthlyPayrollTeamSummary.jsx','utf8')
  const aggregation = readFileSync('./src/utils/monthlyPayrollTeamSummary.js','utf8')
  assert.match(source, /Number\(value \|\| 0\) === 0 \? '—' : money\(value\)/)
  assert.match(aggregation, /current\.total \+= amount\(line\.finalAmount\)/)
  assert.match(aggregation, /current\.deductions \+= amount\(line\.deductionAmount\) \+ amount\(line\.advanceAmount\)/)
  assert.doesNotMatch(aggregation, /current\.deductions[^\n]*(?:absenceDeduction|halfDayDeduction)/)
  assert.match(summary, /values\(row\.byCurrency, 'transport', true\)/)
  assert.match(summary, /values\(row\.byCurrency, 'overtime', true\)/)
  assert.match(summary, /values\(row\.byCurrency, 'deductions', true\)/)
})
