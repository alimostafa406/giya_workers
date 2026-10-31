// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import WeeklyAttendanceReport from './WeeklyAttendanceReport'
import { LanguageProvider } from '../i18n/LanguageContext'
import { getDefaultWeeklyReportRange } from '../utils/weeklyAttendanceReport'
import { outsideWorkMarkerLabels } from '../utils/outsideWorkTeamMarkers'
globalThis.React = React
const mocks = vi.hoisted(() => ({ movements: vi.fn() }))
vi.mock('../api/outsideWorkApi', () => ({ getOutsideWorkMovements: mocks.movements }))
vi.mock('../api/teamsApi', () => ({ getTeamsRequest: vi.fn(async () => ({ data: [
  { id: 'siraj', name: 'Siraj', is_active: true }, { id: 'mostafa', name: 'Mostafa', is_active: true }] })) }))
vi.mock('../api/workersApi', () => ({ getWorkersRequest: vi.fn(async () => ({ data: [{ id: 'w', full_name: 'Visitor',
  employee_code: '23', team_id: 'siraj', team_name: 'Siraj', is_active: true, staff_classification: 'normal' }] })) }))
vi.mock('../api/attendanceApi', () => ({ getAttendanceRequest: vi.fn(async () => ({ data: [] })) }))
vi.mock('../api/weeklyAttendanceReviewApi', () => ({ reviewWeeklyAttendanceRequest: vi.fn() }))
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })
it('weekly attendance uses the same dated informational projection without changing permanent roster rows', async () => {
  const range = getDefaultWeeklyReportRange()
  mocks.movements.mockResolvedValue([{ id: 'm', status: 'final', team_id: 'mostafa', team: { name: 'Mostafa' },
    work_date: range.startDate, outside_work_movement_workers: [{ worker_id: 'w' }] }])
  render(<LanguageProvider><WeeklyAttendanceReport /></LanguageProvider>)
  await screen.findByRole('option', { name: 'Mostafa' })
  const team = screen.getAllByRole('combobox').find((select) => [...select.options].some((option) => option.value === 'mostafa'))
  fireEvent.change(team, { target: { value: 'mostafa' } })
  const markers = await screen.findByRole('region', { name: outsideWorkMarkerLabels.ar.title })
  const row = within(markers).getByText('Visitor').closest('tr')
  expect([...row.cells].slice(3).map((cell) => cell.textContent)).toEqual(['O', '—', '—', '—', '—', '—'])
  expect(mocks.movements).toHaveBeenCalledWith(range.startDate, range.endDate, { reportStatus: 'final' })
  fireEvent.change(team, { target: { value: 'siraj' } })
  await waitFor(() => expect(screen.queryByRole('region', { name: outsideWorkMarkerLabels.ar.title })).toBeNull())
  expect(screen.getByText('Visitor')).not.toBeNull()
})
