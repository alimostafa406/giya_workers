import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { attendanceRosterCategory, mergeAttendanceRoster, summarizeAttendanceRoster } from './src/utils/attendanceRoster.js'

const workers = Array.from({ length: 20 }, (_, index) => ({
  id: `worker-${index + 1}`,
  full_name: `Worker ${String(index + 1).padStart(2, '0')}`,
  team_id: index < 20 ? 'team-a' : 'team-b',
  team: { id: 'team-a', name: 'Cleaner' },
  is_active: true,
  staff_classification: 'normal',
}))

const attendance = Array.from({ length: 15 }, (_, index) => ({
  id: `attendance-${index + 1}`,
  worker_id: `worker-${index + 1}`,
  attendance_date: '2026-08-24',
  status: index === 0 ? 'half_day' : 'present',
  check_in: '08:00:00',
  check_out: index === 0 ? null : '17:00:00',
}))

test('selected team roster displays all active workers and exactly the missing five', () => {
  const rows = mergeAttendanceRoster({ workers, attendance, date: '2026-08-24', teamId: 'team-a', businessDate: '2026-08-24' })
  assert.equal(rows.length, 20)
  assert.equal(new Set(rows.map((row) => row.worker_id)).size, 20)
  assert.equal(rows.filter((row) => attendanceRosterCategory(row) === 'not_recorded').length, 5)
  assert.equal(rows.find((row) => row.worker_id === 'worker-1').status, 'half_day')
  assert.equal(rows.find((row) => row.worker_id === 'worker-1').check_in, '08:00:00')
  assert.deepEqual(summarizeAttendanceRoster(rows), { total: 20, present: 15, not_recorded: 5, absent: 0, review: 0, not_applicable: 0 })
})

test('duplicate attendance input still renders one worker exactly once', () => {
  const rows = mergeAttendanceRoster({
    workers: workers.slice(0, 1),
    attendance: [attendance[0], { ...attendance[0], id: 'newer', updated_at: '2026-08-24T10:00:00Z', status: 'present' }],
    date: '2026-08-24', teamId: 'team-a', businessDate: '2026-08-24',
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'present')
})

test('future rows stay neutral while missing completed workdays derive confirmed absence', () => {
  const future = mergeAttendanceRoster({ workers: workers.slice(0, 1), attendance: [], date: '2026-08-25', teamId: 'team-a', businessDate: '2026-08-24' })
  assert.equal(attendanceRosterCategory(future[0]), 'not_applicable')
  const missingPast = mergeAttendanceRoster({ workers: workers.slice(0, 1), attendance: [], date: '2026-08-22', teamId: 'team-a', businessDate: '2026-08-24' })
  assert.equal(attendanceRosterCategory(missingPast[0]), 'absent')
  const finalizedPast = mergeAttendanceRoster({ workers: workers.slice(0, 1), attendance: [{ ...attendance[0], attendance_date: '2026-08-23', status: 'absent' }], date: '2026-08-23', teamId: 'team-a', businessDate: '2026-08-24' })
  assert.equal(attendanceRosterCategory(finalizedPast[0]), 'absent')
})

test('today biometric absence is neutral but an explicit manual absence remains confirmed', () => {
  const biometric = mergeAttendanceRoster({
    workers: workers.slice(0, 1),
    attendance: [{ ...attendance[0], status: 'absent', check_in: null, check_out: null, attendance_source: 'biometric', manual_override: false }],
    date: '2026-08-24', businessDate: '2026-08-24',
  })
  assert.equal(attendanceRosterCategory(biometric[0]), 'not_recorded')

  const manual = mergeAttendanceRoster({
    workers: workers.slice(0, 1),
    attendance: [{ ...attendance[0], status: 'absent', check_in: null, check_out: null, attendance_source: 'manual', manual_override: true }],
    date: '2026-08-24', businessDate: '2026-08-24',
  })
  assert.equal(attendanceRosterCategory(manual[0]), 'absent')
})

test('today checked-in worker without checkout is present/reviewable, never absent', () => {
  const rows = mergeAttendanceRoster({
    workers: workers.slice(0, 1),
    attendance: [{ ...attendance[0], status: 'half_day', check_in: '08:00:00', check_out: null, attendance_source: 'biometric', manual_override: false }],
    date: '2026-08-24', businessDate: '2026-08-24',
  })
  assert.equal(attendanceRosterCategory(rows[0]), 'present')
  assert.notEqual(attendanceRosterCategory(rows[0]), 'absent')
})

test('Dashboard counts confirmed absence through the shared roster category', () => {
  const dashboard = readFileSync('./src/pages/Dashboard.jsx', 'utf8')
  assert.match(dashboard, /attendanceRosterCategory\(item\) === 'absent'/)
  assert.match(dashboard, /attendanceRosterCategory\(item\) === 'not_recorded'/)
  assert.match(dashboard, /row\.roster_state === 'not_recorded' \? t\('attendance\.notRecorded'\)/)
  assert.doesNotMatch(dashboard, /isAbsentStatus/)
})

test('Agent keeps current no-punch plans pending and preserves safe biometric merging', () => {
  const sync = readFileSync('./hikvision_attendance_sync.py', 'utf8')
  const proposed = sync.slice(sync.indexOf('def proposed_status'), sync.indexOf('def plan_attendance'))
  assert.match(proposed, /if not day_has_finalized[\s\S]*return 'pending', None[\s\S]*return 'absent', 0\.0/)
  assert.doesNotMatch(proposed, /if check_out:\s*return 'absent'/)
  assert.match(sync, /row\.get\('attendance_source'\) != 'biometric'[\s\S]*row\.get\('manual_override'\) is True/)
  assert.match(sync, /check_in = earlier_time\(existing\.get\('check_in'\), check_in\)/)
  assert.match(sync, /check_out = later_time\(existing\.get\('check_out'\), check_out\)/)
  assert.match(sync, /existing_status == 'present'[\s\S]*status = 'present'/)
})

test('team switching uses only the selected active normal roster', () => {
  const mixedWorkers = [...workers.slice(0, 2), { ...workers[2], id: 'other', team_id: 'team-b', team: { id: 'team-b', name: 'Security' } }, { ...workers[3], id: 'inactive', is_active: false }]
  assert.deepEqual(mergeAttendanceRoster({ workers: mixedWorkers, attendance: [], date: '2026-08-24', teamId: 'team-b', businessDate: '2026-08-24' }).map((row) => row.worker_id), ['other'])
})

test('virtual roster display performs no write and manual edits reuse the existing safe correction API', () => {
  const rosterSource = readFileSync('./src/utils/attendanceRoster.js', 'utf8')
  const pageSource = readFileSync('./src/pages/Attendance.jsx', 'utf8')
  assert.doesNotMatch(rosterSource, /from\(['"]attendance['"]\)|insert\(|upsert\(|update\(/)
  assert.match(pageSource, /saveAttendanceManuallyRequest/)
  assert.match(pageSource, /row: editingRow\.is_virtual \? null : editingRow/)
})
