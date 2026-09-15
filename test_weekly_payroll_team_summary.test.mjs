import assert from 'node:assert/strict'
import test from 'node:test'
import { weeklyPayrollTeamSummary } from './src/utils/weeklyPayrollTeamSummary.js'
import { readFileSync } from 'node:fs'

const line = (currency, attendanceWage, transportAmount, overtimeAmount, finalAmount) => ({ currency, attendanceWage, transportAmount, overtimeAmount, finalAmount })

test('summary has one row per team and reconciles workers and authoritative values', () => {
  const result = weeklyPayrollTeamSummary([
    { id: 'a', name: 'Alpha', lines: [line('CDF', 100, 10, 5, 115), line('CDF', 200, 20, 0, 220)] },
    { id: 'b', name: 'Beta', lines: [line('CDF', 300, 30, 15, 345)] },
  ])
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0].workers, 2)
  assert.deepEqual(result.totals, { workers: 3, byCurrency: { CDF: { workDayPay: 600, transport: 60, overtime: 20, total: 680 } } })
})

test('currencies stay separate and input payroll lines are not mutated', () => {
  const groups = [{ id: 'mixed', name: 'Mixed', lines: [line('CDF', 100, 10, 5, 115), line('USD', 20, 2, 1, 23)] }]
  const before = structuredClone(groups)
  const result = weeklyPayrollTeamSummary(groups)
  assert.deepEqual(result.currencies, ['CDF', 'USD'])
  assert.equal(result.rows[0].byCurrency.CDF.total, 115)
  assert.equal(result.rows[0].byCurrency.USD.total, 23)
  assert.deepEqual(groups, before)
})

test('weekly payroll renders one selectable team summary and no legacy team table', () => {
  const operations = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  const summary = readFileSync('./src/components/Payroll/WeeklyPayrollTeamSummary.jsx', 'utf8')
  assert.doesNotMatch(operations, /import Table from/)
  assert.doesNotMatch(operations, /const teamColumns =/)
  assert.match(operations, /selectedTeamId=\{selectedTeamId\}/)
  assert.doesNotMatch(operations, /payroll\.allTeamsTotal/)
  assert.doesNotMatch(operations, /overallAmountDueByCurrency/)
  assert.doesNotMatch(operations, /surface-card p-6 text-center/)
  assert.match(summary, /<PayrollTeamCards groups=\{groups\} onOpenTeam=\{onSelectTeam\}/)
  assert.doesNotMatch(summary, /onClick=\{\(\) => onSelectTeam/)
  assert.match(summary, /Number\(byCurrency\[currency\]\?\.\[key\] \|\| 0\) !== 0/)
  assert.match(summary, /values\(row\.byCurrency, 'total', true\)/)
  assert.match(summary, /values\(summary\.totals\.byCurrency, 'total'\)/)
})
