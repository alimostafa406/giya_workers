import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildInactiveWorkerRows } from './src/utils/inactiveWorkers.js'

const workers = [
  { id: 'active', full_name: 'Active', is_active: true },
  { id: 'chadrack', full_name: 'CHADRACK', employee_code: '15', is_active: false },
  { id: 'jones', full_name: 'jones', employee_code: '32', is_active: false },
  { id: 'inactive-no-event', full_name: 'No event', is_active: false },
]
const mappings = [
  { id: 'm1', worker_id: 'chadrack', device_id: 'office-main', device_employee_no: '15', is_active: true },
  { id: 'm2', worker_id: 'jones', device_id: 'office-secondary', device_employee_no: '32', is_active: true },
]
const unresolvedEvents = [
  { event_id: 'e1', worker_id: 'chadrack', resolution_reason: 'inactive_worker', event_timestamp: '2026-08-31T05:55:39Z' },
  { event_id: 'e2', worker_id: 'jones', resolution_reason: 'inactive_worker', event_timestamp: '2026-08-31T05:55:53Z' },
  { event_id: 'urgent', worker_id: 'active', resolution_reason: 'attendance_not_applied', event_timestamp: '2026-08-31T06:00:00Z' },
]

test('inactive page lists every inactive worker, including workers without events', () => {
  const rows = buildInactiveWorkerRows({ workers, mappings, unresolvedEvents })
  assert.deepEqual(rows.map((row) => row.id), ['chadrack', 'jones', 'inactive-no-event'])
  assert.equal(rows.find((row) => row.id === 'inactive-no-event').biometricEventsToday.length, 0)
})

test('inactive activity is attached only through persisted worker ownership', () => {
  const rows = buildInactiveWorkerRows({ workers, mappings, unresolvedEvents })
  assert.equal(rows.find((row) => row.id === 'chadrack').biometricEventsToday[0].event_id, 'e1')
  assert.equal(rows.find((row) => row.id === 'jones').biometricMappings[0].device_employee_no, '32')
  assert.equal(rows.some((row) => row.biometricEventsToday.some((event) => event.event_id === 'urgent')), false)
})

test('standalone route and sidebar exist while mapping page no longer renders inactive audit events', async () => {
  const router = await readFile(new URL('./src/routes/AppRouter.jsx', import.meta.url), 'utf8')
  const sidebar = await readFile(new URL('./src/components/Sidebar/Sidebar.jsx', import.meta.url), 'utf8')
  const mapping = await readFile(new URL('./src/pages/BiometricMapping.jsx', import.meta.url), 'utf8')
  const page = await readFile(new URL('./src/pages/InactiveWorkers.jsx', import.meta.url), 'utf8')

  assert.match(router, /path="\/inactive-workers" element=\{<InactiveWorkers \/>\}/)
  assert.match(sidebar, /to: '\/inactive-workers'/)
  assert.doesNotMatch(mapping, /InactiveWorkerBiometricEventsPanel|getUnresolvedBiometricAttendanceRequest/)
  assert.match(page, /getWorkersRequest\(\)/)
  assert.match(page, /getBiometricMappingsRequest\(\)/)
  assert.match(page, /getInactiveWorkerBiometricActivityRequest\(\)/)
})

test('activity RPC is read-only and preserves exact-device-first confirmed mapping rules', async () => {
  const sql = await readFile(new URL('./supabase/sql/inactive_worker_biometric_activity.sql', import.meta.url), 'utf8')
  assert.match(sql, /m\.mapping_review_state = 'confirmed'/)
  assert.match(sql, /m\.device_id = e\.device_id or m\.device_id is null/)
  assert.match(sql, /case when m\.device_id = e\.device_id then 1 else 2 end/)
  assert.match(sql, /having count\(distinct c\.worker_id\) = 1/)
  assert.match(sql, /w\.is_active is false/)
  assert.doesNotMatch(sql, /\binsert\b|\bupdate\b|\bdelete\b/i)
})

test('inactive page has no worker, mapping, team, or attendance writes', async () => {
  const page = await readFile(new URL('./src/pages/InactiveWorkers.jsx', import.meta.url), 'utf8')
  const utility = await readFile(new URL('./src/utils/inactiveWorkers.js', import.meta.url), 'utf8')
  assert.doesNotMatch(`${page}\n${utility}`, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|saveBiometricMapping|updateWorker/)
})
