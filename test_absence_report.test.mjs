import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  absenceWeekDates,
  buildAbsenceReport,
  createAbsenceReportRefreshCoordinator,
  hasAttendanceCheckIn,
} from './src/utils/absenceReport.js'
import { isAttendancePageLocked, prepareAttendanceOutput } from './src/utils/attendanceOperationalGate.js'

const workers = [
  { id: 'w1', full_name: 'NIVA', employee_code: '211', team_id: 'a', team_name: 'Cleaner', team: { id: 'a', name: 'Cleaner' }, is_active: true, staff_classification: 'normal' },
  { id: 'w2', full_name: 'JOHN', employee_code: '212', team_id: 'a', team_name: 'Cleaner', team: { id: 'a', name: 'Cleaner' }, is_active: true, staff_classification: 'normal' },
  { id: 'w3', full_name: 'DAVID', employee_code: '301', team_id: 'b', team_name: 'Administration', team: { id: 'b', name: 'Administration' }, is_active: true, staff_classification: 'normal' },
  { id: 'inactive', full_name: 'INACTIVE', team_id: 'b', team_name: 'Administration', is_active: false, staff_classification: 'normal' },
  { id: 'special', full_name: 'SPECIAL', team_id: 'b', team_name: 'Administration', is_active: true, staff_classification: 'special_staff' },
]

const reportFor = (attendance, extra = {}) => buildAbsenceReport({
  workers,
  attendance,
  selectedDate: '2026-09-03',
  businessDate: '2026-09-03',
  mode: 'today',
  ...extra,
})

test('any matching attendance check-in is authoritative regardless of clock time', () => {
  assert.equal(hasAttendanceCheckIn({ worker_id: 'w1', attendance_date: '2026-09-03', check_in: '06:26:23' }), true)
  assert.equal(hasAttendanceCheckIn({ worker_id: 'w1', attendance_date: '2026-09-03', check_in: '09:05:13' }), true)
  assert.equal(hasAttendanceCheckIn({ worker_id: 'w1', attendance_date: '2026-09-03', check_in: null }), false)
})

test('check-in before 07:00 is not missing', () => {
  const report = reportFor([{ worker_id: 'w1', attendance_date: '2026-09-03', status: 'half_day', check_in: '06:26:23' }], { workers: [workers[0]] })
  assert.equal(report.missingMorningWorkers, 0)
})

test('check-in after 09:00 is not missing', () => {
  const report = reportFor([{ worker_id: 'w1', attendance_date: '2026-09-03', status: 'late', check_in: '10:51:26' }], { workers: [workers[0]] })
  assert.equal(report.missingMorningWorkers, 0)
})

test('late and half-day workers with real check-ins are not missing', () => {
  const report = reportFor([
    { worker_id: 'w1', attendance_date: '2026-09-03', status: 'late', check_in: '09:05:13' },
    { worker_id: 'w2', attendance_date: '2026-09-03', status: 'half_day', check_in: '06:26:23' },
  ], { workers: workers.slice(0, 2) })
  assert.equal(report.missingMorningWorkers, 0)
})

test('active normal worker with no check-in is missing', () => {
  const report = reportFor([{ worker_id: 'w1', attendance_date: '2026-09-03', status: 'absent', check_in: null }], { workers: [workers[0]] })
  assert.equal(report.missingMorningWorkers, 1)
  assert.equal(report.groups[0].workers[0].id, 'w1')
})

test('inactive and special-staff workers are excluded', () => {
  const report = reportFor([], { workers: workers.slice(3) })
  assert.equal(report.missingMorningWorkers, 0)
})

test('attendance must match both worker and selected date', () => {
  const report = reportFor([
    { worker_id: 'w1', attendance_date: '2026-09-02', check_in: '08:00:00' },
    { worker_id: 'another-worker', attendance_date: '2026-09-03', check_in: '08:00:00' },
  ], { workers: [workers[0]] })
  assert.equal(report.missingMorningWorkers, 1)
})

test('production-like 46-worker fixture removes all eight false positives and leaves 38 missing', () => {
  const falsePositiveWorkers = [
    ['NANCY', '21', '09:47:25', 'late'], ['metshi', '334', '06:54:05', 'half_day'],
    ['PAYIKE', '63', '10:51:26', 'late'], ['KOYAKAMBA', '125', '09:05:13', 'late'],
    ['CHRISTIAN', '51', '10:20:38', 'late'], ['DJODJO2', '151', '06:26:23', 'half_day'],
    ['JOHN', '83', '09:15:55', 'late'], ['niva', '211', '09:11:13', 'late'],
  ].map(([full_name, employee_code], index) => ({ id: `checked-${index}`, full_name, employee_code, team_id: 'a', team_name: 'Team', is_active: true, staff_classification: 'normal' }))
  const genuinelyMissing = Array.from({ length: 38 }, (_, index) => ({ id: `missing-${index}`, full_name: `Missing ${index}`, team_id: 'a', team_name: 'Team', is_active: true, staff_classification: 'normal' }))
  const attendance = falsePositiveWorkers.map((worker, index) => ({
    worker_id: worker.id,
    attendance_date: '2026-09-03',
    check_in: [['09:47:25'], ['06:54:05'], ['10:51:26'], ['09:05:13'], ['10:20:38'], ['06:26:23'], ['09:15:55'], ['09:11:13']][index][0],
  }))
  const report = reportFor(attendance, { workers: [...falsePositiveWorkers, ...genuinelyMissing] })
  const shownIds = new Set(report.groups.flatMap((group) => group.workers.map((worker) => worker.id)))
  assert.equal(report.missingMorningWorkers, 38)
  assert.equal(falsePositiveWorkers.some((worker) => shownIds.has(worker.id)), false)
  assert.equal(genuinelyMissing.every((worker) => shownIds.has(worker.id)), true)
})

