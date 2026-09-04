import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildWeeklyReportDateRange,
  classifyWeeklyReportDay,
  getDefaultWeeklyReportRange,
  getWeeklyReportRange,
  normalizeWeeklyAttendanceStatus,
  shiftWeeklyReportRange,
  summarizeWeeklyAttendanceDays,
} from './src/utils/weeklyAttendanceReport.js'

const summarize = (dates, statuses, businessDate = '2026-08-26') => (
  summarizeWeeklyAttendanceDays({
    dates,
    businessDate,
    getStatus: (date) => statuses.get(date),
  })
)

test('anchors the report cycle to Sunday through Saturday', () => {
  assert.deepEqual(getDefaultWeeklyReportRange('2026-08-26'), {
    startDate: '2026-08-23',
    endDate: '2026-08-29',
  })
  assert.deepEqual(getDefaultWeeklyReportRange('2026-08-29'), {
    startDate: '2026-08-23',
    endDate: '2026-08-29',
  })
  assert.deepEqual(buildWeeklyReportDateRange('2026-08-23', '2026-08-29'), [
    '2026-08-23',
    '2026-08-24',
    '2026-08-25',
    '2026-08-26',
    '2026-08-27',
    '2026-08-28',
    '2026-08-29',
  ])
})

test('JEREMIE example does not turn Sunday, half-day, or future dates into absences', () => {
  const dates = buildWeeklyReportDateRange('2026-08-23', '2026-08-29')
  const statuses = new Map([
    ['2026-08-24', 'present'],
    ['2026-08-25', 'present'],
    ['2026-08-26', 'half_day'],
  ])
  const result = summarize(dates, statuses)

  assert.deepEqual(result.days.map((day) => day.status), [
    'sunday',
    'present',
    'present',
    'half_day',
    'future',
    'future',
    'future',
  ])
  assert.equal(result.presentDays, 2.5)
  assert.equal(result.absentDays, 0)
})

test('previous, current, and next ranges remain consecutive Sunday-Saturday weeks', () => {
  assert.deepEqual(getWeeklyReportRange('2026-08-26'), {
    startDate: '2026-08-23', endDate: '2026-08-29',
  })
  assert.deepEqual(shiftWeeklyReportRange('2026-08-23', -1), {
    startDate: '2026-08-16', endDate: '2026-08-22',
  })
  assert.deepEqual(shiftWeeklyReportRange('2026-08-23', 1), {
    startDate: '2026-08-30', endDate: '2026-09-05',
  })
})

test('only an explicit absence on a non-Sunday current or past date counts absent', () => {
  assert.equal(classifyWeeklyReportDay({
    date: '2026-08-25', status: 'absent', businessDate: '2026-08-26',
  }), 'absent')
  assert.equal(classifyWeeklyReportDay({
    date: '2026-08-27', status: 'absent', businessDate: '2026-08-26',
  }), 'future')
  assert.equal(classifyWeeklyReportDay({
    date: '2026-08-23', status: 'absent', businessDate: '2026-08-26',
  }), 'sunday')
  assert.equal(classifyWeeklyReportDay({
    date: '2026-08-26', status: undefined, businessDate: '2026-08-26',
  }), 'unresolved')
})

test('real Sunday work is displayed but contributes to neither normal total', () => {
  const dates = buildWeeklyReportDateRange('2026-08-23', '2026-08-29')
  const result = summarize(dates, new Map([['2026-08-23', 'present']]))

  assert.equal(result.days[0].status, 'sunday_present')
  assert.equal(result.presentDays, 0)
  assert.equal(result.absentDays, 0)
})

test('normalizes only established attendance states and invents no absence', () => {
  assert.equal(normalizeWeeklyAttendanceStatus('present'), 'present')
  assert.equal(normalizeWeeklyAttendanceStatus('late'), 'late')
  assert.equal(normalizeWeeklyAttendanceStatus('half_day'), 'half_day')
  assert.equal(normalizeWeeklyAttendanceStatus('absent'), 'absent')
  assert.equal(normalizeWeeklyAttendanceStatus('pending'), 'unresolved')
  assert.equal(normalizeWeeklyAttendanceStatus(undefined), 'unresolved')
})

test('late renders as half-day without checkout and present with genuine checkout', () => {
  const dates = ['2026-09-03']
  const unfinished = summarizeWeeklyAttendanceDays({
    dates,
    businessDate: '2026-09-03',
    getAttendance: () => ({ status: 'late', check_in: '08:14:24', check_out: null, attendance_day_fraction: 0.5 }),
  })
  const completed = summarizeWeeklyAttendanceDays({
    dates,
    businessDate: '2026-09-03',
    getAttendance: () => ({ status: 'late', check_in: '08:14:24', check_out: '17:05:00', attendance_day_fraction: 1 }),
  })

  assert.equal(unfinished.days[0].status, 'half_day')
  assert.equal(unfinished.presentDays, 0.5)
  assert.equal(unfinished.absentDays, 0)
  assert.equal(completed.days[0].status, 'present')
  assert.equal(completed.presentDays, 1)
  assert.equal(completed.absentDays, 0)
})

