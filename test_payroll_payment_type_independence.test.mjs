import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildWorkerPayrollSettingsSavePlan } from './src/utils/payrollSettings.js'
import { buildCompensationReviewSections } from './src/utils/compensationReview.js'

const TODAY = '2026-09-11'

const plan = (worker, values) => buildWorkerPayrollSettingsSavePlan(worker, {
  payment_type: values.payment_type,
  currency_code: values.currency_code ?? '',
  daily_rate: values.daily_rate ?? '',
  monthly_salary: values.monthly_salary ?? '',
  daily_transport_allowance: values.daily_transport_allowance ?? '',
  overtime_rate_per_hour: values.overtime_rate_per_hour ?? '',
  overtime_start_time: values.overtime_start_time ?? '',
  monthly_payroll_cycle_start_date: values.monthly_payroll_cycle_start_date ?? '',
  effective_from: TODAY,
  save_compensation: values.save_compensation,
}, TODAY)

test('weekly worker can become monthly with no salary, cycle, or compensation term', () => {
  const result = plan({ id: 'worker', payment_type: 'weekly' }, { payment_type: 'monthly', save_compensation: false })
  assert.deepEqual(result.profilePayload, { payment_type: 'monthly', monthly_salary: null })
  assert.equal(result.compensationPayload, null)
})

test('monthly worker can become weekly with no daily rate or compensation term', () => {
  const result = plan({ id: 'worker', payment_type: 'monthly' }, { payment_type: 'weekly', save_compensation: false })
  assert.deepEqual(result.profilePayload, { payment_type: 'weekly', monthly_salary: null })
  assert.equal(result.compensationPayload, null)
})

test('empty base compensation remains null rather than being invented as zero', () => {
  const result = plan({ id: 'worker', payment_type: 'weekly' }, {
    payment_type: 'monthly',
    currency_code: 'CDF',
    monthly_salary: '',
    daily_transport_allowance: 0,
    save_compensation: true,
  })
  assert.equal(result.profilePayload.monthly_salary, null)
  assert.equal(result.compensationPayload.monthly_salary, null)
  assert.equal(result.compensationPayload.monthly_payroll_cycle_start_date, null)
})

test('negative or non-numeric entered compensation remains rejected', () => {
  assert.throws(() => plan({ id: 'worker', payment_type: 'weekly' }, { payment_type: 'weekly', currency_code: 'CDF', daily_rate: -1, save_compensation: true }), /Daily rate must be a non-negative number/)
  assert.throws(() => plan({ id: 'worker', payment_type: 'monthly' }, { payment_type: 'monthly', currency_code: 'CDF', monthly_salary: 'invalid', save_compensation: true }), /Monthly salary must be a non-negative number/)
})

test('existing valid compensation can still be saved as an effective dated term', () => {
  const result = plan({ id: 'worker', payment_type: 'monthly' }, {
    payment_type: 'monthly',
    currency_code: 'USD',
    monthly_salary: 800,
    daily_transport_allowance: 50,
    monthly_payroll_cycle_start_date: '2026-09-01',
    save_compensation: true,
  })
  assert.equal(result.compensationPayload.worker_id, 'worker')
  assert.equal(result.compensationPayload.effective_from, TODAY)
  assert.equal(result.compensationPayload.monthly_salary, 800)
  assert.equal(result.compensationPayload.daily_transport_allowance, 50)
})

test('review report follows saved payment type even when base compensation is missing', () => {
  const worker = { id: 'worker', full_name: 'Worker', is_active: true, staff_classification: 'normal', payment_type: 'monthly', payroll_compensation: null }
  const monthly = buildCompensationReviewSections([worker])
  assert.equal(monthly.weeklyCount, 0)
  assert.equal(monthly.monthlyCount, 1)
  assert.equal(monthly.monthlyGroups[0].workers[0].monthlySalary, null)

  const weekly = buildCompensationReviewSections([{ ...worker, payment_type: 'weekly' }])
  assert.equal(weekly.weeklyCount, 1)
  assert.equal(weekly.monthlyCount, 0)
})

test('history is preserved and incomplete workers remain excluded from payroll generation', async () => {
  const api = await readFile(new URL('src/api/payrollSettingsApi.js', import.meta.url), 'utf8')
  const monthly = await readFile(new URL('src/components/Payroll/MonthlyPayrollOperations.jsx', import.meta.url), 'utf8')
  const weekly = await readFile(new URL('src/components/Payroll/PayrollOperations.jsx', import.meta.url), 'utf8')
  assert.match(api, /onConflict: 'worker_id,effective_from'/)
  assert.match(api, /if \(plan\.compensationPayload\)/)
  assert.match(api, /saveWorkerPayrollProfileRequest\(worker\.id, plan\.profilePayload\)/)
  assert.doesNotMatch(api, /\.delete\(\)/)
  assert.match(monthly, /if \(!cycle \|\| term\?\.monthly_salary == null \|\| !term\?\.currency_code\) return null/)
  assert.match(weekly, /filter\(\(line\) => line\.term\?\.daily_rate != null\)/)
})

test('payroll settings and monthly editor expose non-blocking incomplete compensation fields', async () => {
  const settings = await readFile(new URL('src/pages/Payroll.jsx', import.meta.url), 'utf8')
  const monthly = await readFile(new URL('src/components/Payroll/MonthlyPayrollOperations.jsx', import.meta.url), 'utf8')
  for (const source of [settings, monthly]) {
    assert.match(source, /payroll\.missingConfiguration/)
  }
  assert.doesNotMatch(settings, /value=\{values\.monthly_salary\}[^>]*required/)
  assert.doesNotMatch(settings, /value=\{values\.daily_rate\}[^>]*required/)
  assert.doesNotMatch(monthly, /value=\{values\.salary \|\| ''\}[^>]*required/)
  assert.doesNotMatch(monthly, /value=\{values\.dailyRate \|\| ''\}[^>]*required/)
})
