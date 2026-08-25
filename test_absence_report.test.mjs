import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { absenceWeekDates, buildAbsenceReport } from './src/utils/absenceReport.js'

const workers = [
  { id: 'w1', full_name: 'NIVA', employee_code: '211', team_id: 'a', team_name: 'Cleaner', team: { id: 'a', name: 'Cleaner' }, is_active: true, staff_classification: 'normal' },
  { id: 'w2', full_name: 'JOHN', employee_code: '212', team_id: 'a', team_name: 'Cleaner', team: { id: 'a', name: 'Cleaner' }, is_active: true, staff_classification: 'normal' },
  { id: 'w3', full_name: 'DAVID', employee_code: '301', team_id: 'b', team_name: 'Administration', team: { id: 'b', name: 'Administration' }, is_active: true, staff_classification: 'normal' },
  { id: 'w4', full_name: 'PETER', employee_code: '302', team_id: 'b', team_name: 'Administration', team: { id: 'b', name: 'Administration' }, is_active: true, staff_classification: 'normal' },
  { id: 'special', full_name: 'SPECIAL', team_id: 'b', team_name: 'Administration', is_active: true, staff_classification: 'special_staff' },
]

test('today report contains confirmed absence only, excluding not-recorded and review states', () => {
  const report = buildAbsenceReport({
    workers,
    businessDate: '2026-08-26',
    mode: 'today',
    attendance: [
      { id: 'a1', worker_id: 'w1', attendance_date: '2026-08-26', status: 'absent' },
      { id: 'a2', worker_id: 'w3', attendance_date: '2026-08-26', status: 'absent', biometric_sync_metadata: { checkout_only: true } },
      { id: 'a3', worker_id: 'w4', attendance_date: '2026-08-26', status: 'present' },
      { id: 'a4', worker_id: 'special', attendance_date: '2026-08-26', status: 'absent' },
    ],
  })
  assert.equal(report.absentWorkers, 1)
  assert.equal(report.groups.length, 1)
  assert.equal(report.groups[0].name, 'Cleaner')
  assert.deepEqual(report.groups[0].workers.map((worker) => worker.id), ['w1'])
})

test('weekly report uses Monday-Saturday, counts confirmed days, and ignores future absence rows', () => {
  assert.deepEqual(absenceWeekDates('2026-08-26'), ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29'])
  const report = buildAbsenceReport({
    workers,
    businessDate: '2026-08-26',
    mode: 'week',
    attendance: [
      { id: 'w1-mon', worker_id: 'w1', attendance_date: '2026-08-24', status: 'absent', updated_at: '2026-08-24T18:00:00Z' },
      { id: 'w1-tue', worker_id: 'w1', attendance_date: '2026-08-25', status: 'present' },
      { id: 'w2-old', worker_id: 'w2', attendance_date: '2026-08-25', status: 'present', updated_at: '2026-08-25T10:00:00Z' },
      { id: 'w2-new', worker_id: 'w2', attendance_date: '2026-08-25', status: 'absent', updated_at: '2026-08-25T18:00:00Z' },
      { id: 'w3-mon', worker_id: 'w3', attendance_date: '2026-08-24', status: 'absent' },
      { id: 'future', worker_id: 'w3', attendance_date: '2026-08-27', status: 'absent' },
    ],
  })
  assert.equal(report.groups.length, 2)
  assert.equal(report.absentWorkers, 3)
  assert.equal(report.absenceDays, 3)
  assert.equal(report.groups.find((group) => group.id === 'a').workers.length, 2)
  assert.equal(report.groups.find((group) => group.id === 'b').workers.length, 1)
  assert.equal(report.groups.find((group) => group.id === 'b').workers[0].states[3].state, 'future')
  assert.equal(report.groups.find((group) => group.id === 'b').workers[0].absenceDays, 1)
})

test('worker identity is deduplicated and optional team filter keeps the correct group', () => {
  const report = buildAbsenceReport({
    workers: [...workers, { ...workers[0] }],
    businessDate: '2026-08-26',
    mode: 'today',
    teamId: 'a',
    attendance: [
      { id: 'first', worker_id: 'w1', attendance_date: '2026-08-26', status: 'absent', updated_at: '2026-08-26T10:00:00Z' },
      { id: 'latest', worker_id: 'w1', attendance_date: '2026-08-26', status: 'absent', updated_at: '2026-08-26T11:00:00Z' },
      { id: 'other-team', worker_id: 'w3', attendance_date: '2026-08-26', status: 'absent' },
    ],
  })
  assert.equal(report.groups.length, 1)
  assert.equal(report.groups[0].id, 'a')
  assert.deepEqual(report.groups[0].workers.map((worker) => worker.id), ['w1'])
})

test('absence report is read-only and routed from Attendance', () => {
  const page = readFileSync('./src/pages/AbsenceReport.jsx', 'utf8')
  const attendancePage = readFileSync('./src/pages/Attendance.jsx', 'utf8')
  const router = readFileSync('./src/routes/AppRouter.jsx', 'utf8')
  const api = readFileSync('./src/api/attendanceApi.js', 'utf8')
  assert.match(attendancePage, /to="\/attendance\/absence-report"/)
  assert.match(router, /path="\/attendance\/absence-report" element=\{<AbsenceReport \/>\}/)
  assert.match(page, /getAttendanceRequest\(attendanceParams\)/)
  assert.doesNotMatch(page, /saveAttendance|updateAttendance|insert|upsert|delete/)
  assert.match(api, /params\.date_from[\s\S]*\.gte\('attendance_date', params\.date_from\)/)
  assert.match(api, /params\.date_to[\s\S]*\.lte\('attendance_date', params\.date_to\)/)
})

test('print CSS flows teams naturally and supports portrait today and landscape week', () => {
  const page = readFileSync('./src/pages/AbsenceReport.jsx', 'utf8')
  const css = readFileSync('./src/index.css', 'utf8')
  assert.match(page, /size: A4 \$\{mode === 'week' \? 'landscape' : 'portrait'\}/)
  assert.match(css, /\.absence-team-block--small\s*\{\s*break-inside: avoid;/)
  assert.match(css, /\.absence-week-table thead\s*\{\s*display: table-header-group;/)
  assert.match(css, /\.absence-report-screen-only\s*\{\s*display: none !important;/)
  assert.match(css, /body \*\s*\{\s*visibility: hidden;/)
  assert.doesNotMatch(css, /page-break-before:\s*always|break-before:\s*page/)
})
