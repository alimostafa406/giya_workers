// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AbsenceReport from './AbsenceReport.jsx'
import { LanguageProvider } from '../i18n/LanguageContext.jsx'

globalThis.React = React
const mocks = vi.hoisted(() => ({ workers: vi.fn(), teams: vi.fn(), attendance: vi.fn(), mappings: vi.fn(), finalize: vi.fn(), history: vi.fn() }))
vi.mock('../api/supervisorMorningReviewApi', () => ({ finalizeSupervisorReviewRequest: mocks.finalize, getHistoricalSupervisorReviewRequest: mocks.history }))
vi.mock('../api/workersApi', () => ({ getWorkersRequest: mocks.workers }))
vi.mock('../api/teamsApi', () => ({ getTeamsRequest: mocks.teams }))
vi.mock('../api/attendanceApi', () => ({ getAttendanceRequest: mocks.attendance }))
vi.mock('../api/biometricMappingApi', () => ({ getWorkerBiometricSearchIndexRequest: mocks.mappings }))

beforeEach(() => {
  mocks.history.mockResolvedValue({ exact_population: false })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-19T09:30:00Z'))
  localStorage.setItem('workers_app_language', 'en')
  mocks.workers.mockResolvedValue({ data: [
    { id: 'mapped', full_name: 'NIVA', employee_code: '211', team_id: 'team', team_name: 'Cleaner', team: { id: 'team', name: 'Cleaner' }, is_active: true, staff_classification: 'normal' },
    { id: 'unmapped', full_name: 'JOHN', employee_code: '212', team_id: 'team', team_name: 'Cleaner', team: { id: 'team', name: 'Cleaner' }, is_active: true, staff_classification: 'normal' },
  ] })
  mocks.teams.mockResolvedValue({ data: [{ id: 'team', name: 'Cleaner', is_active: true }] })
  mocks.attendance.mockResolvedValue({ data: [] })
  mocks.mappings.mockResolvedValue({ data: [
    { worker_id: 'mapped', device_employee_no: '064', is_active: true, mapping_review_state: 'confirmed' },
    { worker_id: 'unmapped', device_employee_no: '084', is_active: true, mapping_review_state: 'needs_review' },
  ] })
  mocks.finalize.mockImplementation(async () => ({ available: true, exact_population: true,
    workers: (await mocks.workers()).data, teams: (await mocks.teams()).data, attendance: [] }))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })

describe('absence-report 11:00 Kinshasa freeze', () => {
  it('uses persisted historical IDs even when a later punch exists', async () => {
    mocks.history.mockResolvedValue({ available: true, exact_population: true,
      workers: [{ id: 'late', full_name: 'HISTORICAL LATE PUNCH', employee_code: 'late', team_id: 'team', team_name: 'Cleaner', biometric_id: '045' }],
      teams: [{ id: 'team', name: 'Cleaner' }], attendance: [{ worker_id: 'late', attendance_date: '2026-10-13', check_in: '11:01:00' }] })
    const { container } = render(<MemoryRouter><LanguageProvider><AbsenceReport /></LanguageProvider></MemoryRouter>)
    await screen.findByText('NIVA')
    fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: '2026-10-13' } })
    await screen.findByText('HISTORICAL LATE PUNCH')
    expect(mocks.history).toHaveBeenCalledWith('2026-10-13')
  })
  it('keeps provisional list stable before 11:00, performs one persisted final load, then stops', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-12T09:58:30Z'))
    const { container } = render(<MemoryRouter><LanguageProvider><AbsenceReport /></LanguageProvider></MemoryRouter>)
    await screen.findByText('NIVA')
    expect(mocks.attendance).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(mocks.attendance).toHaveBeenCalledTimes(1)
    fireEvent.focus(window)
    expect(mocks.attendance).toHaveBeenCalledTimes(1)
    const workerCount = container.querySelectorAll('.absence-worker-card').length
    vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    await waitFor(() => expect(mocks.finalize).toHaveBeenCalledTimes(1))
    fireEvent.focus(window)
    fireEvent(document, new Event('visibilitychange'))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(mocks.attendance).toHaveBeenCalledTimes(1)
    expect(mocks.finalize).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('.absence-worker-card')).toHaveLength(workerCount)
  })

  it('opens after 11:00 with one load and ignores later focus, visibility, and polling', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-12T10:15:00Z'))
    render(<MemoryRouter><LanguageProvider><AbsenceReport /></LanguageProvider></MemoryRouter>)
    await screen.findByText('NIVA')
    expect(mocks.attendance).not.toHaveBeenCalled()
    expect(mocks.finalize).toHaveBeenCalledWith('2026-10-12')
    fireEvent.focus(window)
    fireEvent(document, new Event('visibilitychange'))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(mocks.attendance).not.toHaveBeenCalled()
    expect(mocks.finalize).toHaveBeenCalledTimes(1)
  })

  it('keeps IBRAHIM2 at 10:58 until finalization, then uses persisted IDs even when later evidence changes', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-19T09:30:00Z'))
    const ibrahim = { id: 'ibrahim', full_name: 'IBRAHIM2', employee_code: '153', team_id: 'team', team_name: 'Peinture Raghibe', is_active: true, staff_classification: 'normal' }
    const missing = { ...ibrahim, id: 'later', full_name: 'LATER PUNCH' }
    mocks.workers.mockResolvedValue({ data: [ibrahim, missing] })
    mocks.finalize.mockResolvedValue({ available: true, exact_population: true, workers: [missing], teams: [], attendance: [] })
    render(<MemoryRouter><LanguageProvider><AbsenceReport /></LanguageProvider></MemoryRouter>)
    await screen.findByText('IBRAHIM2')
    mocks.attendance.mockResolvedValue({ data: [{ worker_id: 'ibrahim', attendance_date: '2026-10-19', check_in: '10:58:25' }] })
    vi.setSystemTime(new Date('2026-10-19T09:58:25Z'))
    fireEvent.focus(window)
    fireEvent(document, new Event('visibilitychange'))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(screen.getByText('IBRAHIM2')).toBeTruthy()
    expect(mocks.attendance).toHaveBeenCalledTimes(1)
    expect(mocks.finalize).not.toHaveBeenCalled()
    vi.setSystemTime(new Date('2026-10-19T10:00:00Z'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    await waitFor(() => expect(screen.queryByText('IBRAHIM2')).toBeNull())
    expect(screen.getByText('LATER PUNCH')).toBeTruthy()
    expect(mocks.finalize).toHaveBeenCalledWith('2026-10-19')
    mocks.attendance.mockResolvedValue({ data: [{ worker_id: 'later', attendance_date: '2026-10-19', check_in: '11:01:00' }] })
    fireEvent.focus(window)
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(screen.getByText('LATER PUNCH')).toBeTruthy()
    expect(mocks.finalize).toHaveBeenCalledTimes(1)
    expect(mocks.attendance).toHaveBeenCalledTimes(1)
  })
})

