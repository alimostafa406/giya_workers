import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { formatEveningOvertimeMinutes } from './src/utils/weeklyPayrollOvertime.js'
import { positiveWeeklyPayrollFooterAmounts, weeklyPayrollTeamFooter } from './src/utils/weeklyPayrollTeamFooter.js'

const detail = (date, checkIn, checkOut) => ({ date, row: { check_in: checkIn, check_out: checkOut } })
const line = ({ currency = 'CDF', transportAmount = 0, overtimeAmount = 0, finalAmount = 0, details = [] } = {}) => ({ currency, transportAmount, overtimeAmount, finalAmount, details })

test('zero transport is hidden while positive transport remains visible', () => {
  const footer = weeklyPayrollTeamFooter([
    line({ currency: 'CDF', transportAmount: 0 }),
    line({ currency: 'USD', transportAmount: 25 }),
  ])
  assert.deepEqual(positiveWeeklyPayrollFooterAmounts(footer, 'transport'), [['USD', 25]])
})

test('team evening overtime sums approved worker minutes and excludes morning time', () => {
  const footer = weeklyPayrollTeamFooter([
    line({ details: [detail('2026-09-14', '06:00:00', '18:30:00')] }),
    line({ details: [detail('2026-09-15', '07:30:00', '19:00:00')] }),
    line({ details: [detail('2026-09-16', '05:00:00', '17:59:00')] }),
  ])
  assert.equal(footer.eveningOvertimeMinutes, 210)
  assert.equal(formatEveningOvertimeMinutes(footer.eveningOvertimeMinutes), '3h30')
  assert.equal(formatEveningOvertimeMinutes(weeklyPayrollTeamFooter([]).eveningOvertimeMinutes), '—')
})

test('overtime pay and payroll totals use canonical amounts and keep currencies separate', () => {
  const lines = [
    line({ currency: 'CDF', overtimeAmount: 4000, finalAmount: 100000 }),
    line({ currency: 'CDF', overtimeAmount: 6000, finalAmount: 200000 }),
    line({ currency: 'USD', overtimeAmount: 5, finalAmount: 25 }),
  ]
  const before = structuredClone(lines)
  const footer = weeklyPayrollTeamFooter(lines)
  assert.deepEqual(positiveWeeklyPayrollFooterAmounts(footer, 'overtimePay'), [['CDF', 10000], ['USD', 5]])
  assert.deepEqual(positiveWeeklyPayrollFooterAmounts(footer, 'payrollTotal'), [['CDF', 300000], ['USD', 25]])
  assert.deepEqual(lines, before)
})

test('selected-team footer removes the legacy candidate metric and uses the canonical fields', () => {
  const source = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  const footer = source.slice(source.indexOf('data-weekly-team-review'))
  assert.doesNotMatch(footer, /payroll\.candidateOvertimeHours/)
  assert.match(footer, /selectedTeamFooter\.eveningOvertimeMinutes/)
  assert.match(source, /const overtimePayFooterAmounts = footerAmounts\('overtimePay'\)/)
  assert.match(footer, /amountDue\(selectedTeam\.amountDueByCurrency\)/)
  assert.match(footer, /transportFooterAmounts\.length \? <p>/)
})
