import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDailyAttendanceExceptions, buildDailyOvertimeReport, yesterdayFromBusinessDate } from './src/utils/dailyOperationalReports.js'

const worker = (id, active = true) => ({ id, full_name: `Worker ${id}`, employee_code: `C${id}`, is_active: active, staff_classification: 'normal' })
const row = (id, values = {}) => ({ id, worker: worker(id, values.active), worker_name: `Worker ${id}`, team_name: 'Team A', status: 'present', check_in: '08:00:00', check_out: '17:00:00', ...values })

test('daily exceptions exclude clean present but retain canonical non-normal and late rows', () => {
  const report = buildDailyAttendanceExceptions({ attendance: [row('clean'), row('half', { status: 'half_day' }), row('late', { biometric_sync_metadata: { late_arrival: true } }), row('inactive', { status: 'absent', active: false })] })
  assert.deepEqual(report.map((item) => item.worker), ['Worker half', 'Worker late'])
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
