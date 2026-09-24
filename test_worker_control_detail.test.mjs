import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildWorkerControlDetail, monitoringFactText } from './src/utils/workerControlDetail.js'

const worker = (extra = {}) => ({ id: 'w', full_name: 'Worker', employee_code: '17', team_id: 't', team_name: 'Maison', is_active: true, staff_classification: 'normal', ...extra })
const row = (date, status, extra = {}) => ({ worker_id: 'w', attendance_date: date, status, ...extra })
const period = { today: '2026-09-24', weekStart: '2026-09-21', monthStart: '2026-09-01' }
const detail = (options = {}) => buildWorkerControlDetail({ worker: worker(), attendance: [], events: [], mappings: [], activated: [], ...period, ...options })

test('today uses canonical row, real punch metadata, and existing overtime helper', () => {
  const result = detail({ attendance: [row('2026-09-24', 'half_day', { check_in: '08:05:00', check_out: null, biometric_sync_metadata: { check_in_event_timestamp: '2026-09-24T07:05:00Z' } })] })
  assert.equal(result.today.status, 'half_day')
  assert.equal(result.today.checkIn, '08:05:00')
  assert.equal(result.today.checkOut, null)
  assert.equal(result.today.lastPunch, '2026-09-24T07:05:00Z')
  assert.equal(result.today.overtimeMinutes, 0)
})

test('weekly grid has Monday through Saturday, future days remain future, and week counts use eligible dates', () => {
  const result = detail({ attendance: [row('2026-09-21', 'present'), row('2026-09-22', 'absent'), row('2026-09-23', 'half_day')] })
  assert.deepEqual(result.week.map((day) => day.date), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'])
  assert.deepEqual(result.week.map((day) => day.status), ['present', 'absent', 'half_day', 'no_record', 'future', 'future'])
  assert.deepEqual([result.weekCounts.present, result.weekCounts.absent, result.weekCounts.halfDay, result.weekCounts.noRecord], [1, 1, 1, 1])
})

test('month history separates stored absence, half-day, and eligible no-record days', () => {
  const result = detail({ worker: worker({ operational_start_date: '2026-09-22' }), attendance: [row('2026-09-21', 'absent'), row('2026-09-22', 'half_day', { check_in: '09:00:00' }), row('2026-09-23', 'absent'), row('2026-09-24', 'present')] })
  assert.equal(result.month.some((day) => day.date === '2026-09-21'), false)
  assert.deepEqual([result.monthCounts.present, result.monthCounts.absent, result.monthCounts.halfDay, result.monthCounts.noRecord], [1, 1, 1, 0])
  assert.deepEqual(result.absenceDays.map((day) => day.date), ['2026-09-23'])
  assert.deepEqual(result.halfDays.map((day) => day.date), ['2026-09-22'])
  assert.equal(result.attendancePercentage, 50)
})

test('consecutive absence is an explicit stored-row fact, not an alert label', () => {
  const result = detail({ attendance: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'].map((date) => row(date, 'absent')) })
  assert.deepEqual(result.absenceStreaks.at(-1), { from: '2026-09-21', to: '2026-09-24', count: 4 })
  assert.equal(result.currentAbsence, 4)
  assert.equal(monitoringFactText(result.monitoring.find((item) => item.code === 'consecutive_absence')), 'غائب 4 أيام متتالية')
  assert.doesNotMatch(result.monitoring.map(monitoringFactText).join(' '), /critical|warning|watch|alert/i)
})

test('inactive worker with a real punch and activation record have factual statements', () => {
  const inactive = detail({ worker: worker({ is_active: false }), events: [{ worker_id: 'w', event_timestamp: '2026-09-24T08:00:00Z', device_id: 'office-main' }] })
  assert.equal(inactive.today.lastPunch, '2026-09-24T08:00:00Z')
  assert.equal(monitoringFactText(inactive.monitoring.find((item) => item.code === 'inactive_punch_today')), 'غير مفعّل وقام بالبصمة اليوم')
  const activated = detail({ activated: [{ worker_id: 'w', activated_at: '2026-09-24T08:00:00Z' }] })
  assert.equal(monitoringFactText(activated.monitoring.find((item) => item.code === 'activated_today')), 'تم تفعيله اليوم')
})

test('Chauffeur has no normal overtime while other teams use the canonical overtime helper', () => {
  const attendance = [row('2026-09-23', 'present', { check_in: '07:47:00', check_out: '18:39:00' })]
  assert.equal(detail({ worker: worker({ team_name: 'Chauffeur' }), attendance }).weekCounts.overtimeMinutes, 0)
  assert.equal(detail({ attendance }).weekCounts.overtimeMinutes, 90)
})

test('mapping details are derived from one bulk result without a worker-specific request', async () => {
  const result = detail({ mappings: [{ id: 'm', worker_id: 'w', device_id: 'office-main', device_employee_no: '73', is_active: true, mapping_review_state: 'confirmed' }] })
  assert.deepEqual(result.mappings.map((mapping) => mapping.device_employee_no), ['73'])
  const page = await readFile(new URL('./src/pages/WorkerControlCenter.jsx', import.meta.url), 'utf8')
  assert.equal((page.match(/getBiometricMappingsRequest\(/g) || []).length, 1)
  assert.match(page, /WorkerControlWorkerPage/)
  assert.doesNotMatch(page, /WorkerControlDetailPanel/)
  assert.doesNotMatch(page, /r\.severity/)
})
