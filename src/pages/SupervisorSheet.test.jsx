// @vitest-environment jsdom
import React from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SupervisorSheet from './SupervisorSheet.jsx'
import { LanguageProvider } from '../i18n/LanguageContext.jsx'
import { buildSupervisorSheet } from '../utils/supervisorSheet'

globalThis.React = React
const mocks = vi.hoisted(() => ({ workers: vi.fn(), teams: vi.fn(), attendance: vi.fn(), mappings: vi.fn(), save: vi.fn(), history: vi.fn(), finalize: vi.fn(), status: vi.fn(), draft: vi.fn(), saveDraft: vi.fn() }))
vi.mock('../api/workersApi', () => ({ getWorkersRequest: mocks.workers }))
vi.mock('../api/teamsApi', () => ({ getTeamsRequest: mocks.teams }))
vi.mock('../api/attendanceApi', () => ({ getAttendanceRequest: mocks.attendance }))
vi.mock('../api/biometricMappingApi', () => ({ getWorkerBiometricSearchIndexRequest: mocks.mappings }))
vi.mock('../api/supervisorMorningReviewApi', () => ({ submitSupervisorDraftRequest: mocks.save, getSupervisorDraftRequest: mocks.draft, saveSupervisorDraftRequest: mocks.saveDraft, getHistoricalSupervisorReviewRequest: mocks.history, finalizeSupervisorReviewRequest: mocks.finalize, getMorningReportStatusRequest: mocks.status }))
vi.mock('../store/authStore', () => ({ useAuthStore: (selector) => selector({ admin: { is_active: true } }) }))
vi.mock('../utils/attendanceOperationalGate', async (importOriginal) => ({ ...await importOriginal(), isAttendancePageLocked: () => false }))

