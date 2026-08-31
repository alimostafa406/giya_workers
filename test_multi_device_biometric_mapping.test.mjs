import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildRecentIdentityUsers, recentUnmappedIdentityUsers } from './src/utils/recentUnmappedIdentities.js'
import { getHikvisionDeviceUsers, replaceHikvisionDeviceUsers } from './src/data/hikvisionRawData.js'

const NIVA_ID = 'a42d772e-6174-40a4-8d31-01247e2513ac'

test('NIVA can resolve from two scoped identities without creating another worker', () => {
  const mappings = [
    { id: 'map-39', worker_id: NIVA_ID, device_id: 'office-main', device_employee_no: '39', is_active: true, mapping_review_state: 'confirmed' },
    { id: 'map-55550037', worker_id: NIVA_ID, device_id: 'office-secondary', device_employee_no: '55550037', is_active: true, mapping_review_state: 'confirmed' },
  ]
  const users = buildRecentIdentityUsers({
    activityIdentities: [
      { deviceId: 'office-main', employeeNo: '39', recent_event_count: 1 },
      { deviceId: 'office-secondary', employeeNo: '55550037', recent_event_count: 1 },
    ],
    inventoryUsers: [], mappings,
    workers: [{ id: NIVA_ID, full_name: 'NIVA', employee_code: '211', is_active: true }],
    ignoredEmployeeNos: [],
  })

  assert.deepEqual(users.map((user) => user.mapping.worker_id), [NIVA_ID, NIVA_ID])
  assert.deepEqual(recentUnmappedIdentityUsers(users), [])
  assert.equal(mappings[0].device_employee_no, '39')
  assert.equal(new Set(users.map((user) => user.mapping.worker_id)).size, 1)
})

test('same employee number on different devices resolves by composite identity', () => {
  const users = buildRecentIdentityUsers({
    activityIdentities: [
      { deviceId: 'office-main', employeeNo: '77', recent_event_count: 1 },
      { deviceId: 'office-secondary', employeeNo: '77', recent_event_count: 1 },
    ],
    inventoryUsers: [],
    mappings: [
      { worker_id: 'worker-main', device_id: 'office-main', device_employee_no: '77', is_active: true },
      { worker_id: 'worker-secondary', device_id: 'office-secondary', device_employee_no: '77', is_active: true },
    ],
    workers: [{ id: 'worker-main' }, { id: 'worker-secondary' }], ignoredEmployeeNos: [],
  })

  assert.deepEqual(users.map((user) => user.mapping.worker_id), ['worker-main', 'worker-secondary'])
  assert.notEqual(users[0].identityKey, users[1].identityKey)
})

test('device-scoped ignore does not suppress the same number on another device', () => {
  const users = buildRecentIdentityUsers({
    activityIdentities: [
      { deviceId: 'office-main', employeeNo: '88', recent_event_count: 1 },
      { deviceId: 'office-secondary', employeeNo: '88', recent_event_count: 1 },
    ],
    inventoryUsers: [], mappings: [], workers: [],
    ignoredIdentities: [{ device_id: 'office-main', device_employee_no: '88' }],
  })

  assert.deepEqual(recentUnmappedIdentityUsers(users).map((user) => user.identityKey), ['office-secondary::88'])
})

test('device inventory does not collapse the same employee number across devices', () => {
  replaceHikvisionDeviceUsers([{
    employeeNo: '77', name: 'Device User', devices: ['office-main', 'office-secondary'],
    device_presence: { 'office-main': true, 'office-secondary': true },
  }])

  const identities = getHikvisionDeviceUsers()
  assert.deepEqual(identities.map((identity) => identity.identityKey).sort(), [
    'office-main::77', 'office-secondary::77',
  ])
})

test('migration permits many identities per worker but one active worker per scoped identity', async () => {
  const sql = await readFile(new URL('./supabase/sql/biometric_mapping_device_scope.sql', import.meta.url), 'utf8')
  const api = await readFile(new URL('./src/api/biometricMappingApi.js', import.meta.url), 'utf8')
  const page = await readFile(new URL('./src/pages/BiometricMapping.jsx', import.meta.url), 'utf8')

  assert.match(sql, /drop index if exists public\.biometric_worker_mapping_one_active_worker/)
  assert.match(sql, /\(device_id, device_employee_no\)[\s\S]*where is_active and device_id is not null/)
  assert.match(sql, /\(device_employee_no\)[\s\S]*where is_active and device_id is null/)
  assert.doesNotMatch(sql, /unique[^\n]*\(worker_id\)/i)
  assert.match(api, /device_id: deviceId/)
  assert.doesNotMatch(api, /workerWouldBeReplaced/)
  assert.doesNotMatch(page, /activeMappedWorkerIds/)
  assert.match(page, /selectedWorkerMappings/)
  assert.match(page, /saveBiometricMappingRequest\(\{ deviceUser, workerId, reviewState: 'confirmed' \}\)/)
})

test('agent resolver uses exact device identity before legacy fallback', async () => {
  const source = await readFile(new URL('./hikvision_attendance_sync.py', import.meta.url), 'utf8')

  assert.match(source, /confirmed\.get\(\(device_id, employee_no\)\)/)
  assert.match(source, /confirmed\.get\(\(None, employee_no\)\)/)
  assert.match(source, /events_by_worker\[str\(worker\['id'\]\)\]\.append\(event\)/)
  assert.match(source, /sync_key': f'hikvision:\{worker_id\}:\{target_date\.isoformat\(\)\}'/)
})
