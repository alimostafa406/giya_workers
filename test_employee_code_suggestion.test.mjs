import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getNumericEmployeeCodeSequence, getNextNumericEmployeeCode, isDuplicateEmployeeCodeError } from './src/utils/employeeCodeSuggestion.js'

test('suggestion uses numeric maximum plus one and never fills a gap', () => {
  assert.deepEqual(getNumericEmployeeCodeSequence([
    { employee_code: '318' },
    { employee_code: '319' },
    { employee_code: '320' },
    { employee_code: '322' },
  ]), { highest: '322', next: '323' })
})

test('numeric comparison handles 99 and 100 correctly', () => {
  assert.equal(getNextNumericEmployeeCode([
    { employee_code: '99' },
    { employee_code: '100' },
  ]), '101')
})

test('legacy values are ignored and surrounding whitespace is accepted', () => {
  assert.deepEqual(getNumericEmployeeCodeSequence([
    { employee_code: 'HIK-500' },
    { employee_code: '12A' },
    { employee_code: '' },
    { employee_code: null },
    { employee_code: ' 322 ' },
  ]), { highest: '322', next: '323' })
})

test('large numeric codes do not lose integer precision', () => {
  assert.equal(getNextNumericEmployeeCode([
    { employee_code: '9007199254740993' },
  ]), '9007199254740994')
})

test('duplicate employee-code errors remain distinguishable from other mapping failures', () => {
  assert.equal(isDuplicateEmployeeCodeError({ code: '23505', message: 'Employee code already exists.' }), true)
  assert.equal(isDuplicateEmployeeCodeError({ code: '23505', message: 'Device identity already mapped.' }), false)
})

test('mapping modal pre-fills an editable opening snapshot without refresh overwrite', async () => {
  const modal = await readFile(new URL('./src/components/Biometric/CreateWorkerFromDeviceModal.jsx', import.meta.url), 'utf8')
  const page = await readFile(new URL('./src/pages/BiometricMapping.jsx', import.meta.url), 'utf8')

  assert.match(modal, /setEmployeeCode\(initialEmployeeCode\)/)
  assert.match(modal, /value=\{employeeCode\} onChange=\{\(event\) => setEmployeeCode\(event\.target\.value\)\}/)
  assert.match(modal, /if \(initializedForCurrentOpening\.current\) return/)
  assert.match(modal, /initializedForCurrentOpening\.current = false/)
  assert.match(page, /onClick=\{openCreateWorker\}/)
  assert.match(page, /initialEmployeeCode=\{suggestedEmployeeCode\}/)
  assert.match(page, /setCommittedEmployeeCodes/)
})

test('suggestion failure stays optional and fast creation orchestration remains in place', async () => {
  const page = await readFile(new URL('./src/pages/BiometricMapping.jsx', import.meta.url), 'utf8')

  assert.match(page, /A suggestion is optional\. Keep the field editable when calculation fails\./)
  assert.match(page, /completeCriticalBiometricWorkerCreation\(/)
  assert.match(page, /if \(!selectedDevice \|\| creatingWorker\) return/)
  assert.match(page, /void load\(\)/)
})
