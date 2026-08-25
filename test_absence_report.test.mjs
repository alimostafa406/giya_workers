import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { absenceWeekDates, buildAbsenceReport, hasValidMorningBiometricPunch } from './src/utils/absenceReport.js'

const workers = [
  { id: 'w1', full_name: 'NIVA', employee_code: '211', team_id: 'a', team_name: 'Cleaner', team: { id: 'a', name: 'Cleaner' }, is_active: true, staff_classification: 'normal' },
  { id: 'w2', full_name: 'JOHN', employee_code: '212', team_id: 'a', team_name: 'Cleaner', team: { id: 'a', name: 'Cleaner' }, is_active: true, staff_classification: 'normal' },
  { id: 'w3', full_name: 'DAVID', employee_code: '301', team_id: 'b', team_name: 'Administration', team: { id: 'b', name: 'Administration' }, is_active: true, staff_classification: 'normal' },
  { id: 'special', full_name: 'SPECIAL', team_id: 'b', team_name: 'Administration', is_active: true, staff_classification: 'special_staff' },
]

test('valid biometric morning punch is detected only inside the Hikvision 07:00-09:00 window', () => {
  assert.equal(hasValidMorningBiometricPunch({ attendance_source: 'biometric', check_in: '07:45:00' }), true)
  assert.equal(hasValidMorningBiometricPunch({ attendance_source: 'biometric', check_in: '09:00:00' }), true)
  assert.equal(hasValidMorningBiometricPunch({ attendance_source: 'biometric', check_in: '17:12:00' }), false)
  assert.equal(hasValidMorningBiometricPunch({ attendance_source: 'manual', check_in: '08:00:00' }), false)
  assert.equal(hasValidMorningBiometricPunch({ attendance_source: 'manual', biometric_sync_metadata: { check_in_event_timestamp: '2026-08-25T07:30:00+01:00' } }), true)
})

test('today includes evening-only and no-event workers but excludes a worker with morning biometrics', () => {
  const report = buildAbsenceReport({
    workers,
    businessDate: '2026-08-25',
    mode: 'today',
    attendance: [
      { id: 'morning', worker_id: 'w1', attendance_date: '2026-08-25', status: 'half_day', attendance_source: 'biometric', check_in: '07:45:00' },
      { id: 'evening-only', worker_id: 'w2', attendance_date: '2026-08-25', status: 'absent', attendance_source: 'biometric', check_in: null, biometric_sync_metadata: { checkout_only: true, evening_punch_time: '17:12:00' } },
    ],
  })
  assert.equal(report.missingMorningWorkers, 2)
  assert.deepEqual(report.groups.flatMap((group) => group.workers.map((worker) => worker.id)).sort(), ['w2', 'w3'])
})

test('final attendance status is not the report condition', () => {
  const report = buildAbsenceReport({
    workers: workers.slice(0, 2),
    businessDate: '2026-08-25',
    mode: 'today',
    attendance: [
      { id: 'status-absent-but-observed', worker_id: 'w1', attendance_date: '2026-08-25', status: 'absent', attendance_source: 'biometric', check_in: '08:15:00' },
      { id: 'status-present-without-biometric', worker_id: 'w2', attendance_date: '2026-08-25', status: 'present', attendance_source: 'manual', check_in: '08:00:00', check_out: '17:00:00' },
    ],
  })
  assert.deepEqual(report.groups[0].workers.map((worker) => worker.id), ['w2'])
})

test('week report is Monday-Saturday, records missing mornings, and keeps future days neutral', () => {
  assert.deepEqual(absenceWeekDates('2026-08-25'), ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29'])
  const report = buildAbsenceReport({
    workers: [workers[0]],
    businessDate: '2026-08-25',
    mode: 'week',
    attendance: [
      { id: 'mon', worker_id: 'w1', attendance_date: '2026-08-24', attendance_source: 'biometric', check_in: '07:40:00', status: 'present' },
      { id: 'tue-evening', worker_id: 'w1', attendance_date: '2026-08-25', attendance_source: 'biometric', check_in: null, status: 'absent', biometric_sync_metadata: { checkout_only: true, evening_punch_time: '17:20:00' } },
    ],
  })
  const worker = report.groups[0].workers[0]
  assert.deepEqual(worker.states.map((day) => day.state), ['morning_recorded', 'morning_missing', 'future', 'future', 'future', 'future'])
  assert.equal(worker.missingMorningDays, 1)
  assert.equal(report.missingMorningDays, 1)
})

test('worker identity is deduplicated and optional team filter preserves grouping', () => {
  const report = buildAbsenceReport({ workers: [...workers, { ...workers[0] }], businessDate: '2026-08-25', mode: 'today', teamId: 'a', attendance: [] })
  assert.equal(report.groups.length, 1)
  assert.equal(report.groups[0].id, 'a')
  assert.deepEqual(report.groups[0].workers.map((worker) => worker.id).sort(), ['w1', 'w2'])
})

test('report is read-only, routed from Attendance, and labels morning punch state', () => {
  const page = readFileSync('./src/pages/AbsenceReport.jsx', 'utf8')
  const attendancePage = readFileSync('./src/pages/Attendance.jsx', 'utf8')
  const router = readFileSync('./src/routes/AppRouter.jsx', 'utf8')
  const api = readFileSync('./src/api/attendanceApi.js', 'utf8')
  assert.match(attendancePage, /to="\/attendance\/absence-report"/)
  assert.match(router, /path="\/attendance\/absence-report" element=\{<AbsenceReport \/>\}/)
  assert.match(page, /morning_recorded/)
  assert.match(page, /morning_missing/)
  assert.doesNotMatch(page, /saveAttendance|updateAttendance|insert|upsert|delete/)
  assert.match(api, /params\.date_from[\s\S]*\.gte\('attendance_date', params\.date_from\)/)
  assert.match(api, /params\.date_to[\s\S]*\.lte\('attendance_date', params\.date_to\)/)
})

test('print CSS still flows teams and supports portrait today and landscape week', () => {
  const page = readFileSync('./src/pages/AbsenceReport.jsx', 'utf8')
  const css = readFileSync('./src/index.css', 'utf8')
  assert.match(page, /size: A4 \$\{mode === 'week' \? 'landscape' : 'portrait'\}/)
  assert.match(css, /\.absence-team-block--small\s*\{\s*break-inside: avoid;/)
  assert.match(css, /\.absence-week-table thead\s*\{\s*display: table-header-group;/)
  assert.doesNotMatch(css, /page-break-before:\s*always|break-before:\s*page/)
})