test('present, half-day, and absent remain distinct while late derives from checkout', () => {
  assert.equal(classifyWeeklyReportDay({ date: '2026-09-03', status: 'present', businessDate: '2026-09-03' }), 'present')
  assert.equal(classifyWeeklyReportDay({ date: '2026-09-03', status: 'late', checkOut: null, businessDate: '2026-09-03' }), 'half_day')
  assert.equal(classifyWeeklyReportDay({ date: '2026-09-03', status: 'late', checkOut: '17:05:00', businessDate: '2026-09-03' }), 'present')
  assert.equal(classifyWeeklyReportDay({ date: '2026-09-03', status: 'half_day', businessDate: '2026-09-03' }), 'half_day')
  assert.equal(classifyWeeklyReportDay({ date: '2026-09-03', status: 'absent', businessDate: '2026-09-03' }), 'absent')
})

test('Zarour current-day fixture renders all seven unfinished workers as half-day', () => {
  const attendance = new Map([
    ['IGNACE', { status: 'half_day', check_out: null, attendance_day_fraction: 0.5 }],
    ['JOSUE', { status: 'late', check_out: null, attendance_day_fraction: 0.5 }],
    ['MBOMBA', { status: 'late', check_out: null, attendance_day_fraction: 0.5 }],
    ['RICHARD1', { status: 'half_day', check_out: null, attendance_day_fraction: 0.5 }],
    ['ROBERT', { status: 'half_day', check_out: null, attendance_day_fraction: 0.5 }],
    ['MERVEILLE 2', { status: 'half_day', check_out: null, attendance_day_fraction: 0.5 }],
    ['JEREMIE', { status: 'half_day', check_out: null, attendance_day_fraction: 0.5 }],
  ])
  const rows = [...attendance].map(([worker, row]) => ({
    worker,
    day: summarizeWeeklyAttendanceDays({ dates: ['2026-09-03'], businessDate: '2026-09-03', getAttendance: () => row }).days[0],
  }))

  assert.equal(rows.filter((row) => row.day.status === 'present').length, 0)
  assert.equal(rows.filter((row) => row.day.status === 'half_day').length, 7)
})

test('completed historical ranges count recorded states without treating missing rows as absent', () => {
  const dates = buildWeeklyReportDateRange('2026-08-16', '2026-08-22')
  const statuses = new Map([
    ['2026-08-17', 'present'],
    ['2026-08-18', 'half_day'],
    ['2026-08-19', 'absent'],
    ['2026-08-20', 'absent'],
    ['2026-08-22', 'present'],
  ])
  const result = summarize(dates, statuses, '2026-08-26')

  assert.equal(result.presentDays, 2.5)
  assert.equal(result.absentDays, 2)
  assert.equal(result.days.find((day) => day.date === '2026-08-21').status, 'unresolved')
})

test('screen, print, PDF, and Excel use the same calculated report and export rows', async () => {
  const source = await readFile(new URL('./src/pages/WeeklyAttendanceReport.jsx', import.meta.url), 'utf8')

  assert.match(source, /summarizeWeeklyAttendanceDays\(\{/)
  assert.match(source, /buildWeeklyReportDateRange\(weeklyFilters\.startDate, weeklyFilters\.endDate\)/)
  assert.match(source, /shiftWeeklyReportRange\(weeklyFilters\.startDate, weekOffset\)/)
  assert.match(source, /reportBaseTitle.*weeklyFilters\.startDate.*weeklyFilters\.endDate/s)
  assert.doesNotMatch(source, /\|\|\s*['"]absent['"]/)
  assert.match(source, /data=\{weeklyReportRows\}/)
  assert.doesNotMatch(source, /return t\('attendance\.late'\)/)
  assert.match(source, /const tableRows = exportRows/)
  assert.match(source, /<html dir="\$\{language === 'ar' \? 'rtl' : 'ltr'\}">/)
  assert.match(source, /const handleExportWeeklyPdf = \(\) => \{[\s\S]*handlePrintWeeklyReport\(\)[\s\S]*\}/)
  assert.doesNotMatch(source, /new jsPDF|autoTable\(doc/)
  assert.match(source, /exportHeaders, \.\.\.exportRows/)
})
