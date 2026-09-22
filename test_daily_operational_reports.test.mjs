import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildDailyAttendanceExceptions, buildDailyOvertimeReport, yesterdayFromBusinessDate } from './src/utils/dailyOperationalReports.js'

const worker = (id, active = true) => ({ id, full_name: `Worker ${id}`, employee_code: `C${id}`, is_active: active, staff_classification: 'normal' })
const row = (id, values = {}) => ({ id, worker: worker(id, values.active), worker_name: `Worker ${id}`, team_name: 'Team A', status: 'present', check_in: '08:00:00', check_out: '17:00:00', ...values })

test('daily exceptions exclude completed present rows despite informational late metadata', () => {
  const report = buildDailyAttendanceExceptions({ attendance: [
    row('on-time'),
    row('08-05', { check_in: '08:05:00', check_out: '17:08:00', biometric_sync_metadata: { late_arrival: true, lateness_minutes: 5 } }),
    row('08-10', { check_in: '08:10:00', check_out: '17:15:00', biometric_sync_metadata: { late_arrival: true, lateness_minutes: 10 } }),
    row('half', { status: 'half_day', check_in: '07:08:00', check_out: null }),
    row('absent', { status: 'absent', check_in: null, check_out: null }),
    row('late-status', { status: 'late', check_in: '09:30:00', check_out: '17:00:00' }),
    row('incomplete-present', { status: 'present', check_in: '07:08:00', check_out: null }),
    row('canonical-full-day', { status: 'present', check_in: '17:13:11', check_out: null, attendance_day_fraction: 1 }),
    row('administration', { status: 'absent', team: { name: 'Adminstration' } }),
    row('inactive', { status: 'absent', active: false }),
  ] })
  assert.deepEqual(report.map((item) => [item.worker, item.status]), [
    ['Worker absent', 'absent'],
    ['Worker half', 'half_day'],
    ['Worker incomplete-present', 'half_day'],
    ['Worker late-status', 'late'],
  ])
})

test('daily exceptions exclude canonical full-day present rows without checkout', () => {
  const benjamin = { ...worker('benjamin'), employee_code: '68' }
  const report = buildDailyAttendanceExceptions({
    workers: [benjamin],
    attendance: [row('benjamin', {
      worker: benjamin,
      status: 'present',
      check_in: '17:13:11',
      check_out: null,
      attendance_day_fraction: 1,
      attendance_date: '2026-09-21',
    })],
    date: '2026-09-21',
  })

  assert.deepEqual(report, [])
})

test('daily exceptions display later mapped biometric evidence without changing canonical checkout', () => {
  const augustine = worker('augustine')
  const attendance = [row('augustine', {
    worker: augustine,
    status: 'half_day',
    check_in: '09:08:30',
    check_out: null,
    attendance_date: '2026-09-21',
  })]
  const evidence = [
    { worker_id: 'augustine', attendance_date: '2026-09-21', event_timestamp: '2026-09-21T08:08:30Z' },
    { worker_id: 'augustine', attendance_date: '2026-09-21', event_timestamp: '2026-09-21T15:07:50Z' },
  ]
  const report = buildDailyAttendanceExceptions({ workers: [augustine], attendance, evidence, date: '2026-09-21' })

  assert.equal(report[0].status, 'half_day')
  assert.equal(report[0].checkOut, '—')
  assert.equal(report[0].lastPunch, '16:07:50')
})

test('daily exceptions do not duplicate a single check-in as last punch evidence', () => {
  const workerWithOnePunch = worker('one-punch')
  const report = buildDailyAttendanceExceptions({
    workers: [workerWithOnePunch],
    attendance: [row('one-punch', { worker: workerWithOnePunch, status: 'half_day', check_in: '09:08:30', check_out: null, attendance_date: '2026-09-21' })],
    evidence: [{ worker_id: 'one-punch', attendance_date: '2026-09-21', event_timestamp: '2026-09-21T08:08:30Z' }],
    date: '2026-09-21',
  })

  assert.equal(report[0].lastPunch, '—')
})

