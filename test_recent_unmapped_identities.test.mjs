import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildRecentIdentityUsers, recentUnmappedIdentityUsers } from './src/utils/recentUnmappedIdentities.js'
import { mergeAttendanceRoster } from './src/utils/attendanceRoster.js'

test('only identities backed by recent real events enter operational review', () => {
  const users = buildRecentIdentityUsers({
    activityIdentities: [{
      employeeNo: '211', name: 'NIVA', recent_event_count: 2,
      latest_event_at: '2026-08-26T17:12:00+01:00', devices_seen: ['office-main'],
    }],
    inventoryUsers: [
      { employeeNo: '211', name: 'NIVA INVENTORY' },
      { employeeNo: '999', name: 'INVENTORY ONLY' },
    ],
    mappings: [],
    ignoredEmployeeNos: [],
  })
  const review = recentUnmappedIdentityUsers(users)

  assert.deepEqual(review.map((user) => user.employeeNo), ['211'])
  assert.equal(review[0].recentEventCount, 2)
  assert.equal(review[0].latestRecentEventAt, '2026-08-26T17:12:00+01:00')
  assert.deepEqual(review[0].devices, ['office-main'])
})

test('active mappings to active workers leave the unmapped list regardless of review state', () => {
  const activityIdentities = [
    { employeeNo: '100', deviceId: 'office-main', recent_event_count: 1 },
    { employeeNo: '200', deviceId: 'office-main', recent_event_count: 1 },
    { employeeNo: '300', deviceId: 'office-main', recent_event_count: 1 },
    { employeeNo: '39', deviceId: 'office-main', recent_event_count: 2 },
    { employeeNo: '400', deviceId: 'office-secondary', recent_event_count: 1 },
    { employeeNo: '500', deviceId: 'office-secondary', recent_event_count: 1 },
  ]
  const mappings = [
    { id: 'confirmed-map', worker_id: 'confirmed-worker', device_id: 'office-main', device_employee_no: '100', is_active: true, mapping_review_state: 'confirmed' },
    { id: 'inactive-map', worker_id: 'inactive-map-worker', device_id: 'office-main', device_employee_no: '300', is_active: false, mapping_review_state: 'confirmed' },
    { id: 'niva-map', worker_id: 'niva-worker', device_employee_no: '39', is_active: true, mapping_review_state: 'needs_review' },
    { id: 'inactive-worker-map', worker_id: 'inactive-worker', device_id: 'office-secondary', device_employee_no: '400', is_active: true, mapping_review_state: 'needs_review' },
    { id: 'missing-worker-map', worker_id: 'missing-worker', device_id: 'office-secondary', device_employee_no: '500', is_active: true, mapping_review_state: 'needs_review' },
  ]
  const users = buildRecentIdentityUsers({
    activityIdentities,
    inventoryUsers: [],
    mappings,
    workers: [
      { id: 'confirmed-worker', is_active: true },
      { id: 'inactive-map-worker', is_active: true },
      { id: 'niva-worker', full_name: 'NIVA', employee_code: '211', is_active: true },
      { id: 'inactive-worker', is_active: false },
    ],
    ignoredEmployeeNos: ['200'],
  })

  const review = recentUnmappedIdentityUsers(users)
  assert.deepEqual(review.map((user) => user.employeeNo), ['300'])
  assert.equal(review.some((user) => user.employeeNo === '39'), false)
  assert.equal(review.some((user) => user.employeeNo === '400'), false)
  assert.equal(review.some((user) => user.employeeNo === '500'), false)
  assert.deepEqual(mappings.find((mapping) => mapping.id === 'niva-map'), {
    id: 'niva-map', worker_id: 'niva-worker', device_employee_no: '39',
    is_active: true, mapping_review_state: 'needs_review',
  })
})

test('no mapping remains genuinely unmapped and can enter recent review', () => {
  const users = buildRecentIdentityUsers({
    activityIdentities: [{ employeeNo: 'genuine-unmapped', deviceId: 'office-main', recent_event_count: 1 }],
    inventoryUsers: [], mappings: [], workers: [], ignoredEmployeeNos: [],
  })

  assert.deepEqual(recentUnmappedIdentityUsers(users).map((user) => user.employeeNo), ['genuine-unmapped'])
})

