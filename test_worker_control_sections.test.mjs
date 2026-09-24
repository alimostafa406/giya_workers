import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildWorkerControlSectionMetrics } from './src/utils/workerControlSectionMetrics.js'

const worker = (id, name, extra = {}) => ({ id, full_name: name, team_id: 'paint', team_name: 'Peinture Raghibe', is_active: true, staff_classification: 'normal', ...extra })
const row = (id, date, status, extra = {}) => ({ worker_id: id, attendance_date: date, status, ...extra })
const period = { today: '2026-09-24', weekStart: '2026-09-21', monthStart: '2026-09-01' }

test('half-day monitoring includes today and repeated week/month records, sorted by month then week', () => {
  const workers = [worker('today', 'Z Today'), worker('week', 'A Week'), worker('month', 'M Month'), worker('normal', 'Normal')]
  const attendance = [
    row('today', '2026-09-24', 'half_day', { check_in: '08:05:00' }),
    row('week', '2026-09-21', 'half_day'), row('week', '2026-09-22', 'half_day'),
    row('month', '2026-09-07', 'half_day'), row('month', '2026-09-09', 'half_day'),
    row('normal', '2026-09-21', 'half_day'), row('normal', '2026-09-24', 'present'),
  ]
  const { halfDayRows } = buildWorkerControlSectionMetrics({ workers, attendance, ...period })
  assert.deepEqual(halfDayRows.map((item) => item.worker.id), ['week', 'month', 'today'])
  assert.deepEqual(halfDayRows.map((item) => [item.weekHalf, item.monthHalf]), [[2, 2], [0, 2], [1, 1]])
  assert.equal(halfDayRows.find((item) => item.worker.id === 'today').todayRow.check_in, '08:05:00')
})

test('team monitoring counts canonical statuses, unrecorded separately, and V1 period absences', () => {
  const workers = [worker('present', 'Present'), worker('half', 'Half'), worker('absent', 'Absent'), worker('missing', 'Missing'), worker('special', 'Special', { staff_classification: 'special_staff' }), worker('admin', 'Admin', { team_id: 'admin', team_name: 'Adminstration' }), worker('future', 'Future', { operational_start_date: '2026-09-25' }), worker('inactive', 'Inactive', { is_active: false })]
  const attendance = [row('present', '2026-09-24', 'present'), row('half', '2026-09-24', 'half_day'), row('absent', '2026-09-24', 'absent'), row('absent', '2026-09-22', 'absent'), row('present', '2026-09-08', 'absent'), row('inactive', '2026-09-24', 'absent')]
  const alerts = [{ type: 'consecutive_absence', worker: workers[2] }, { type: 'weekly_absence', worker: workers[2] }]
  const { teamRows, halfDayRows } = buildWorkerControlSectionMetrics({ workers, attendance, alerts, ...period })
  assert.equal(teamRows.length, 1)
  assert.deepEqual([teamRows[0].active, teamRows[0].present, teamRows[0].halfDay, teamRows[0].absent, teamRows[0].notRecorded], [4, 1, 1, 1, 1])
  assert.deepEqual([teamRows[0].weekAbsent, teamRows[0].monthAbsent, teamRows[0].consecutive, teamRows[0].monitored], [14, 82, 1, 2])
  assert.deepEqual(halfDayRows.map((item) => item.worker.id), ['half'])
})

test('operational start and Sunday exclusion bound half-day counts', () => {
  const workers = [worker('new', 'New', { operational_start_date: '2026-09-21' })]
  const attendance = [row('new', '2026-09-20', 'half_day'), row('new', '2026-09-21', 'half_day')]
  const { halfDayRows } = buildWorkerControlSectionMetrics({ workers, attendance, ...period })
  assert.equal(halfDayRows.length, 0)
})

test('new sections reuse the page bulk requests and leave sections 1–8 present', async () => {
  const page = await readFile(new URL('./src/pages/WorkerControlCenter.jsx', import.meta.url), 'utf8')
  assert.match(page, /id="half-day-monitoring"/)
  assert.match(page, /id="team-monitoring"/)
  for (const id of ['today-overview', 'absent-today', 'consecutive-absence', 'weekly-absence', 'monthly-monitoring', 'returned-after-absence', 'inactive-punch', 'activated-today']) assert.match(page, new RegExp(id))
  // One bulk load and one bulk refresh after the explicit recovery action;
  // opening a worker detail does not issue any attendance request.
  assert.equal((page.match(/getAttendanceRequest\(/g) || []).length, 2)
  assert.equal((page.match(/getInactiveWorkerBiometricActivityRequest\(/g) || []).length, 1)
})