test('daily exceptions left-join the eligible roster and derive absent only for missing selected-date rows', () => {
  const noRowWorker = worker('no-row')
  const halfDayWorker = worker('half-day')
  const completeWorker = worker('complete')
  const administrationWorker = { ...worker('admin'), team_name: 'Adminstration', team: { name: 'Adminstration' } }
  const attendance = [
    row('half-day', { worker: halfDayWorker, status: 'half_day', check_in: '07:08:00', check_out: null, attendance_date: '2026-09-21' }),
    row('half-day-later', { worker: halfDayWorker, worker_name: 'Worker half-day', status: 'half_day', check_in: '07:08:00', check_out: null, attendance_date: '2026-09-21', updated_at: '2026-09-21T18:00:00Z' }),
    row('complete', { worker: completeWorker, status: 'present', attendance_date: '2026-09-21' }),
    row('admin', { worker: administrationWorker, status: 'absent', check_in: null, check_out: null, attendance_date: '2026-09-21' }),
    row('no-row', { worker: noRowWorker, status: 'present', attendance_date: '2026-09-20' }),
  ]
  const originalAttendance = structuredClone(attendance)
  const report = buildDailyAttendanceExceptions({
    workers: [noRowWorker, halfDayWorker, completeWorker, administrationWorker],
    attendance,
    date: '2026-09-21',
  })

  assert.deepEqual(report.map((item) => [item.worker, item.status]), [
    ['Worker no-row', 'absent'],
    ['Worker half-day', 'half_day'],
  ])
  assert.deepEqual(attendance, originalAttendance)
})

test('daily reports display only active confirmed biometric mapping IDs, never worker employee codes', () => {
  const benjamin = { ...worker('benjamin'), employee_code: '68' }
  const unmapped = { ...worker('unmapped'), employee_code: '99' }
  const mappings = [
    { worker_id: 'benjamin', device_employee_no: '149', is_active: true, mapping_review_state: 'confirmed' },
    { worker_id: 'benjamin', device_employee_no: '150', is_active: false, mapping_review_state: 'confirmed' },
    { worker_id: 'benjamin', device_employee_no: '151', is_active: true, mapping_review_state: 'needs_review' },
  ]
  const attendance = [
    row('benjamin', { worker: benjamin, status: 'half_day', check_in: '17:13:11', check_out: null, attendance_date: '2026-09-21' }),
    row('unmapped', { worker: unmapped, status: 'half_day', check_in: '08:00:00', check_out: null, attendance_date: '2026-09-21' }),
  ]
  const exceptions = buildDailyAttendanceExceptions({ workers: [benjamin, unmapped], attendance, mappings, date: '2026-09-21' })
  const overtime = buildDailyOvertimeReport({ attendance: [row('benjamin', { worker: benjamin, check_out: '19:00:00' })], mappings, date: '2026-09-14' })

  assert.deepEqual(exceptions.map((item) => [item.worker, item.biometricId]), [
    ['Worker benjamin', '149'],
    ['Worker unmapped', '—'],
  ])
  assert.equal(overtime[0].biometricId, '149')
})

test('daily exceptions page loads the selected date with pagination and derives its print rows from the same roster report', () => {
  const source = readFileSync('./src/pages/DailyOperationalReports.jsx', 'utf8')
  const attendanceApi = readFileSync('./src/api/attendanceApi.js', 'utf8')
  assert.match(source, /getAttendanceRequest\(\{ date: selectedDate, staff_classification: 'normal', paginate: true \}\)/)
  assert.match(source, /getWorkersRequest\(\)/)
  assert.match(source, /getBiometricMappingsRequest\(\)/)
  assert.match(source, /getCurrentAttendanceEvidenceRequest\(selectedDate\)/)
  assert.match(source, /buildDailyAttendanceExceptions\(\{ workers, attendance, evidence, mappings, date: selectedDate \}\)/)
  assert.match(source, /reports\.biometricId/)
  assert.match(source, /reports\.lastPunch/)
  assert.match(source, /row\.checkOut === '—' \? row\.lastPunch : row\.checkOut/)
  assert.match(source, /rows\.map\(/)
  assert.match(attendanceApi, /attendance_day_fraction/)
})

test('daily overtime report reuses canonical weekday overtime and excludes zero or inactive rows', () => {
  const report = buildDailyOvertimeReport({ date: '2026-09-14', attendance: [row('overtime', { check_out: '19:00:00' }), row('none'), row('inactive', { check_out: '22:00:00', active: false })] })
  assert.equal(report.length, 1)
  assert.equal(report[0].overtimeMinutes, 120)
})

test('daily overtime preserves Saturday zero-overtime behavior', () => {
  assert.equal(buildDailyOvertimeReport({ date: '2026-09-19', attendance: [row('saturday', { check_out: '22:00:00' })] }).length, 0)
})

test('daily reports default helper selects the previous business date', () => {
  assert.equal(yesterdayFromBusinessDate('2026-09-21'), '2026-09-20')
})