describe('absence-report Biometric ID display', () => {
  it('shows confirmed IDs and fallback in the same printable today layout without changing counts', async () => {
    const { container } = render(<MemoryRouter><LanguageProvider><AbsenceReport /></LanguageProvider></MemoryRouter>)
    fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: '2026-09-03' } })
    const article = container.querySelector('.absence-report-print-root')
    await waitFor(() => expect(within(article).getByText('#064')).toBeTruthy())
    const cards = [...article.querySelectorAll('.absence-worker-card')]
    expect(cards).toHaveLength(2)
    expect(cards.find((card) => card.textContent.includes('NIVA')).textContent).toContain('211#064')
    expect(cards.find((card) => card.textContent.includes('JOHN')).textContent).toContain('—')
    expect(article.textContent).not.toContain('Biometric ID:')
    expect(article.textContent).toContain('Workers missing a morning punch')
  })

  it('renders compact #14, #070, and #084 without numeric conversion', async () => {
    mocks.workers.mockResolvedValue({ data: ['14', '070', '084'].map((id) => ({
      id, full_name: `WORKER ${id}`, employee_code: id, team_id: 'team', team_name: 'Cleaner',
      team: { id: 'team', name: 'Cleaner' }, is_active: true, staff_classification: 'normal',
    })) })
    mocks.mappings.mockResolvedValue({ data: ['14', '070', '084'].map((id) => ({
      worker_id: id, device_employee_no: id, is_active: true, mapping_review_state: 'confirmed',
    })) })
    const { container } = render(<MemoryRouter><LanguageProvider><AbsenceReport /></LanguageProvider></MemoryRouter>)
    fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: '2026-09-03' } })
    await waitFor(() => expect(container.querySelectorAll('.absence-worker-card')).toHaveLength(3))
    const article = container.querySelector('.absence-report-print-root')
    for (const id of ['14', '070', '084']) expect(within(article).getByText(`#${id}`)).toBeTruthy()
  })

  it('places Biometric ID immediately after Employee Code in the printable week table', async () => {
    const { container } = render(<MemoryRouter><LanguageProvider><AbsenceReport /></LanguageProvider></MemoryRouter>)
    fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: '2026-09-03' } })
    fireEvent.click(screen.getByRole('button', { name: 'This week' }))
    await waitFor(() => expect(container.querySelectorAll('.absence-week-table tbody tr')).toHaveLength(2))
    const table = container.querySelector('.absence-report-print-root .absence-week-table')
    expect([...table.querySelectorAll('thead th')].slice(0, 3).map((cell) => cell.textContent)).toEqual(['Worker', 'Employee code', 'Biometric ID'])
    const rows = [...table.querySelectorAll('tbody tr')]
    expect(rows.find((row) => row.textContent.includes('NIVA')).querySelectorAll('td')[2].textContent).toBe('064')
    expect(rows.find((row) => row.textContent.includes('JOHN')).querySelectorAll('td')[2].textContent).toBe('—')
  })
})
