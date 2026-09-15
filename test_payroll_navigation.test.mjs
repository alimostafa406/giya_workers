import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('payroll opens weekly by default and exposes only weekly and monthly main modes', () => {
  const page = readFileSync('./src/pages/Payroll.jsx', 'utf8')
  assert.match(page, /useState\('weekly'\)/)
  assert.match(page, /t\('payroll\.weeklyOperations'\)/)
  assert.match(page, /t\('payroll\.monthlyOperations'\)/)
  assert.match(page, /section === 'weekly' \? <PayrollOperations \/> : <MonthlyPayrollOperations \/>/)
  assert.doesNotMatch(page, /setSection\('(operations|sundays|settings|history)'\)/)
  assert.doesNotMatch(page, /import SundayPaymentsPanel/)
  assert.doesNotMatch(page, /setSection\('history'\)/)
})

test('payroll navigation labels match Arabic, English, and French requirements', () => {
  const translations = readFileSync('./src/i18n/translations.js', 'utf8')
  assert.match(translations, /weeklyOperations: 'القبض الأسبوعي'/)
  assert.match(translations, /weeklyOperations: 'Weekly Payroll'/)
  assert.match(translations, /weeklyOperations: 'Paie hebdomadaire'/)
  assert.match(translations, /monthlyOperations: 'القبض الشهري'/)
  assert.match(translations, /monthlyOperations: 'Monthly Payroll'/)
  assert.match(translations, /monthlyOperations: 'Paie mensuelle'/)
})

test('secondary publication and compensation-review access remains available', () => {
  const page = readFileSync('./src/pages/Payroll.jsx', 'utf8')
  assert.match(page, /to="\/payroll\/publication"/)
  assert.match(page, /to="\/payroll\/compensation-review"/)
  assert.match(page, /setHistoryOpen\(\(open\) => !open\)/)
  assert.match(page, /historyOpen \? <div className="mt-4"><PayrollHistory \/><\/div> : null/)
  assert.match(page, /function PayrollSettingsForm/)
  assert.match(page, /saveWorkerPayrollSettingsRequest/)
})
