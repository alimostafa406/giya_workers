// @vitest-environment jsdom
import React from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SupervisorSheet from './SupervisorSheet.jsx'
import { LanguageProvider } from '../i18n/LanguageContext.jsx'

globalThis.React = React
const mocks = vi.hoisted(() => ({ workers: vi.fn(), teams: vi.fn(), attendance: vi.fn(), mappings: vi.fn(), save: vi.fn() }))
vi.mock('../api/workersApi', () => ({ getWorkersRequest: mocks.workers }))
vi.mock('../api/teamsApi', () => ({ getTeamsRequest: mocks.teams }))
vi.mock('../api/attendanceApi', () => ({ getAttendanceRequest: mocks.attendance }))
vi.mock('../api/biometricMappingApi', () => ({ getWorkerBiometricSearchIndexRequest: mocks.mappings }))
vi.mock('../api/supervisorMorningReviewApi', () => ({ saveSupervisorMorningReviewRequest: mocks.save }))
vi.mock('../store/authStore', () => ({ useAuthStore: (selector) => selector({ admin: { is_active: true } }) }))
vi.mock('../utils/attendanceOperationalGate', async (importOriginal) => ({ ...await importOriginal(), isAttendancePageLocked: () => false }))

beforeEach(() => {
  localStorage.setItem('workers_app_language', 'en')
  mocks.workers.mockResolvedValue({ data: [
    { id: 'one', full_name: 'ROBERT', employee_code: '79', team_id: 'paint', team_name: 'Peinture Raghibe', is_active: true, staff_classification: 'normal' },
    { id: 'two', full_name: 'NIVA', employee_code: '211', team_id: 'paint', team_name: 'Peinture Raghibe', is_active: true, staff_classification: 'normal' },
    { id: 'inactive', full_name: 'BAKA', employee_code: '20', team_id: 'paint', is_active: false, staff_classification: 'normal' },
    { id: 'other', full_name: 'AUGUSTINE', employee_code: '61', team_id: 'house', team_name: 'Maison', is_active: true, staff_classification: 'normal' },
  ] })
  mocks.teams.mockResolvedValue({ data: [
    { id: 'paint', name: 'Peinture Raghibe', is_active: true },
    { id: 'house', name: 'Maison', is_active: true },
  ] })
  mocks.mappings.mockResolvedValue({ data: [
    { worker_id: 'one', device_employee_no: '084', is_active: true, mapping_review_state: 'confirmed' },
    { worker_id: 'two', device_employee_no: '070', is_active: true, mapping_review_state: 'needs_review' },
  ] })
  mocks.attendance.mockImplementation(async ({ date }) => ({ data: [{ worker_id: 'two', attendance_date: date, check_in: '08:00:00' }] }))
  mocks.save.mockResolvedValue({ applied: 2 })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'print').mockImplementation(() => {})
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => window.setTimeout(() => callback(0), 0))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks() })

const showPaintTeam = async () => {
  const view = render(<MemoryRouter><LanguageProvider><SupervisorSheet /></LanguageProvider></MemoryRouter>)
  await screen.findByText('ROBERT')
  fireEvent.change(screen.getByRole('combobox', { name: 'Team' }), { target: { value: 'paint' } })
  return view
}

