import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildCompensationReviewGroups } from './src/utils/compensationReview.js'

const workers = [
  { id: 'weekly', full_name: 'Weekly Worker', employee_code: '10', team_id: 'b', team_name: 'Beta', is_active: true, payment_type: 'weekly', payroll_compensation: { currency_code: 'CDF', daily_rate: 22000, monthly_salary: 999999, daily_transport_allowance: 5000 } },
  { id: 'monthly', full_name: 'Monthly Worker', employee_code: '11', team_id: 'a', team_name: 'Alpha', is_active: true, payment_type: 'monthly', payroll_compensation: { currency_code: 'CDF', daily_rate: 12345, monthly_salary: 750000, daily_transport_allowance: 80000 } },
  { id: 'inactive', full_name: 'Inactive Worker', team_id: 'a', team_name: 'Alpha', is_active: false, payment_type: 'weekly', payroll_compensation: { daily_rate: 1, daily_transport_allowance: 2 } },
]

test('compensation review groups active workers by team and copies stored values only', () => {
  const groups = buildCompensationReviewGroups(workers)
  assert.deepEqual(groups.map((group) => group.name), ['Alpha', 'Beta'])
  assert.equal(groups.flatMap((group) => group.workers).some((worker) => worker.id === 'inactive'), false)
  const weekly = groups.flatMap((group) => group.workers).find((worker) => worker.id === 'weekly')
  const monthly = groups.flatMap((group) => group.workers).find((worker) => worker.id === 'monthly')
  assert.deepEqual({ dailyRate: weekly.dailyRate, monthlySalary: weekly.monthlySalary, transport: weekly.transportAllowance }, { dailyRate: 22000, monthlySalary: null, transport: 5000 })
  assert.deepEqual({ dailyRate: monthly.dailyRate, monthlySalary: monthly.monthlySalary, transport: monthly.transportAllowance }, { dailyRate: null, monthlySalary: 750000, transport: 80000 })
})

test('print report has exactly the six review columns and no payroll calculations', async () => {
  const page = await readFile(new URL('src/pages/CompensationReviewReport.jsx', import.meta.url), 'utf8')
  const helper = await readFile(new URL('src/utils/compensationReview.js', import.meta.url), 'utf8')
  assert.match(page, /payroll\.paymentType[\s\S]*payroll\.dailyRate[\s\S]*payroll\.monthlySalary[\s\S]*payroll\.transportAllowance[\s\S]*payroll\.reviewNotes/)
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
})

test('Payroll links to the protected standalone compensation review route', async () => {
  const payroll = await readFile(new URL('src/pages/Payroll.jsx', import.meta.url), 'utf8')
  const router = await readFile(new URL('src/routes/AppRouter.jsx', import.meta.url), 'utf8')
  assert.match(payroll, /to="\/payroll\/compensation-review"/)
  assert.match(router, /path="\/payroll\/compensation-review" element=\{<CompensationReviewReport \/>\}/)
})
