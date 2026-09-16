import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { payrollConfigurationWarnings } from './src/utils/payrollWarnings.js'

const worker = { id: 'w1', full_name: 'MUNIANGA', employee_code: '346', team_name: 'Peinture Raghibe' }

test('missing weekly configuration produces precise warnings without mutating canonical values', () => {
  const lines = [{ worker, term: {}, eveningOvertimeMinutes: 90, overtimeAmount: 0, finalAmount: 1250 }]
  const original = structuredClone(lines)
  const warnings = payrollConfigurationWarnings(lines, 'weekly')
  assert.deepEqual(warnings.map((warning) => warning.field), ['dailyRate', 'transport', 'overtimeRate'])
  assert.ok(warnings.every((warning) => warning.workerName === 'MUNIANGA' && warning.employeeCode === '346' && warning.teamName === 'Peinture Raghibe'))
  assert.deepEqual(lines, original)
  assert.equal(lines[0].eveningOvertimeMinutes, 90)
  assert.equal(lines[0].finalAmount, 1250)
})

test('monthly salary and transport warnings remain separate and multiple workers render independently', () => {
  const warnings = payrollConfigurationWarnings([
    { worker, term: { monthly_salary: null, daily_transport_allowance: null }, finalAmount: 0 },
    { worker: { id: 'w2', full_name: 'JOEL', team_name: 'Siraj' }, term: { monthly_salary: 100, daily_transport_allowance: null }, finalAmount: 100 },
  ], 'monthly')
  assert.deepEqual(warnings.map((warning) => `${warning.workerName}:${warning.field}`), [
    'MUNIANGA:monthlySalary',
    'MUNIANGA:transport',
    'JOEL:transport',
  ])
})

test('configured zero is not treated as missing while missing overtime money stays unresolved', () => {
  const warnings = payrollConfigurationWarnings([{ worker, term: { daily_rate: 0, daily_transport_allowance: 0, overtime_rate_per_hour: null }, eveningOvertimeMinutes: 60, overtimeAmount: 0 }], 'weekly')
  assert.deepEqual(warnings.map((warning) => warning.field), ['overtimeRate'])
})

test('weekly configuration warnings no longer participate in lifecycle blockers but integrity checks remain', async () => {
  const source = await readFile(new URL('./src/components/Payroll/PayrollOperations.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /invalidCompensationLines|missingOvertimeRateLines/)
  assert.match(source, /reviewValidationRun/)
  assert.match(source, /reviewValidationPeriod/)
  assert.match(source, /reviewValidationLines/)
  assert.match(source, /reviewValidationAdjustments/)
  assert.match(source, /reviewValidationTotals/)
  assert.match(source, /!Number\.isFinite\(line\.finalAmount\)/)
  assert.match(source, /missingOvertimeRate \? '—'/)
})

test('monthly workers with missing salary remain reportable and only structural failures block review', async () => {
  const source = await readFile(new URL('./src/components/Payroll/MonthlyPayrollOperations.jsx', import.meta.url), 'utf8')
  assert.match(source, /if \(!cycle \|\| !term\?\.currency_code\) return null/)
  assert.doesNotMatch(source, /if \(!cycle \|\| term\?\.monthly_salary == null/)
  assert.match(source, /!line\.worker\?\.id \|\| !Number\.isFinite\(Number\(line\.finalAmount\)\)/)
  assert.match(source, /line\.term\?\.monthly_salary==null\?'—'/)
})

test('snapshots preserve unresolved configuration metadata and publication remains finalized-data based', async () => {
  const [apiSource, publicationSource] = await Promise.all([
    readFile(new URL('./src/api/payrollOperationsApi.js', import.meta.url), 'utf8'),
    readFile(new URL('./src/utils/currentWeeklyPayrollWorkflow.js', import.meta.url), 'utf8'),
  ])
  assert.match(apiSource, /unresolved_configuration:/)
  assert.match(apiSource, /overtime_rate:/)
  assert.match(publicationSource, /snapshotLines\.forEach/)
  assert.match(publicationSource, /numeric\(line\.final_amount\)/)
  assert.match(publicationSource, /publishable: isFinalized && snapshotLines\.length > 0/)
})
