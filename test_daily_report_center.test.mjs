import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { adjacentOperationalDate, dailyReportData, operationalWeekDates } from './src/utils/dailyReportCenter.js'

const day = '2026-09-21'
const worker = (id, team = 'Maison') => ({ id, full_name: id, is_active: true, staff_classification: 'normal', team_name: team, team: { name: team } })
const attendance = (id, status, checkOut = null, date = day) => ({ id: `${id}-${date}`, worker_id: id, worker: worker(id), attendance_date: date, status, check_in: '08:00:00', check_out: checkOut, attendance_day_fraction: status === 'present' ? 1 : 0.5, team_name: 'Maison' })

test('current operational week runs Monday through Saturday and resets next Monday', () => {
  assert.deepEqual(operationalWeekDates('2026-09-25'), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'])
  assert.deepEqual(operationalWeekDates('2026-09-27'), operationalWeekDates('2026-09-25'))
  assert.equal(operationalWeekDates('2026-09-28')[0], '2026-09-28')
  assert.equal(adjacentOperationalDate('2026-09-26', 1), '2026-09-28')
  assert.equal(adjacentOperationalDate('2026-09-28', -1), '2026-09-26')
})

test('each selected date uses existing exceptions and canonical overtime without mixing days', () => {
  const workers = [worker('absent'), worker('half'), worker('present'), worker('chauffeur', 'Chauffeur'), worker('admin', 'Adminstration')]
  const rows = [
    attendance('half', 'half_day'),
    attendance('present', 'present', '18:39:00'),
    { ...attendance('chauffeur', 'present', '23:00:00'), worker: worker('chauffeur', 'Chauffeur'), team_name: 'Chauffeur' },
    { ...attendance('admin', 'absent'), worker: worker('admin', 'Adminstration'), team_name: 'Adminstration' },
    attendance('present', 'present', '19:00:00', '2026-09-22'),
  ]
  const monday = dailyReportData({ date: day, workers, attendance: rows })
  assert.deepEqual(monday.exceptions.map((row) => row.worker), ['absent', 'half'])
  assert.equal(monday.counts.absent, 1)
  assert.equal(monday.counts.halfDay, 1)
  assert.equal(monday.counts.notRecorded, 1)
  assert.deepEqual(monday.overtime.map((row) => [row.worker, row.overtimeMinutes]), [['present', 90]])
  const tuesday = dailyReportData({ date: '2026-09-22', workers, attendance: rows })
  assert.equal(tuesday.counts.overtimeMinutes, 120)
  assert.equal(tuesday.overtime.length, 1)
})

test('Saturday overtime remains excluded and completed present does not leak into exceptions', () => {
  const saturday = dailyReportData({ date: '2026-09-26', workers: [worker('present')], attendance: [attendance('present', 'present', '22:00:00', '2026-09-26')] })
  assert.equal(saturday.exceptions.length, 0)
  assert.equal(saturday.overtime.length, 0)
})

test('admin routes, separate day links, canonical data reads and three A4 print modes are wired', () => {
  const page = readFileSync('./src/pages/DailyReportsCenter.jsx', 'utf8')
  const router = readFileSync('./src/routes/AppRouter.jsx', 'utf8')
  const css = readFileSync('./src/index.css', 'utf8')
  assert.match(router, /path="\/reports\/daily"/)
  assert.match(router, /path="\/reports\/daily\/:date"/)
  assert.match(page, /getAttendanceRequest\(\{ date_from: from, date_to: to, staff_classification: 'normal', paginate: true \}\)/)
  assert.match(page, /getMorningVerificationStatusRequest\(today\)/)
  assert.match(page, /to=\{`\/reports\/daily\/\$\{day\}`\}/)
  assert.match(page, /print\('attendance'\)/)
  assert.match(page, /print\('overtime'\)/)
  assert.match(page, /print\('all'\)/)
  assert.match(page, /size: A4 landscape/)
  assert.match(css, /daily-center-screen-only \{ display: none !important; \}/)
  assert.match(css, /daily-center-table thead \{ display: table-header-group; \}/)
  assert.match(css, /data-print-mode="attendance"/)
  assert.match(css, /data-print-mode="overtime"/)
})
