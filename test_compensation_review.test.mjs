import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildCompensationReviewSections, hasConfiguredBaseCompensation, hasStoredTransportAllowance } from './src/utils/compensationReview.js'

const workers = [
  { id: 'weekly', full_name: 'Weekly Worker', employee_code: '10', team_id: 'b', team_name: 'Beta', is_active: true, payment_type: 'weekly', payroll_compensation: { currency_code: 'CDF', daily_rate: 22000, monthly_salary: 999999, daily_transport_allowance: 5000 } },
  { id: 'monthly', full_name: 'Monthly Worker', employee_code: '11', team_id: 'a', team_name: 'Alpha', is_active: true, payment_type: 'monthly', payroll_compensation: { currency_code: 'CDF', daily_rate: 12345, monthly_salary: 750000, daily_transport_allowance: 80000 } },
  { id: 'inactive', full_name: 'Inactive Worker', team_id: 'a', team_name: 'Alpha', is_active: false, payment_type: 'weekly', payroll_compensation: { daily_rate: 1, daily_transport_allowance: 2 } },
  { id: 'foreign-weekly', full_name: 'Foreign Weekly', team_id: 'a', team_name: 'Alpha', is_active: true, staff_classification: 'special_staff', payment_type: 'weekly', payroll_compensation: { daily_rate: 300, daily_transport_allowance: 30 } },
  { id: 'foreign-monthly', full_name: 'Foreign Monthly', team_id: 'b', team_name: 'Beta', is_active: true, staff_classification: 'special_staff', payment_type: 'monthly', payroll_compensation: { monthly_salary: 9000, daily_transport_allowance: 90 } },
]

const configuredWorker = (overrides = {}) => ({
  id: overrides.id || 'fixture',
  full_name: 'Configured Worker',
  team_id: 'team',
  team_name: 'Team',
  is_active: true,
  staff_classification: 'normal',
  payment_type: 'weekly',
  payroll_compensation: { currency_code: 'CDF', daily_rate: 100, monthly_salary: null, daily_transport_allowance: 0 },
  ...overrides,
})

test('compensation review excludes inactive and special staff before separating payment types', () => {
  const report = buildCompensationReviewSections(workers)
  assert.equal(report.workerCount, 2)
  assert.equal(report.weeklyCount, 1)
  assert.equal(report.monthlyCount, 1)
  const includedIds = [...report.weeklyGroups, ...report.monthlyGroups].flatMap((group) => group.workers.map((worker) => worker.id))
  assert.deepEqual(includedIds.sort(), ['monthly', 'weekly'])
})

test('weekly and monthly workers remain grouped by team with stored values only', () => {
  const report = buildCompensationReviewSections(workers)
  assert.deepEqual(report.weeklyGroups.map((group) => group.name), ['Beta'])
  assert.deepEqual(report.monthlyGroups.map((group) => group.name), ['Alpha'])
  const weekly = report.weeklyGroups[0].workers[0]
  const monthly = report.monthlyGroups[0].workers[0]
  assert.deepEqual({ dailyRate: weekly.dailyRate, monthlySalary: weekly.monthlySalary, transport: weekly.transportAllowance }, { dailyRate: 22000, monthlySalary: null, transport: 5000 })
  assert.deepEqual({ dailyRate: monthly.dailyRate, monthlySalary: monthly.monthlySalary, transport: monthly.transportAllowance }, { dailyRate: null, monthlySalary: 750000, transport: 80000 })
})

test('weekly workers remain eligible when daily rate or the current compensation term is missing', () => {
  assert.equal(hasConfiguredBaseCompensation(configuredWorker()), true)
  const missing = [
    configuredWorker({ id: 'null-rate', payroll_compensation: { daily_rate: null } }),
    configuredWorker({ id: 'zero-rate', payroll_compensation: { daily_rate: 0 } }),
    configuredWorker({ id: 'no-term', payroll_compensation: null }),
  ]
  const report = buildCompensationReviewSections(missing)
  assert.deepEqual(report.weeklyGroups.flatMap((group) => group.workers.map((worker) => worker.id)).sort(), ['no-term', 'null-rate', 'zero-rate'])
  assert.equal(report.missingBaseCompensationCount, 3)
})

test('monthly workers remain eligible when monthly salary is missing', () => {
  const worker = configuredWorker({ payment_type: 'monthly', payroll_compensation: { monthly_salary: null, daily_transport_allowance: 50 } })
  const report = buildCompensationReviewSections([worker])
  assert.equal(report.monthlyCount, 1)
  assert.equal(report.monthlyGroups[0].workers[0].monthlySalary, null)
  assert.equal(report.missingBaseCompensationCount, 1)
})

