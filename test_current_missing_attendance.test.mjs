import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  attendanceRosterCategory,
  mergeAttendanceRoster,
} from './src/utils/attendanceRoster.js'

const date = '2026-09-08'
const normalWorker = (id, overrides = {}) => ({
  id,
  full_name: id,
  employee_code: id,
  is_active: true,
  staff_classification: 'normal',
  ...overrides,
})
const categoryFor = ({ worker = normalWorker('worker'), attendance = [], biometricEvidence = [] } = {}) => {
  const [row] = mergeAttendanceRoster({
    workers: [worker], attendance, biometricEvidence, date, businessDate: date,
  })
  return row ? attendanceRosterCategory(row) : null
}

test('no attendance and no biometric evidence remains not recorded', () => {
  assert.equal(categoryFor(), 'not_recorded')
})

test('safe mapped biometric evidence is pending review, not missing or present', () => {
  const rows = mergeAttendanceRoster({
    workers: [normalWorker('henry')],
    attendance: [],
    biometricEvidence: [{ worker_id: 'henry', attendance_date: date, event_timestamp: `${date}T00:31:13+01:00` }],
    date,
    businessDate: date,
  })
  assert.equal(rows[0].roster_state, 'biometric_pending')
  assert.equal(attendanceRosterCategory(rows[0]), 'review')
  assert.notEqual(attendanceRosterCategory(rows[0]), 'present')
})

test('unmapped or unresolved biometric activity does not remove a worker from missing', () => {
  assert.equal(categoryFor({
    biometricEvidence: [{ worker_id: null, attendance_date: date, event_timestamp: `${date}T08:00:00+01:00` }],
  }), 'not_recorded')
})

test('early-morning needs-review evidence with an established worker is not missing', () => {
  assert.equal(categoryFor({
    biometricEvidence: [{ worker_id: 'worker', attendance_date: date, event_timestamp: `${date}T00:31:13+01:00`, evidence_type: 'early_morning_needs_review' }],
  }), 'review')
})

test('an existing attendance row always controls the roster state', () => {
  assert.equal(categoryFor({
    attendance: [{ worker_id: 'worker', attendance_date: date, status: 'half_day', check_in: '08:00:00' }],
    biometricEvidence: [{ worker_id: 'worker', attendance_date: date, event_timestamp: `${date}T08:00:00+01:00` }],
  }), 'present')
})

test('inactive and special staff workers remain outside the normal roster', () => {
  assert.equal(categoryFor({ worker: normalWorker('inactive', { is_active: false }) }), null)
  assert.equal(categoryFor({ worker: normalWorker('special', { staff_classification: 'special_staff' }) }), null)
})

test('HENRY regression reconciles 218 workers and 173 attendance rows to 44 missing', () => {
  const workers = Array.from({ length: 218 }, (_, index) => normalWorker(`worker-${index}`))
  workers[217] = normalWorker('a35f0156-97eb-4289-87ee-b379320d1056', { full_name: 'HENRY', employee_code: '155' })
  const attendance = workers.slice(0, 173).map((worker) => ({
    worker_id: worker.id, attendance_date: date, status: 'half_day', check_in: '08:00:00',
  }))
  const evidence = [{
    worker_id: 'a35f0156-97eb-4289-87ee-b379320d1056', attendance_date: date, event_timestamp: `${date}T00:31:13+01:00`,
  }]
  const rows = mergeAttendanceRoster({ workers, attendance, biometricEvidence: evidence, date, businessDate: date })
  assert.equal(rows.filter((row) => attendanceRosterCategory(row) === 'not_recorded').length, 44)
  assert.equal(rows.find((row) => row.worker_id === evidence[0].worker_id).roster_state, 'biometric_pending')
})

test('dashboard, attendance page, and detailed missing list use the same evidence-aware roster helper', () => {
  for (const file of ['./src/pages/Dashboard.jsx', './src/pages/Attendance.jsx', './src/pages/MissingAttendance.jsx']) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /getCurrentAttendanceEvidenceRequest/)
    assert.match(source, /mergeAttendanceRoster\(\{/)
    assert.match(source, /biometricEvidence/)
  }
  const missingPage = readFileSync('./src/pages/MissingAttendance.jsx', 'utf8')
  assert.match(missingPage, /attendanceRosterCategory\(row\) === 'not_recorded'/)
  assert.doesNotMatch(missingPage, /recordedWorkerIds/)
})

test('the shared evidence API is read-only and never writes attendance', () => {
  const source = readFileSync('./src/api/currentAttendanceEvidenceApi.js', 'utf8')
  assert.match(source, /get_company_mapped_biometric_events/)
  assert.doesNotMatch(source, /\.from\(['"]attendance['"]\)|insert\(|update\(|upsert\(|delete\(/)
})

test('SQL evidence resolution preserves production mapping precedence and read-only safety', () => {
  const sql = readFileSync('./supabase/sql/current_missing_attendance_evidence.sql', 'utf8')
  assert.match(sql, /scope\.exact_owner_count = 1[\s\S]*scope\.exact_worker_id/)
  assert.match(sql, /scope\.exact_owner_count = 0[\s\S]*scope\.legacy_owner_count = 1[\s\S]*scope\.legacy_worker_id/)
  assert.match(sql, /review\.device_id = e\.device_id[\s\S]*review\.review_state = 'ignored'/)
  assert.match(sql, /review\.device_id is null[\s\S]*review\.review_state = 'ignored'/)
  assert.match(sql, /biometric_early_morning_review[\s\S]*review_status = 'needs_review'/)
  assert.doesNotMatch(sql, /\b(insert|update|delete|merge|truncate)\b/i)
})