describe('supervisor attendance sheet', () => {
  it('refreshes before 11:00, performs one final check at 11:00, then stops', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-12T09:59:50Z'))
    render(<MemoryRouter><LanguageProvider><SupervisorSheet /></LanguageProvider></MemoryRouter>)
    await screen.findByText('ROBERT')
    expect(mocks.attendance).toHaveBeenCalledTimes(1)
    fireEvent.focus(window)
    await waitFor(() => expect(mocks.attendance).toHaveBeenCalledTimes(2))
    vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await waitFor(() => expect(mocks.attendance).toHaveBeenCalledTimes(3), { timeout: 2500 })
    expect(screen.getByText(/final morning review list is frozen/i)).toBeTruthy()
    fireEvent.focus(window)
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(mocks.attendance).toHaveBeenCalledTimes(3)
  })

  it('opens after 11:00 with one final load and never re-fetches on focus or print', async () => {
    render(<MemoryRouter><LanguageProvider><SupervisorSheet /></LanguageProvider></MemoryRouter>)
    await screen.findByText('ROBERT')
    expect(screen.getByText(/final morning review list is frozen/i)).toBeTruthy()
    expect(mocks.attendance).toHaveBeenCalledTimes(1)
    fireEvent.focus(window)
    fireEvent(document, new Event('visibilitychange'))
    fireEvent.click(screen.getByRole('button', { name: 'Print Results' }))
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1))
    expect(mocks.attendance).toHaveBeenCalledTimes(1)
  })

  it('blocks partial save, then saves all frozen workers by ID without writing attendance directly', async () => {
    await showPaintTeam()
    fireEvent.click(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'O' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Attendance Results' }))
    expect(screen.getByRole('alert').textContent).toContain('Workers without a result: 1')
    expect(mocks.save).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox', { name: 'Team' }), { target: { value: '' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'AUGUSTINE Result' })).getByRole('button', { name: 'M' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Attendance Results' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save).toHaveBeenCalledWith({
      date: expect.any(String), workerIds: ['other', 'one'], results: { other: 'M', one: 'O' },
    })
    expect(mocks.attendance).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Clear Results' }).disabled).toBe(true)
    expect(screen.getByText('Present - Working outside')).toBeTruthy()
    expect(screen.getByText('Absent - Medical')).toBeTruthy()
  })

  it('counts only missing-morning workers in the page total and each team', async () => {
    const { container } = render(<MemoryRouter><LanguageProvider><SupervisorSheet /></LanguageProvider></MemoryRouter>)
    await screen.findByText('ROBERT')
    const article = container.querySelector('.absence-report-print-root')
    expect(within(article).queryByText('NIVA')).toBeNull()
    expect(within(article).getByText('AUGUSTINE')).toBeTruthy()
    expect(article.querySelector('.absence-report-header').textContent).toContain('Worker count: 2')
    const groups = article.querySelectorAll('.absence-team-block')
    expect(groups).toHaveLength(2)
    expect([...groups].map((group) => group.querySelector('.absence-team-heading').textContent)).toEqual([
      'MaisonWorker count: 1', 'Peinture RaghibeWorker count: 1',
    ])
  })

  it('shows only selected-team missing-morning workers with exact biometric IDs and temporary A/P/O/M results', async () => {
    const { container } = await showPaintTeam()
    const article = container.querySelector('.absence-report-print-root')
    expect(within(article).getByText('ROBERT')).toBeTruthy()
    expect(within(article).queryByText('NIVA')).toBeNull()
    expect(within(article).queryByText('BAKA')).toBeNull()
    expect(within(article).queryByText('AUGUSTINE')).toBeNull()
    expect(within(article).getByText('084')).toBeTruthy()
    expect(mocks.attendance).toHaveBeenCalledWith(expect.objectContaining({ staff_classification: 'normal' }))
    const robertChoices = within(article).getByRole('group', { name: 'ROBERT Result' })
    fireEvent.click(within(robertChoices).getByRole('button', { name: 'P' }))
    expect(within(robertChoices).getByRole('button', { name: 'P' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(robertChoices).getByRole('button', { name: 'O' }))
    expect(within(robertChoices).getByRole('button', { name: 'O' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'P' }).getAttribute('aria-pressed')).toBe('false')
    expect(article.textContent).toContain('Worker count: 1')
  })

  it('prints blank results without choices, prints selected letters, and clears temporary state', async () => {
    const { container } = await showPaintTeam()
    const robertChoices = screen.getByRole('group', { name: 'ROBERT Result' })
    fireEvent.click(within(robertChoices).getByRole('button', { name: 'P' }))
    fireEvent.click(screen.getByRole('button', { name: 'Print Blank' }))
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1))
    expect(container.querySelector('[data-testid="printed-result-one"]').textContent).toBe('________')
    expect(container.querySelector('.absence-report-print-root').getAttribute('data-print-mode')).toBe('blank')

    fireEvent.click(screen.getByRole('button', { name: 'Print Results' }))
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(2))
    expect(container.querySelector('[data-testid="printed-result-one"]').textContent).toBe('P')
    expect(container.querySelector('[data-testid="printed-result-two"]')).toBeNull()
    expect(container.querySelectorAll('.supervisor-sheet-table thead th')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Clear Results' }))
    expect(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'P' }).getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('[data-testid="printed-result-one"]').textContent).toBe('________')
  })

  it('is linked from Attendance, has the protected route, and contains no database mutation path', () => {
    const page = readFileSync('./src/pages/SupervisorSheet.jsx', 'utf8')
    const css = readFileSync('./src/index.css', 'utf8')
    const router = readFileSync('./src/routes/AppRouter.jsx', 'utf8')
    const attendance = readFileSync('./src/pages/Attendance.jsx', 'utf8')
    expect(router).toContain('path="/attendance/supervisor-sheet" element={<SupervisorSheet />}')
    expect(attendance).toContain('to="/attendance/supervisor-sheet"')
    expect(page).not.toMatch(/saveAttendance|insert\(|update\(|upsert\(|delete\(|localStorage\.setItem/)
    expect(css).toMatch(/\.supervisor-sheet-screen-only\s*\{\s*display:\s*none\s*!important/)
    expect(css).toMatch(/\.supervisor-sheet-print-only\s*\{\s*display:\s*inline\s*!important/)
    expect(page).toContain('size: A4 portrait')
  })
})
