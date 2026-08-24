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

test('future and missing historical roster rows stay neutral while real historical status wins', () => {
  const future = mergeAttendanceRoster({ workers: workers.slice(0, 1), attendance: [], date: '2026-08-25', teamId: 'team-a', businessDate: '2026-08-24' })
  assert.equal(attendanceRosterCategory(future[0]), 'not_applicable')
  const missingPast = mergeAttendanceRoster({ workers: workers.slice(0, 1), attendance: [], date: '2026-08-23', teamId: 'team-a', businessDate: '2026-08-24' })
  assert.equal(attendanceRosterCategory(missingPast[0]), 'not_applicable')
  const finalizedPast = mergeAttendanceRoster({ workers: workers.slice(0, 1), attendance: [{ ...attendance[0], attendance_date: '2026-08-23', status: 'absent' }], date: '2026-08-23', teamId: 'team-a', businessDate: '2026-08-24' })
  assert.equal(attendanceRosterCategory(finalizedPast[0]), 'absent')
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
