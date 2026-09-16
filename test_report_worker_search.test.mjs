import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildAbsenceReport } from './src/utils/absenceReport.js'
import { reportWorkerMatchesSearch } from './src/utils/reportWorkerSearch.js'

const workers = [
  { id: '1', full_name: 'MUNIANGA', employee_code: '346', team_id: 'paint', team_name: 'Peinture Raghibe', is_active: true, staff_classification: 'normal' },
  { id: '2', full_name: 'Abed Karim', employee_code: '120', team_id: 'paint', team_name: 'Peinture Raghibe', is_active: true, staff_classification: 'normal' },
  { id: '3', full_name: 'Other Worker', employee_code: '999', team_id: 'other', team_name: 'Other', is_active: true, staff_classification: 'normal', employeeNoString: 'DEVICE-77' },
]

test('report search matches full, partial, case-insensitive names, codes, and available biometric numbers', () => {
  assert.equal(reportWorkerMatchesSearch(workers[0], 'MUNIANGA'), true)
  assert.equal(reportWorkerMatchesSearch(workers[0], 'muni'), true)
  assert.equal(reportWorkerMatchesSearch(workers[0], '346'), true)
  assert.equal(reportWorkerMatchesSearch(workers[1], 'ABED'), true)
  assert.equal(reportWorkerMatchesSearch(workers[2], 'device-77'), true)
})

test('search combines with team and selected report date without changing attendance data', () => {
  const attendance = [{ worker_id: '1', attendance_date: '2026-09-16', check_in: '08:00:00' }]
  const original = structuredClone(attendance)
  const report = buildAbsenceReport({ workers, attendance, selectedDate: '2026-09-16', businessDate: '2026-09-16', teamId: 'paint', search: 'abed' })
  assert.deepEqual(report.groups.flatMap((group) => group.workers.map((worker) => worker.name)), ['Abed Karim'])
  assert.deepEqual(attendance, original)
})

test('search with no matching report workers produces an empty result', () => {
  const report = buildAbsenceReport({ workers, attendance: [], selectedDate: '2026-09-16', businessDate: '2026-09-16', search: 'not-found' })
  assert.equal(report.groups.length, 0)
  assert.equal(report.missingMorningWorkers, 0)
})

test('weekly screen, print, PDF, and Excel share the same searched row collection', async () => {
  const source = await readFile(new URL('./src/pages/WeeklyAttendanceReport.jsx', import.meta.url), 'utf8')
  assert.match(source, /reportWorkerMatchesSearch\(worker, weeklyFilters\.search\)/)
  assert.match(source, /weeklyReportRows\.map\(\(row\) =>/)
  assert.match(source, /const tableRows = exportRows/)
  assert.match(source, /aoa_to_sheet\(\[\[reportTitle\], \[\], exportHeaders, \.\.\.exportRows\]\)/)
  assert.match(source, /handleExportWeeklyPdf[\s\S]*handlePrintWeeklyReport\(\)/)
  assert.doesNotMatch(source, /Payroll/)
})

test('absence report print uses the same searched report rendered on screen', async () => {
  const source = await readFile(new URL('./src/pages/AbsenceReport.jsx', import.meta.url), 'utf8')
  assert.match(source, /buildAbsenceReport\(\{[\s\S]*search,/)
  assert.match(source, /window\.print\(\)/)
  assert.match(source, /search\.trim\(\) \? t\('common\.noResults'\)/)
})
