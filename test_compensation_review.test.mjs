import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildCompensationReviewSections, hasConfiguredBaseCompensation } from './src/utils/compensationReview.js'

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

test('weekly eligibility requires a real positive configured daily rate', () => {
  assert.equal(hasConfiguredBaseCompensation(configuredWorker()), true)
  for (const dailyRate of [null, undefined, '', 0, '0.00', -1, 'not-a-number']) {
    assert.equal(hasConfiguredBaseCompensation(configuredWorker({ payroll_compensation: { daily_rate: dailyRate, daily_transport_allowance: 50 } })), false)
  }
  assert.equal(hasConfiguredBaseCompensation(configuredWorker({ payroll_compensation: null })), false)
})

test('monthly eligibility requires a real positive configured monthly salary', () => {
  const monthly = (monthlySalary, compensation = true) => configuredWorker({
    payment_type: 'monthly',
    payroll_compensation: compensation ? { monthly_salary: monthlySalary, daily_transport_allowance: 50 } : null,
  })
  assert.equal(hasConfiguredBaseCompensation(monthly(800)), true)
  for (const salary of [null, undefined, '', 0, '0.00', -1, Number.NaN]) {
    assert.equal(hasConfiguredBaseCompensation(monthly(salary)), false)
  }
  assert.equal(hasConfiguredBaseCompensation(monthly(800, false)), false)
})

test('zero transport remains eligible while transport alone cannot make a worker eligible', () => {
  const report = buildCompensationReviewSections([
    configuredWorker({ id: 'zero-transport', payroll_compensation: { daily_rate: 20, daily_transport_allowance: 0 } }),
    configuredWorker({ id: 'transport-only', payroll_compensation: { daily_rate: 0, daily_transport_allowance: 5 } }),
  ])
  assert.deepEqual(report.weeklyGroups.flatMap((group) => group.workers.map((worker) => worker.id)), ['zero-transport'])
  assert.equal(report.weeklyGroups[0].workers[0].transportAllowance, 0)
})

test('included report rows can never have a missing or non-positive base amount', () => {
  const badRows = [
    configuredWorker({ id: 'chadrack-108', full_name: 'CHADRACK', payroll_compensation: null }),
    configuredWorker({ id: 'heart-317', full_name: 'heart', payroll_compensation: { daily_rate: 0, daily_transport_allowance: 0 } }),
    configuredWorker({ id: 'joseph-105', full_name: 'JOSEPH', payroll_compensation: { daily_rate: null, daily_transport_allowance: 0 } }),
  ]
  const report = buildCompensationReviewSections([...workers, ...badRows])
  report.weeklyGroups.flatMap((group) => group.workers).forEach((worker) => assert.ok(Number(worker.dailyRate) > 0))
  report.monthlyGroups.flatMap((group) => group.workers).forEach((worker) => assert.ok(Number(worker.monthlySalary) > 0))
  assert.equal([...report.weeklyGroups, ...report.monthlyGroups].flatMap((group) => group.workers).some((worker) => badRows.some((bad) => bad.id === worker.id)), false)
})

test('weekly and monthly sections render only their relevant compensation columns', async () => {
  const page = await readFile(new URL('src/pages/CompensationReviewReport.jsx', import.meta.url), 'utf8')
  const helper = await readFile(new URL('src/utils/compensationReview.js', import.meta.url), 'utf8')
  assert.match(page, /isMonthly \? 'payroll\.monthlySalary' : 'payroll\.dailyRate'/)
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