test('week report remains Monday-Saturday and future dates remain neutral', () => {
  assert.deepEqual(absenceWeekDates('2026-09-03'), ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'])
  const report = buildAbsenceReport({
    workers: [workers[0]],
    attendance: [{ worker_id: 'w1', attendance_date: '2026-08-31', check_in: '06:30:00' }],
    selectedDate: '2026-09-03',
    businessDate: '2026-09-03',
    mode: 'week',
  })
  assert.deepEqual(report.groups[0].workers[0].states.map((day) => day.state), ['morning_recorded', 'morning_missing', 'morning_missing', 'morning_missing', 'future', 'future'])
})

test('team filtering and worker deduplication are preserved', () => {
  const report = reportFor([], { workers: [...workers, { ...workers[0] }], teamId: 'a' })
  assert.equal(report.groups.length, 1)
  assert.deepEqual(report.groups[0].workers.map((worker) => worker.id).sort(), ['w1', 'w2'])
})

test('today before 09:30 is locked and historical dates are accessible', () => {
  const now = new Date('2026-09-03T08:29:59.000Z')
  assert.equal(isAttendancePageLocked({ selectedDate: '2026-09-03', now }), true)
  assert.equal(isAttendancePageLocked({ selectedDate: '2026-09-02', now }), false)
})

test('refresh coordinator coalesces overlapping requests', async () => {
  const coordinate = createAbsenceReportRefreshCoordinator()
  let calls = 0
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const load = async () => { calls += 1; await pending; return { fresh: true } }
  const first = coordinate('today:2026-09-03', load)
  const second = coordinate('today:2026-09-03', load)
  await Promise.resolve()
  assert.equal(calls, 1)
  release()
  assert.deepEqual(await first, { fresh: true })
  assert.deepEqual(await second, { fresh: true })
})

test('print waits for a fresh snapshot and failed refresh cancels printing', async () => {
  const order = []
  const success = await prepareAttendanceOutput({
    locked: false,
    refresh: async () => { order.push('refresh'); return { key: 'fresh' } },
    generate: async () => { order.push('print') },
  })
  assert.equal(success.ok, true)
  assert.deepEqual(order, ['refresh', 'print'])
  let printed = false
  const failure = await prepareAttendanceOutput({
    locked: false,
    refresh: async () => { throw new Error('offline') },
    generate: async () => { printed = true },
  })
  assert.equal(failure.reason, 'refresh_failed')
  assert.equal(printed, false)
})

test('page uses coordinated current attendance freshness and no biometric event authority', () => {
  const page = readFileSync('./src/pages/AbsenceReport.jsx', 'utf8')
  const attendancePage = readFileSync('./src/pages/Attendance.jsx', 'utf8')
  const router = readFileSync('./src/routes/AppRouter.jsx', 'utf8')
  assert.match(attendancePage, /to="\/attendance\/absence-report"/)
  assert.match(router, /path="\/attendance\/absence-report" element=\{<AbsenceReport \/>\}/)
  assert.match(page, /Promise\.all\(\[[\s\S]*getWorkersRequest\(\)[\s\S]*getTeamsRequest\(\)[\s\S]*getAttendanceRequest\(attendanceParams\)/)
  assert.match(page, /setInterval\(\(\) => setNow\(new Date\(\)\), 1_000\)/)
  assert.match(page, /ATTENDANCE_REFRESH_INTERVAL_MS/)
  assert.match(page, /window\.addEventListener\('focus', refreshAfterFocus\)/)
  assert.match(page, /document\.addEventListener\('visibilitychange', refreshAfterFocus\)/)
  assert.match(page, /prepareAttendanceOutput/)
  assert.match(page, /refresh: \(\) => refreshSnapshot\(requested\)/)
  assert.doesNotMatch(page, /getCompanyMappedBiometricEventsRequest|biometricEvents|07:00|09:00/)
  assert.doesNotMatch(page, /saveAttendance|updateAttendance|insert|upsert|delete/)
})

test('print CSS still flows teams and supports portrait today and landscape week', () => {
  const page = readFileSync('./src/pages/AbsenceReport.jsx', 'utf8')
  const css = readFileSync('./src/index.css', 'utf8')
  assert.match(page, /size: A4 \$\{mode === 'week' \? 'landscape' : 'portrait'\}/)
  assert.match(css, /\.absence-team-block--small\s*\{\s*break-inside: avoid;/)
  assert.match(css, /\.absence-week-table thead\s*\{\s*display: table-header-group;/)
  assert.doesNotMatch(css, /page-break-before:\s*always|break-before:\s*page/)
})
