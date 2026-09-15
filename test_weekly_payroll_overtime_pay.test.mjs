import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { applyWeeklyOvertimePay, calculateWeeklyOvertimePay } from './src/utils/weeklyPayrollOvertime.js'

test('exact overtime minutes are paid at each worker rate', () => {
  for (const [minutes, expected] of [[30, 1000], [45, 1500], [90, 3000], [285, 9500]]) assert.equal(calculateWeeklyOvertimePay({ eveningOvertimeMinutes: minutes, overtimeHourlyRate: 2000 }).overtimePay, expected)
  assert.equal(calculateWeeklyOvertimePay({ morningOvertimeMinutes: 15, eveningOvertimeMinutes: 20, overtimeHourlyRate: 2000 }).overtimePay, 1166.67)
  assert.equal(calculateWeeklyOvertimePay({ eveningOvertimeMinutes: 60, overtimeHourlyRate: 1500 }).overtimePay, 1500)
  assert.equal(calculateWeeklyOvertimePay({ eveningOvertimeMinutes: 60, overtimeHourlyRate: 3500 }).overtimePay, 3500)
})

test('missing rate blocks only positive overtime', () => {
  assert.equal(calculateWeeklyOvertimePay({ overtimeHourlyRate: null }).missingRateBlocker, false)
  const missing = calculateWeeklyOvertimePay({ eveningOvertimeMinutes: 15, overtimeHourlyRate: null })
  assert.equal(missing.overtimePay, null)
  assert.equal(missing.missingRateBlocker, true)
})

test('canonical weekly integration replaces legacy overtime once and preserves currency', () => {
  const line = { currency: 'CDF', term: { overtime_rate_per_hour: 2000 }, details: [{ date: '2026-09-14', row: { check_in: '08:00:00', check_out: '18:00:00' } }], overtimeAmount: 999, finalAmount: 10999 }
  const result = applyWeeklyOvertimePay(line)
  assert.equal(result.currency, 'CDF')
  assert.equal(result.overtimeAmount, 2000)
  assert.equal(result.finalAmount, 12000)
  assert.equal(line.finalAmount, 10999)
})

test('worker overtime pay uses completed evening blocks without double counting', () => {
  for (const [checkout, expectedMinutes, expectedPay] of [['18:00:00', 60, 2000], ['18:20:00', 60, 2000], ['18:30:00', 90, 3000], ['19:30:00', 150, 5000]]) {
    const result = applyWeeklyOvertimePay({ currency: 'CDF', term: { overtime_rate_per_hour: 2000 }, details: [{ date: '2026-09-14', row: { check_in: '08:00:00', check_out: checkout } }], overtimeAmount: 700, finalAmount: 10700 })
    assert.equal(result.eveningOvertimeMinutes, expectedMinutes)
    assert.equal(result.overtimeAmount, expectedPay)
    assert.equal(result.finalAmount, 10000 + expectedPay)
  }
})

test('snapshot contains rate, separate minutes, overtime pay, currency, and final amount', () => {
  const api = readFileSync('./src/api/payrollOperationsApi.js', 'utf8')
  for (const field of ['morning_overtime_minutes', 'evening_overtime_minutes', 'overtime_hourly_rate', 'overtime_pay']) assert.match(api, new RegExp(field))
  assert.match(api, /currency_code_snapshot: payrollLineCurrencySnapshot\(line\)/)
  assert.match(api, /final_amount: line\.finalAmount/)
})
