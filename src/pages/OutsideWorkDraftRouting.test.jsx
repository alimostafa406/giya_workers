// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { LanguageProvider } from '../i18n/LanguageContext'
import OutsideWork from './OutsideWork'

globalThis.React = React
const api = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }))
vi.mock('../api/outsideWorkApi', () => ({
  getOutsideWorkMovements: api.list, saveOutsideWorkMovement: api.save,
  getOutsideWorkTeams: async () => [{ id: 'team', name: 'TEAM' }],
  getOutsideWorkAttendanceConflicts: async () => [], deleteOutsideWorkMovement: vi.fn(),
}))
vi.mock('../api/workersApi', () => ({ getWorkersRequest: async () => ({ data: [
  { id: 'foreman', full_name: 'FOREMAN', is_active: true, staff_classification: 'special_staff' },
  { id: 'worker', full_name: 'WORKER', is_active: true, team_id: 'team', staff_classification: 'normal' },
] }) }))
vi.mock('../api/biometricMappingApi', () => ({ getWorkerBiometricSearchIndexRequest: async () => ({ data: [] }) }))
vi.mock('../utils/attendanceOperationalGate', () => ({ kinshasaClock: () => ({ date: '2026-10-22' }) }))

const oldId = '93716154-d387-4f2e-8c19-f8d3bc1f7e59'
const newId = 'new-oct22'
const draft = (id, date, end) => ({ id, work_date: date, status: 'draft', team_id: 'team',
  team: { id: 'team', name: 'TEAM' }, foreman_worker_id: 'foreman', foreman_name: 'FOREMAN',
  start_time: '08:00:00', end_time: end, common_worker_start: '09:00:00', common_worker_end: '16:00:00',
  updated_at: `${date}T10:00:00Z`, outside_work_movement_workers: [
    { worker_id: 'worker', worker_name: 'WORKER', start_time: '09:00:00', end_time: '16:00:00' },
  ] })
const drafts = [draft(oldId, '2026-10-19', '18:00:00'), draft(newId, '2026-10-22', '20:00:00')]
function LocationControls() {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-testid="location">{location.pathname}{location.search}</output>
    <button onClick={() => navigate(`/outside-work?draft=${oldId}`)}>Open old URL</button>
    <button onClick={() => navigate(`/outside-work?draft=${newId}`)}>Open new URL</button></>
}
const open = (query = '') => render(<MemoryRouter initialEntries={[`/outside-work${query}`]}>
  <LanguageProvider><LocationControls /><OutsideWork /></LanguageProvider>
</MemoryRouter>)
const expectDate = async (date) => waitFor(() => expect(screen.getByLabelText('Date').value).toBe(date))
const expectUrl = (id) => expect(screen.getByTestId('location').textContent).toBe(`/outside-work?draft=${id}`)
beforeEach(() => {
  localStorage.setItem('workers_app_language', 'en')
  sessionStorage.clear()
  api.list.mockReset().mockImplementation(async () => structuredClone(drafts))
  api.save.mockReset()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('explicit old URL beats newer session resume and preserves all hydrated fields after async week reload', async () => {
  sessionStorage.setItem('outside_work_resume_draft', newId)
  open(`?draft=${oldId}`)
  await expectDate('2026-10-19')
  await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThanOrEqual(2))
  const form = screen.getByRole('form')
  await waitFor(() => expect(form.querySelector('fieldset').disabled).toBe(false))
  expect(within(form).getByLabelText('Foreman End').value).toBe('18:00')
  expect(within(form).getByLabelText('Workers Start').value).toBe('09:00')
  expect(within(form).getByRole('button', { name: 'Remove worker: WORKER' })).toBeTruthy()
  expectUrl(oldId)
  fireEvent.focus(window)
  fireEvent(window, new Event('focus'))
  fireEvent(document, new Event('visibilitychange'))
  fireEvent.click(screen.getByRole('tab', { name: 'Reports' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Record movements' }))
  await expectDate('2026-10-19')
  expectUrl(oldId)
  expect(api.save).not.toHaveBeenCalled()
})

it('reacts to a changed explicit URL without remounting or retaining the newer draft', async () => {
  open(`?draft=${newId}`)
  await expectDate('2026-10-22')
  await screen.findByRole('heading', { name: 'Edit outside-work movement' })
  fireEvent.click(screen.getByRole('button', { name: 'Open old URL' }))
  await expectDate('2026-10-19')
  expectUrl(oldId)
  fireEvent.click(screen.getByRole('button', { name: 'Open new URL' }))
  await expectDate('2026-10-22')
  expectUrl(newId)
})

it('keeps the current explicit URL authoritative while the initial fetch is pending', async () => {
  let resolve
  api.list.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  open(`?draft=${newId}`)
  fireEvent.click(screen.getByRole('button', { name: 'Open old URL' }))
  resolve(structuredClone(drafts))
  await expectDate('2026-10-19')
  expectUrl(oldId)
})

it('refresh/remount restores the exact old draft from the URL', async () => {
  const first = open(`?draft=${oldId}`)
  await expectDate('2026-10-19')
  first.unmount()
  sessionStorage.setItem('outside_work_resume_draft', newId)
  open(`?draft=${oldId}`)
  await expectDate('2026-10-19')
  expectUrl(oldId)
})

it('Continue on either draft hydrates that exact draft and synchronizes the URL', async () => {
  open(`?draft=${newId}`)
  await screen.findByRole('heading', { name: 'Edit outside-work movement' })
  const buttons = await screen.findAllByRole('button', { name: 'Continue' })
  fireEvent.click(buttons[1]) // newest-first cards: Oct 22, Oct 19
  await expectDate('2026-10-19')
  expectUrl(oldId)
  fireEvent.click(screen.getAllByRole('button', { name: 'Continue' })[0])
  await expectDate('2026-10-22')
  expectUrl(newId)
})

it('starting a new movement clears the query and pending session resume intentionally', async () => {
  sessionStorage.setItem('outside_work_resume_draft', newId)
  open(`?draft=${oldId}`)
  await expectDate('2026-10-19')
  await waitFor(() => expect(screen.getByRole('form').querySelector('fieldset').disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
  expect(screen.getByTestId('location').textContent).toBe('/outside-work')
  expect(sessionStorage.getItem('outside_work_resume_draft')).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Edit outside-work movement' })).toBeNull()
  fireEvent(window, new Event('focus'))
  expect(screen.queryByRole('heading', { name: 'Edit outside-work movement' })).toBeNull()
  expect(api.save).not.toHaveBeenCalled()
})

it('retains the existing session-resume default only without an explicit draft URL', async () => {
  sessionStorage.setItem('outside_work_resume_draft', newId)
  open()
  await screen.findByRole('heading', { name: 'Edit outside-work movement' })
  await expectDate('2026-10-22')
  expectUrl(newId)
})

it('does not silently substitute the latest draft for an unknown explicit ID', async () => {
  sessionStorage.setItem('outside_work_resume_draft', newId)
  open('?draft=missing')
  await screen.findByRole('option', { name: 'TEAM' })
  expect(screen.queryByRole('heading', { name: 'Edit outside-work movement' })).toBeNull()
  expectUrl('missing')
})