test('zero transport is stored while missing transport remains distinguishable', () => {
  const report = buildCompensationReviewSections([
    configuredWorker({ id: 'zero-transport', payroll_compensation: { daily_rate: 20, daily_transport_allowance: 0 } }),
    configuredWorker({ id: 'missing-transport', payroll_compensation: { daily_rate: 20, daily_transport_allowance: null } }),
  ])
  const rows = report.weeklyGroups[0].workers
  assert.equal(rows.find((worker) => worker.id === 'zero-transport').transportAllowance, 0)
  assert.equal(rows.find((worker) => worker.id === 'missing-transport').transportAllowance, null)
  assert.equal(hasStoredTransportAllowance(configuredWorker({ payroll_compensation: { daily_rate: 20, daily_transport_allowance: 0 } })), true)
  assert.equal(report.missingTransportCount, 1)
})

test('previously excluded missing-compensation workers are retained for review', () => {
  const reviewRows = [
    configuredWorker({ id: 'chadrack-108', full_name: 'CHADRACK', payroll_compensation: null }),
    configuredWorker({ id: 'heart-317', full_name: 'heart', payroll_compensation: { daily_rate: 0, daily_transport_allowance: 0 } }),
    configuredWorker({ id: 'joseph-105', full_name: 'JOSEPH', payroll_compensation: { daily_rate: null, daily_transport_allowance: 0 } }),
  ]
  const report = buildCompensationReviewSections(reviewRows)
  assert.deepEqual(report.weeklyGroups.flatMap((group) => group.workers.map((worker) => worker.id)), ['chadrack-108', 'heart-317', 'joseph-105'])
  assert.equal(report.missingBaseCompensationCount, 3)
})

test('workers without a team remain visible in a dedicated unassigned group', () => {
  const report = buildCompensationReviewSections([configuredWorker({ team_id: null, team_name: null })])
  assert.equal(report.weeklyGroups[0].id, 'unassigned')
  assert.equal(report.weeklyGroups[0].name, null)
  assert.equal(report.noTeamCount, 1)
})

test('weekly and monthly sections render only their relevant compensation columns', async () => {
  const page = await readFile(new URL('src/pages/CompensationReviewReport.jsx', import.meta.url), 'utf8')
  const helper = await readFile(new URL('src/utils/compensationReview.js', import.meta.url), 'utf8')
  assert.match(page, /isMonthly \? 'payroll\.monthlySalary' : 'payroll\.dailyRate'/)
  assert.match(page, /payroll\.unspecified/)
  assert.match(page, /if \(!configured\) return <strong dir="auto">/)
  assert.match(page, /biometricMapping\.noTeam/)
  assert.match(page, /weeklyWorkersReview[\s\S]*weeklyGroups[\s\S]*monthlyWorkersReview[\s\S]*monthlyGroups/)
  assert.doesNotMatch(page, /<th>\{t\('payroll\.paymentType'\)\}/)
  assert.match(page, /getPayrollSettingsWorkersRequest/)
  assert.doesNotMatch(`${page}\n${helper}`, /getAttendanceRequest|calculatePayroll|attendanceByDate|overtime|deduction|finalAmount|netPay/)
})

test('A4 print CSS flows teams continuously and repeats table headers', async () => {
  const css = await readFile(new URL('src/index.css', import.meta.url), 'utf8')
  const block = css.slice(css.indexOf('.compensation-review-print-root'))
  assert.match(block, /@page\s*\{[\s\S]*size:\s*A4 portrait/)
  assert.match(block, /\.compensation-review-team\s*\{[\s\S]*break-inside:\s*auto/)
  assert.match(block, /\.compensation-review-team thead\s*\{[\s\S]*display:\s*table-header-group/)
  assert.match(block, /counter\(page\)[\s\S]*counter\(pages\)/)
  assert.doesNotMatch(block, /\.compensation-review-team\s*\{[^}]*break-(?:before|after):\s*page/)
  assert.doesNotMatch(block, /shadow-(?:sm|md|lg|xl)/)
})

test('existing payroll calculations are not imported or modified by the review report', async () => {
  const page = await readFile(new URL('src/pages/CompensationReviewReport.jsx', import.meta.url), 'utf8')
  const helper = await readFile(new URL('src/utils/compensationReview.js', import.meta.url), 'utf8')
  assert.doesNotMatch(`${page}\n${helper}`, /payrollCalculations|payrollOperationsApi|attendanceApi/)
})

test('Payroll links to the protected standalone compensation review route', async () => {
  const payroll = await readFile(new URL('src/pages/Payroll.jsx', import.meta.url), 'utf8')
  const router = await readFile(new URL('src/routes/AppRouter.jsx', import.meta.url), 'utf8')
  assert.match(payroll, /to="\/payroll\/compensation-review"/)
  assert.match(router, /path="\/payroll\/compensation-review" element=\{<CompensationReviewReport \/>\}/)
})
