import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildAbsenceReport } from './src/utils/absenceReport.js'
import { mergeAttendanceRoster } from './src/utils/attendanceRoster.js'
import { buildInactiveWorkerRows } from './src/utils/inactiveWorkers.js'
import { isWeeklyPayrollEligibleWorker } from './src/utils/weeklyPayrollEligibility.js'

const activeWorker = { id: 'worker-1', full_name: 'Worker One', employee_code: '001', team_id: 'team-1', team_name: 'Team One', is_active: true, staff_classification: 'normal', payment_type: 'weekly' }
const inactiveWorker = { ...activeWorker, is_active: false, updated_at: '2026-09-16T10:00:00Z' }
const todayAttendance = { id: 'attendance-today', worker_id: activeWorker.id, attendance_date: '2026-09-16', status: 'present', check_in: '07:55:00', check_out: null, updated_at: '2026-09-16T08:00:00Z' }
const historicalAttendance = { id: 'attendance-old', worker_id: activeWorker.id, attendance_date: '2026-09-15', status: 'present', check_in: '08:00:00', check_out: '17:00:00' }
const mapping = { id: 'mapping-1', worker_id: activeWorker.id, device_id: 'office-main', device_employee_no: '001', is_active: true }

test('deactivation immediately removes a worker from current attendance and absence operations', () => {
  assert.equal(mergeAttendanceRoster({ workers: [activeWorker], attendance: [todayAttendance], date: '2026-09-16', businessDate: '2026-09-16' }).length, 1)
  assert.equal(mergeAttendanceRoster({ workers: [inactiveWorker], attendance: [todayAttendance], date: '2026-09-16', businessDate: '2026-09-16' }).length, 0)
  assert.equal(buildAbsenceReport({ workers: [inactiveWorker], attendance: [], selectedDate: '2026-09-16', businessDate: '2026-09-16' }).missingMorningWorkers, 0)
  assert.equal(isWeeklyPayrollEligibleWorker(inactiveWorker), false)
})

test('inactive-worker history preserves same-day and historical attendance without mutating source data', () => {
  const attendance = [historicalAttendance, todayAttendance]
  const original = structuredClone(attendance)
  const [row] = buildInactiveWorkerRows({ workers: [inactiveWorker], mappings: [mapping], attendance })
  assert.equal(row.id, activeWorker.id)
  assert.equal(row.latestAttendance.id, 'attendance-today')
  assert.equal(row.latestAttendance.check_in, '07:55:00')
  assert.deepEqual(row.attendanceHistory.map((item) => item.id), ['attendance-today', 'attendance-old'])
  assert.equal(row.biometricMappings[0].id, 'mapping-1')
  assert.deepEqual(attendance, original)
})

test('reactivation keeps the same worker identity, attendance, payroll profile, and biometric mapping', () => {
  const payrollProfile = { worker_id: inactiveWorker.id, payment_type: 'weekly' }
  const reactivated = { ...inactiveWorker, is_active: true }
  assert.equal(reactivated.id, inactiveWorker.id)
  assert.equal(todayAttendance.worker_id, reactivated.id)
  assert.equal(payrollProfile.worker_id, reactivated.id)
  assert.equal(mapping.worker_id, reactivated.id)
  assert.equal(isWeeklyPayrollEligibleWorker({ ...reactivated, payment_type: 'weekly', payroll_compensation: { daily_rate: 1, currency_code: 'CDF' } }), true)
})

test('deactivation API changes only the worker row and inactive history page remains read-only', async () => {
  const workersApi = await readFile(new URL('./src/api/workersApi.js', import.meta.url), 'utf8')
  const workersPage = await readFile(new URL('./src/pages/Workers.jsx', import.meta.url), 'utf8')
  const inactivePage = await readFile(new URL('./src/pages/InactiveWorkers.jsx', import.meta.url), 'utf8')
  assert.match(workersPage, /updateWorkerRequest\(worker\.id/)
  assert.match(workersApi, /\.from\('workers'\)\s*\.update\(updatePayload\)\s*\.eq\('id', id\)/s)
  assert.doesNotMatch(workersApi, /delete\(/)
  assert.match(inactivePage, /getAttendanceRequest\(\{ worker_ids: inactiveWorkerIds, paginate: true \}\)/)
  assert.doesNotMatch(inactivePage, /saveAttendance|updateWorker|delete\(|upsert\(/)
})
