import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { biometricCoverageForWorker, buildBiometricCoverageByWorker } from './src/utils/biometricMappingCoverage.js'

const mapping = (workerId, deviceId, employeeNo, reviewState = 'confirmed') => ({
  worker_id: workerId,
  device_id: deviceId,
  device_employee_no: employeeNo,
  mapping_review_state: reviewState,
  is_active: true,
})

test('multiple legitimate confirmed identities for one worker are not a conflict', () => {
  const coverage = buildBiometricCoverageByWorker([
    mapping('nancy', 'office-main', '59'),
    mapping('nancy', null, '097'),
    mapping('hipo', 'office-main', '35'),
    mapping('hipo', null, '23'),
  ])
  assert.equal(biometricCoverageForWorker(coverage, 'nancy').status, 'multiple_identities')
  assert.equal(biometricCoverageForWorker(coverage, 'hipo').status, 'multiple_identities')
})

test('needs-review and missing coverage remain visible', () => {
  const coverage = buildBiometricCoverageByWorker([
    mapping('niva', 'office-main', '39', 'needs_review'),
    mapping('niva', 'office-secondary', '55550037'),
  ])
  assert.equal(biometricCoverageForWorker(coverage, 'niva').status, 'needs_review')
  assert.equal(biometricCoverageForWorker(coverage, 'johnson').status, 'unmapped')
})

test('only competing ownership of the same scoped identity is a conflict', () => {
  const coverage = buildBiometricCoverageByWorker([
    mapping('worker-a', 'office-main', '77'),
    mapping('worker-b', 'office-main', '77'),
    mapping('worker-c', 'office-secondary', '77'),
  ])
  assert.equal(biometricCoverageForWorker(coverage, 'worker-a').status, 'conflict')
  assert.equal(biometricCoverageForWorker(coverage, 'worker-b').status, 'conflict')
  assert.equal(biometricCoverageForWorker(coverage, 'worker-c').status, 'mapped')
})

test('unresolved monitoring uses persisted events and strict mapping evidence only', async () => {
  const sql = await readFile(new URL('./supabase/sql/unresolved_biometric_attendance_monitoring.sql', import.meta.url), 'utf8')

  assert.match(sql, /from public\.biometric_attendance_events as e/)
  assert.match(sql, /e\.id as event_id/)
  assert.doesNotMatch(sql, /select\s+c\.event_id[\s\S]*from candidate as c[\s\S]*select\s+o\.\*/i)
  assert.match(sql, /m\.device_employee_no = o\.device_employee_no/)
  assert.match(sql, /m\.device_id = o\.device_id or m\.device_id is null/)
  assert.match(sql, /mapping_review_state = 'confirmed'/)
  assert.match(sql, /between time '07:00:00' and time '09:00:00'/)
  assert.match(sql, /'needs_review'/)
  assert.match(sql, /'unmapped'/)
  assert.match(sql, /'inactive_worker'/)
  assert.match(sql, /'ambiguous'/)
  assert.doesNotMatch(sql, /device_employee_no\s*=\s*w\.employee_code/i)
  assert.doesNotMatch(sql, /device_name\s*=\s*w\.full_name/i)
})

test('dashboard renders the unresolved warning and Workers uses truthful coverage states', async () => {
  const dashboard = await readFile(new URL('./src/pages/Dashboard.jsx', import.meta.url), 'utf8')
  const workers = await readFile(new URL('./src/pages/Workers.jsx', import.meta.url), 'utf8')
  const panel = await readFile(new URL('./src/components/Attendance/UnresolvedBiometricAttendancePanel.jsx', import.meta.url), 'utf8')

  assert.match(dashboard, /getUnresolvedBiometricAttendanceRequest/)
  assert.match(dashboard, /UnresolvedBiometricAttendancePanel/)
  assert.match(panel, /row\.resolution_reason/)
  assert.match(panel, /row\.device_employee_no/)
  assert.match(panel, /row\.event_timestamp/)
  assert.match(workers, /buildBiometricCoverageByWorker/)
  assert.doesNotMatch(workers, /if \(mappings\.length > 1\).*conflict/)
})
