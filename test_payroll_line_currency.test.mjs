import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assertPayrollLineCurrencies, payrollLineCurrencySnapshot } from './src/utils/payrollLineCurrency.js'

const line = (currency) => ({
  currency,
  worker: { full_name: 'WORKER', employee_code: '1' },
  baseAmount: 12500,
  transportAmount: 750,
  finalAmount: 13250,
})

test('payroll line snapshots preserve configured CDF and USD currencies', () => {
  assert.equal(payrollLineCurrencySnapshot(line('CDF')), 'CDF')
  assert.equal(payrollLineCurrencySnapshot(line('USD')), 'USD')
})

test('missing compensation currency fails before payroll persistence', () => {
  assert.throws(
    () => assertPayrollLineCurrencies([line(null)]),
    /Payroll compensation currency is not configured for: WORKER #1/,
  )

  const api = readFileSync('./src/api/payrollOperationsApi.js', 'utf8')
  const validationIndex = api.indexOf('assertPayrollLineCurrencies(lines)')
  const clientIndex = api.indexOf('const client = getSupabaseClient()', validationIndex)
  assert.ok(validationIndex >= 0 && clientIndex > validationIndex)
})

test('currency validation performs no conversion and changes no amounts', () => {
  const original = line('CDF')
  const before = structuredClone(original)

  assertPayrollLineCurrencies([original])
  assert.equal(payrollLineCurrencySnapshot(original), 'CDF')
  assert.deepEqual(original, before)
})
