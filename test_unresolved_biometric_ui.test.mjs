import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { splitUnresolvedBiometricAttendance } from './src/utils/unresolvedBiometricAttendance.js'

const rows = [
  { event_id: 'matondo', resolution_reason: 'unmapped', device_employee_no: '043' },
  { event_id: 'review', resolution_reason: 'needs_review', device_employee_no: '39' },
  { event_id: 'conflict', resolution_reason: 'ambiguous', device_employee_no: '77' },
  { event_id: 'active-miss', resolution_reason: 'attendance_not_applied', worker_is_active: true },
  { event_id: 'chadrack', resolution_reason: 'inactive_worker', device_employee_no: '15' },
  { event_id: 'jones', resolution_reason: 'inactive_worker', device_employee_no: '32' },
  { event_id: 'benoit', resolution_reason: 'inactive_worker', device_employee_no: '53' },
  { event_id: 'pierre', resolution_reason: 'inactive_worker', device_employee_no: '141' },
]

test('Dashboard urgent results exclude inactive-worker events without deleting audit rows', () => {
  const result = splitUnresolvedBiometricAttendance(rows)
  assert.deepEqual(result.urgent.map((row) => row.event_id), ['matondo', 'review', 'conflict', 'active-miss'])
  assert.deepEqual(result.inactiveWorkerEvents.map((row) => row.event_id), ['chadrack', 'jones', 'benoit', 'pierre'])
  assert.equal(result.urgent.length + result.inactiveWorkerEvents.length, rows.length)
})

test('Dashboard and inactive-worker page use separate views of the same read-only RPC data', async () => {
  const dashboard = await readFile(new URL('./src/pages/Dashboard.jsx', import.meta.url), 'utf8')
  const mapping = await readFile(new URL('./src/pages/BiometricMapping.jsx', import.meta.url), 'utf8')
  const inactivePage = await readFile(new URL('./src/pages/InactiveWorkers.jsx', import.meta.url), 'utf8')

  assert.match(dashboard, /splitUnresolvedBiometricAttendance\(unresolvedBiometric\)\.urgent/)
  assert.match(dashboard, /rows=\{urgentBiometric\}/)
  assert.doesNotMatch(mapping, /getUnresolvedBiometricAttendanceRequest|InactiveWorkerBiometricEventsPanel/)
  assert.match(inactivePage, /getInactiveWorkerBiometricActivityRequest\(\)/)
  assert.match(inactivePage, /latestBiometricEvent\?\.event_timestamp/)
  assert.match(inactivePage, /event\.device_employee_no/)
})

test('UI refinement contains no mapping, worker activation, team, or attendance writes', async () => {
  const utility = await readFile(new URL('./src/utils/unresolvedBiometricAttendance.js', import.meta.url), 'utf8')
  const page = await readFile(new URL('./src/pages/InactiveWorkers.jsx', import.meta.url), 'utf8')
  const combined = `${utility}\n${page}`

  assert.doesNotMatch(combined, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/)
  assert.doesNotMatch(combined, /employee_code\s*===|full_name\s*===|team_id|is_active\s*:/)
})