beforeEach(() => {
  mocks.draft.mockResolvedValue({ revision: 0, status: 'unsaved', results: {}, snapshot_token: 'population', official_token: 'official' })
  mocks.saveDraft.mockImplementation(async ({ context, results }) => ({ ...context, revision: context.revision + 1, status: 'draft', results, updated_at: new Date().toISOString() }))
  mocks.status.mockResolvedValue({ state: 'PROCESSING_AFTER_CUTOFF' })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T10:30:00Z'))
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
  mocks.save.mockResolvedValue({ applied: 2, revision: 2, status: 'finalized', updated_at: '2026-10-14T10:30:00Z' })
  mocks.history.mockImplementation(async (date) => ({ available: true, exact_population: true, read_only: false,
    workers: (await mocks.workers()).data, teams: (await mocks.teams()).data,
    attendance: (await mocks.attendance({ date })).data }))
  mocks.finalize.mockImplementation(async (date) => {
    const workers = (await mocks.workers()).data
    const attendance = (await mocks.attendance({ date, staff_classification: 'normal' })).data
    const sheet = buildSupervisorSheet({ workers, attendance, date })
    const ids = new Set(sheet.groups.flatMap((group) => group.workers.map((worker) => worker.id)))
    return { available: true, exact_population: true, read_only: false, workers: workers.filter((worker) => ids.has(worker.id)),
      attendance, teams: (await mocks.teams()).data }
  })
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
  it('defaults unresolved choices to A without saving a draft or official attendance', async () => {
    await showPaintTeam()
    expect(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'A' }).getAttribute('aria-pressed')).toBe('true')
    expect(mocks.saveDraft).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(screen.getByText('Unsaved draft')).toBeTruthy()
  })

  it.each(['P', 'O', 'M', 'A'])('official %s takes precedence over draft and default A', async (choice) => {
    mocks.attendance.mockResolvedValue({ data: [{ worker_id: 'one', attendance_date: '2026-10-14', manual_override: true,
      biometric_sync_metadata: { supervisor_morning_review: { source: 'supervisor_sheet', choice } } }] })
    mocks.draft.mockResolvedValue({ revision: 1, status: 'draft', results: { one: choice === 'P' ? 'O' : 'P' }, snapshot_token: 'population', official_token: 'official' })
    await showPaintTeam()
    expect(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: choice }).getAttribute('aria-pressed')).toBe('true')
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('saves all current draft choices without official writes and reloads them after remount', async () => {
    const view = await showPaintTeam()
    fireEvent.click(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'O' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await screen.findByText(/Draft saved/)
    expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ results: { other: 'A', one: 'O' } }))
    expect(mocks.save).not.toHaveBeenCalled()
    const persisted = await mocks.saveDraft.mock.results[0].value
    mocks.draft.mockResolvedValue(persisted)
    view.unmount()
    await showPaintTeam()
    expect(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'O' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(/Last saved/)).toBeTruthy()
  })

  it('persists the draft before a failed final save, keeps choices, restores them and permits retry', async () => {
    mocks.save.mockRejectedValueOnce(new Error('protected row'))
    const view = await showPaintTeam()
    fireEvent.click(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'P' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finalize Results' }))
    await screen.findByText('Final submission failed — your draft is saved and you can retry.')
    expect(mocks.saveDraft.mock.invocationCallOrder[0]).toBeLessThan(mocks.save.mock.invocationCallOrder[0])
    expect(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'P' }).getAttribute('aria-pressed')).toBe('true')
    const persisted = await mocks.saveDraft.mock.results[0].value
    expect(persisted.results).toEqual({ other: 'A', one: 'P' })
    mocks.draft.mockResolvedValue(persisted)
    view.unmount()
    await showPaintTeam()
    expect(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'P' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Finalize Results' }))
    await screen.findAllByText(/Results finalized/)
  })

  it('does not call final submit when draft save fails and preserves visible choices', async () => {
    mocks.saveDraft.mockRejectedValueOnce(new Error('offline'))
    await showPaintTeam()
    fireEvent.click(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'M' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finalize Results' }))
    await screen.findByText(/Draft save failed/)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'M' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('warns on concurrent/version conflict without clearing choices and reloads only on request', async () => {
    mocks.saveDraft.mockRejectedValueOnce({ code: '40001' })
    await showPaintTeam()
    fireEvent.click(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'O' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await screen.findByText(/changed in another session/)
    expect(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'O' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Finalize Results' }).disabled).toBe(true)
    mocks.draft.mockResolvedValue({ revision: 3, status: 'draft', results: { one: 'P' }, snapshot_token: 'new-population', official_token: 'new-official' })
    fireEvent.click(screen.getByRole('button', { name: 'Load Latest Draft' }))
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'P' }).getAttribute('aria-pressed')).toBe('true'))
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('defaults a 45-worker final population to A and submits without individual clicks', async () => {
    mocks.workers.mockResolvedValue({ data: Array.from({ length: 45 }, (_, i) => ({ id: `worker-${i}`, full_name: `WORKER ${i}`, team_id: 'paint', team_name: 'Peinture', is_active: true, staff_classification: 'normal' })) })
    render(<MemoryRouter><LanguageProvider><SupervisorSheet /></LanguageProvider></MemoryRouter>)
    await screen.findByText('WORKER 44')
    fireEvent.click(screen.getByRole('button', { name: 'Finalize Results' }))
    await screen.findAllByText(/Results finalized/)
    const choices = mocks.saveDraft.mock.calls[0][0].results
    expect(Object.keys(choices)).toHaveLength(45)
    expect(new Set(Object.values(choices))).toEqual(new Set(['A']))
  })

  it('canceling final confirmation performs no writes', async () => {
    window.confirm.mockReturnValueOnce(false)
    await showPaintTeam()
    fireEvent.click(screen.getByRole('button', { name: 'Finalize Results' }))
    expect(mocks.saveDraft).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('saves a historical editable draft using the selected date', async () => {
    render(<MemoryRouter><LanguageProvider><SupervisorSheet /></LanguageProvider></MemoryRouter>)
    await screen.findByText('ROBERT')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-13' } })
    await waitFor(() => expect(mocks.draft).toHaveBeenLastCalledWith('2026-10-13'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-10-13' })))
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('shows no worker list while verification runs and waits for shared backend FINAL', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const finalResponse = mocks.finalize.getMockImplementation()
    mocks.finalize.mockResolvedValue({ state: 'PROCESSING_AFTER_CUTOFF' })
    const { container } = render(<MemoryRouter><LanguageProvider><SupervisorSheet /></LanguageProvider></MemoryRouter>)
    await screen.findByText('جاري إكمال التحقق من البصمات...')
    expect(container.querySelector('.absence-report-print-root')).toBeNull()
    expect(screen.queryByText('ROBERT')).toBeNull()
    expect(screen.getByRole('button', { name: 'Print Results' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Finalize Results' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Save Draft' }).disabled).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(mocks.workers).not.toHaveBeenCalled()
    expect(mocks.attendance).not.toHaveBeenCalled()
    expect(mocks.finalize).toHaveBeenCalledTimes(1)
    mocks.finalize.mockImplementation(finalResponse)
    mocks.status.mockResolvedValue({ state: 'FINAL' })
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(screen.getByText('ROBERT')).toBeTruthy()
    const count = mocks.status.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(mocks.status).toHaveBeenCalledTimes(count)
  })
  it('uses the persisted historical IDs even when a worker is now inactive or has a check-in', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T10:30:00Z'))
    mocks.history.mockResolvedValue({ available: true, exact_population: true, read_only: false, teams: [{ id: 'paint', name: 'Paint' }],
      workers: [{ id: 'historic', full_name: 'FROZEN WORKER', is_active: false, team_id: 'paint', team_name: 'Paint', biometric_id: '022' }],
      attendance: [{ worker_id: 'historic', attendance_date: '2026-10-13', check_in: '08:00', manual_override: true,
        biometric_sync_metadata: { supervisor_morning_review: { source: 'supervisor_sheet', choice: 'P' } } }] })
    render(<MemoryRouter><LanguageProvider><SupervisorSheet /></LanguageProvider></MemoryRouter>)
    await screen.findByText('ROBERT')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-13' } })
    await screen.findByText('FROZEN WORKER')
    expect(screen.queryByText('ROBERT')).toBeNull()
    expect(screen.getByText('022')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'FROZEN WORKER Result' })).getByRole('button', { name: 'P' }).getAttribute('aria-pressed')).toBe('true')
  })
  it('labels unsnapshotted historical reconstruction on screen and print', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T10:30:00Z'))
    const original = mocks.history.getMockImplementation()
    mocks.history.mockImplementation(async (date) => ({ ...await original(date), reconstructed: true, exact_population: false }))
    const { container } = render(<MemoryRouter><LanguageProvider><SupervisorSheet /></LanguageProvider></MemoryRouter>)
    await screen.findByText('ROBERT')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-13' } })
    await screen.findAllByText('Reconstructed historical list — may not match the original final sheet')
    expect(container.querySelector('.absence-report-header').textContent).toContain('Reconstructed historical list')
  })
  it('shows historical payroll locks read-only without sending a save', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T10:30:00Z'))
    mocks.history.mockResolvedValue({ available: true, read_only: true, teams: [{ id: 'paint', name: 'Peinture' }],
      workers: [{ id: 'one', full_name: 'ROBERT', is_active: true, team_id: 'paint', team_name: 'Peinture', staff_classification: 'normal' }], attendance: [] })
    render(<MemoryRouter><LanguageProvider><SupervisorSheet /></LanguageProvider></MemoryRouter>)
    await screen.findByText('ROBERT')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-13' } })
    await screen.findByText(/Read-only: historical roster unavailable or payroll finalized\/paid/)
    expect(screen.getByRole('button', { name: 'Finalize Results' }).disabled).toBe(true)
    expect(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'P' }).disabled).toBe(true)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('has a real date picker, loads October 13 once, prints that date, and restores today freeze', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-14T10:30:00Z'))
    const { container } = render(<MemoryRouter><LanguageProvider><SupervisorSheet /></LanguageProvider></MemoryRouter>)
    await screen.findByText('ROBERT')
    const date = screen.getByLabelText('Date')
    expect(date.type).toBe('date'); expect(date.max).toBe('2026-10-14')
    fireEvent.change(date, { target: { value: '2026-10-15' } })
    expect(date.value).toBe('2026-10-14')
    fireEvent.change(date, { target: { value: '2026-10-13' } })
    await screen.findByText('Historical date review', { exact: false })
    await screen.findByText('ROBERT')
    expect(mocks.history).toHaveBeenLastCalledWith('2026-10-13')
    expect(container.querySelector('.absence-report-header').textContent).toContain('13/10/2026')
    expect(vi.getTimerCount()).toBe(0)
    fireEvent.focus(window); fireEvent(document, new Event('visibilitychange'))
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(mocks.history).toHaveBeenCalledTimes(1)
    window.requestAnimationFrame.mockImplementation((callback) => { callback(0); return 0 })
    expect(screen.getByRole('button', { name: 'Print Results' }).disabled).toBe(false)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Print Results' })) })
    expect(window.print).toHaveBeenCalledOnce()
    expect(container.querySelector('.absence-report-header').textContent).toContain('13/10/2026')
    fireEvent.change(date, { target: { value: '2026-10-14' } })
    await screen.findByText(/final morning review list is frozen/i)
    expect(mocks.attendance).toHaveBeenLastCalledWith(expect.objectContaining({ date: '2026-10-14' }))
  })
  it.each(['P', 'O', 'A', 'M'])('preloads only supervisor-origin %s and allows editing the saved choice', async (choice) => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T10:30:00Z'))
    mocks.history.mockResolvedValue({ available: true, exact_population: true, read_only: false, teams: [{ id: 'paint', name: 'Peinture' }],
      workers: [{ id: 'one', full_name: 'ROBERT', is_active: true, team_id: 'paint', team_name: 'Peinture', staff_classification: 'normal' }],
      attendance: [{ worker_id: 'one', attendance_date: '2026-10-13', check_in: choice === 'P' ? '08:00' : null, manual_override: true,
        biometric_sync_metadata: { supervisor_morning_review: { source: 'supervisor_sheet', choice } } }] })
    render(<MemoryRouter><LanguageProvider><SupervisorSheet /></LanguageProvider></MemoryRouter>)
    await screen.findByText('ROBERT')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-13' } })
    await screen.findByText('ROBERT')
    const group = screen.getByRole('group', { name: 'ROBERT Result' })
    expect(within(group).getByRole('button', { name: choice }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(group).getByRole('button', { name: 'O' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finalize Results' }))
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-10-13', results: { one: 'O' } })))
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-10-13' }))
  })
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

  it('defaults remaining workers to A and finalizes every team, not only the selected team', async () => {
    await showPaintTeam()
    fireEvent.click(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'O' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Team' }), { target: { value: '' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'AUGUSTINE Result' })).getByRole('button', { name: 'M' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finalize Results' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ results: { other: 'M', one: 'O' } }))
    expect(mocks.attendance).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Clear Results' }).disabled).toBe(false)
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
    expect(within(screen.getByRole('group', { name: 'ROBERT Result' })).getByRole('button', { name: 'A' }).getAttribute('aria-pressed')).toBe('true')
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
