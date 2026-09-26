// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DailyAttendanceSummary from './src/components/Attendance/DailyAttendanceSummary.jsx'
import { dailyReportData } from './src/utils/dailyReportCenter.js'
import { attendanceRosterCategory, dailyAttendanceBucket, summarizeDailyAttendanceRoster } from './src/utils/attendanceRoster.js'

afterEach(cleanup)
const date = '2026-09-26'
const worker = (id) => ({ id, full_name: id, employee_code: id, is_active: true, staff_classification: 'normal', team: { name: 'Maison' } })
const workers = ['present-worker', 'IGNACE', 'absent-worker', 'no-row', 'pending-worker'].map(worker)
const attendance = [
  { worker_id: 'present-worker', status: 'present', check_in: '07:00:00', check_out: null, attendance_day_fraction: 1 },
  { worker_id: 'IGNACE', status: 'half_day', check_in: '09:27:50', check_out: null },
  { worker_id: 'absent-worker', status: 'absent', check_in: null, check_out: null },
  { worker_id: 'pending-worker', status: 'in_progress', check_in: '08:00:00', check_out: null },
].map((row) => ({ ...row, id: row.worker_id, attendance_date: date, worker: workers.find((w) => w.id === row.worker_id), team_name: 'Maison' }))
const data = dailyReportData({ date, businessDate: date, workers, attendance })
const dictionary = { 'dashboard.presentToday': 'Present', 'dashboard.halfDay': 'Half day', 'dashboard.absentToday': 'Absent', 'dashboard.notRecorded': 'Not recorded', 'dashboard.totalWorkers': 'Total', 'common.details': 'Details', 'workers.employeeCode': 'Employee code' }
const t = (key) => dictionary[key] || key
const labels = { worker: 'Worker', biometric: 'Biometric ID', team: 'Team', status: 'Status', in: 'Check-in', out: 'Check-out', last: 'Last punch', noRows: 'No results' }
const setup = () => render(<MemoryRouter><DailyAttendanceSummary rows={data.monitoringRows} counts={data.monitoringCounts} labels={labels} t={t} /></MemoryRouter>)
const click = (label) => fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }))
const listedWorkers = () => [...screen.getByRole('table').querySelectorAll('tbody tr')].map((row) => row.cells[0].textContent)

test('Half-day card shows exactly the half-day worker and its selected state', () => {
  setup(); click('Half day')
  expect(listedWorkers()).toEqual(['IGNACE'])
  expect(screen.getByRole('button', { name: /Half day/ }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: /Half day/ }).className).toContain('ring-2')
  expect(screen.getByRole('link', { name: 'Details' }).getAttribute('href')).toBe('/worker-control-center/worker/IGNACE')
})

test('Not recorded includes missing rows and unfinished statuses without changing their canonical data', () => {
  setup(); click('Not recorded')
  expect(listedWorkers()).toEqual(['no-row', 'pending-worker'])
  expect(within(screen.getByRole('table')).getByText('attendance.inProgress')).toBeTruthy()
  expect(attendance.find((row) => row.worker_id === 'pending-worker').status).toBe('in_progress')
})

test('Present card shows exactly present workers, including Saturday one-punch full-day attendance', () => {
  setup(); click('Present')
  expect(listedWorkers()).toEqual(['present-worker'])
  expect(attendance[0].check_out).toBeNull()
  expect(data.overtime).toHaveLength(0)
})

test('Total card shows the same complete operational roster used for all counts', () => {
  setup(); click('Total')
  expect(listedWorkers()).toHaveLength(5)
  const counts = data.monitoringCounts
  expect(counts.present + counts.half_day + counts.absent + counts.not_recorded).toBe(counts.total)
  expect(data.monitoringRows).toHaveLength(counts.total)
})

test('Absent filter does not include current no-row workers', () => {
  setup(); click('Absent')
  expect(listedWorkers()).toEqual(['absent-worker'])
})

test('review, unknown, and null outcomes remain inspectable in the not-recorded summary bucket', () => {
  for (const row of [{ status: 'pending' }, { status: 'in_progress' }, { status: null, roster_state: 'biometric_pending' }, { status: 'unexpected' }]) {
    expect(dailyAttendanceBucket(row)).toBe('not_recorded')
  }
})

test('a biometric-pending worker cannot disappear between the total and the four summary buckets', () => {
  const snapshot = [
    ...Array.from({ length: 188 }, () => ({ status: 'present' })),
    { status: 'half_day' },
    ...Array.from({ length: 22 }, () => ({ status: null, roster_state: 'not_recorded' })),
    { status: null, roster_state: 'biometric_pending' },
  ]
  expect(attendanceRosterCategory(snapshot.at(-1))).toBe('review')
  const counts = summarizeDailyAttendanceRoster(snapshot)
  expect(counts).toEqual({ total: 212, present: 188, half_day: 1, absent: 0, not_recorded: 23 })
  expect(counts.present + counts.half_day + counts.absent + counts.not_recorded).toBe(counts.total)
  expect(snapshot.at(-1).status).toBeNull()
})

test('eligibility exclusions apply equally to all cards and lists', () => {
  const excluded = [
    { ...worker('admin'), team: { name: 'Adminstration' } },
    { ...worker('inactive'), is_active: false },
    { ...worker('special'), staff_classification: 'special_staff' },
    { ...worker('future-start'), operational_start_date: '2026-09-28' },
  ]
  const result = dailyReportData({ date, workers: [...workers, ...excluded], attendance })
  expect(result.monitoringCounts).toEqual(data.monitoringCounts)
  expect(result.monitoringRows.map((row) => row.workerId)).not.toContain('admin')
})