test('mapping review is separate from dashboard and attendance roster totals', async () => {
  const mappingPage = await readFile(new URL('./src/pages/BiometricMapping.jsx', import.meta.url), 'utf8')
  const dashboard = await readFile(new URL('./src/pages/Dashboard.jsx', import.meta.url), 'utf8')
  const attendance = await readFile(new URL('./src/pages/Attendance.jsx', import.meta.url), 'utf8')

  assert.match(mappingPage, /getRecentUnmappedBiometricIdentitiesRequest\(\{ days: 7 \}\)/)
  assert.match(mappingPage, /recentUnmappedUsers\.length/)
  assert.match(mappingPage, /recentEventCount/)
  assert.match(mappingPage, /latestRecentEventAt/)
  assert.match(dashboard, /mergeAttendanceRoster\(\{/)
  assert.match(dashboard, /recentUnmappedCount/)
  assert.doesNotMatch(dashboard, /deviceUsers/)
  assert.doesNotMatch(attendance, /recentUnmapped|deviceUsers/)
})

test('normal active worker roster totals cannot be changed by recent device identities', () => {
  const roster = mergeAttendanceRoster({
    workers: [
      { id: 'normal', is_active: true, staff_classification: 'normal' },
      { id: 'special', is_active: true, staff_classification: 'special_staff' },
      { id: 'inactive', is_active: false, staff_classification: 'normal' },
    ],
    attendance: [{ worker_id: 'normal', attendance_date: '2026-08-27', status: 'present' }],
    date: '2026-08-27',
    businessDate: '2026-08-27',
  })
  const recentUnmapped = recentUnmappedIdentityUsers(buildRecentIdentityUsers({
    activityIdentities: [{ deviceId: 'office-main', employeeNo: 'device-only', recent_event_count: 5 }],
  }))

  assert.equal(roster.length, 1)
  assert.equal(roster.filter((row) => row.status === 'present').length, 1)
  assert.equal(roster.filter((row) => row.status === 'half_day').length, 0)
  assert.equal(roster.filter((row) => row.status === 'absent').length, 0)
  assert.equal(roster.filter((row) => row.roster_state === 'not_recorded').length, 0)
  assert.equal(recentUnmapped.length, 1)
})

test('persisted-event RPC enforces D-6 through D, deduplication, and newest-first ordering', async () => {
  const sql = await readFile(new URL('./supabase/sql/recent_unmapped_biometric_activity.sql', import.meta.url), 'utf8')
  const sync = await readFile(new URL('./hikvision_attendance_sync.py', import.meta.url), 'utf8')

  assert.match(sql, /attendance_date between \(p_end_date - \(p_days - 1\)\) and p_end_date/)
  assert.match(sql, /group by e\.device_id, e\.device_employee_no/)
  assert.match(sql, /order by max\(e\.event_timestamp\) desc/)
  const unmappedExclusion = sql.match(/and not exists \(\s*select 1\s*from public\.biometric_worker_mapping as m[\s\S]*?\n    \)/)?.[0] || ''
  assert.match(unmappedExclusion, /m\.is_active is true/)
  assert.match(unmappedExclusion, /m\.device_id = e\.device_id or m\.device_id is null/)
  assert.doesNotMatch(unmappedExclusion, /join public\.workers/)
  assert.doesNotMatch(unmappedExclusion, /mapping_review_state/)
  assert.match(sync, /'device_employee_no': employee_no/)
  assert.match(sync, /'worker_id': worker_id/)
})

test('create-worker RPC still rejects an already active device mapping', async () => {
  const sql = await readFile(new URL('./supabase/sql/create_worker_and_confirm_biometric_mapping.sql', import.meta.url), 'utf8')

  assert.match(sql, /if v_existing_mapping_id is not null and v_existing_mapping_active then/)
  assert.match(sql, /This device identity is already actively mapped\./)
})

test('frontend never offers mapping or Add-as-new actions for a loaded active mapping', async () => {
  const source = await readFile(new URL('./src/pages/BiometricMapping.jsx', import.meta.url), 'utf8')

  assert.match(source, /const recentUnmappedUsers = useMemo\(\(\) => \(data/)
  assert.match(source, /: \[\]\), \[data, optimisticallyMappedEmployeeNos, recentActivityUsers\]\)/)
  assert.match(source, /if \(!selectedDevice \|\| selectedDevice\.hasActiveMapping \|\| !selectedWorker\?\.id \|\| linkingWorker\) return/)
  assert.match(source, /if \(selectedDevice\.hasActiveMapping\)/)
  assert.match(source, /selectedDevice && !selectedDevice\.hasActiveMapping/)
  assert.match(source, /disabled=\{!selectedDevice \|\| selectedDevice\.hasActiveMapping \|\| !selectedWorker\?\.id \|\| linkingWorker\}/)
})

test('confirmed mapping reuses the guarded attendance apply workflow', async () => {
  const source = await readFile(new URL('./src/pages/BiometricMapping.jsx', import.meta.url), 'utf8')

  assert.match(source, /\/attendance\/apply/)
  assert.match(source, /confirm: true/)
  assert.match(source, /saveBiometricMappingRequest\(\{ deviceUser, workerId, reviewState: 'confirmed' \}\)/)
  assert.match(source, /Promise\.all\(\[\s*refreshTodayAttendanceAfterMapping\(\),\s*load\(\),\s*loadRecentActivity\(\),\s*\]\)/)
})
