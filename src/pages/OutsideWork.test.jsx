// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { LanguageProvider } from '../i18n/LanguageContext'
import OutsideWork from './OutsideWork'

globalThis.React = React
const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), remove: vi.fn(), workers: vi.fn(), teams: vi.fn(), mappings: vi.fn() }))
vi.mock('../api/outsideWorkApi', () => ({ getOutsideWorkMovements: mocks.list,
  getOutsideWorkTeams: mocks.teams, saveOutsideWorkMovement: mocks.save, deleteOutsideWorkMovement: mocks.remove }))
vi.mock('../api/workersApi', () => ({ getWorkersRequest: mocks.workers }))
vi.mock('../api/biometricMappingApi', () => ({ getWorkerBiometricSearchIndexRequest: mocks.mappings }))
vi.mock('../utils/attendanceOperationalGate', () => ({ kinshasaClock: () => ({ date: '2026-10-14' }) }))

const roster = [
  { id: 'foreman', full_name: 'FOREMAN', employee_code: '900', is_active: true, staff_classification: 'special_staff' },
  { id: 'robert', full_name: 'ROBERT', employee_code: '79', is_active: true, staff_classification: 'normal', team_id: 'paint', team_name: 'Peinture' },
  { id: 'richard', full_name: 'RICHARD', employee_code: '80', is_active: true, staff_classification: 'normal', payment_type: 'monthly', team_id: 'paint', team_name: 'Peinture' },
  { id: 'inactive', full_name: 'INACTIVE WORKER', is_active: false, staff_classification: 'normal', team_id: 'paint', team_name: 'Peinture' },
  { id: 'future', full_name: 'FUTURE WORKER', is_active: true, operational_start_date: '2026-10-15', staff_classification: 'normal', team_id: 'paint', team_name: 'Peinture' },
  { id: 'jeremie', full_name: 'JEREMIE', employee_code: '100', is_active: true, staff_classification: 'normal', team_id: 'montage', team_name: 'Montage' },
]
const movement = { id: 'movement-1', work_date: '2026-10-13', team_id: 'paint', team: { id: 'paint', name: 'Peinture' },
  status: 'final', foreman_worker_id: 'foreman', foreman_name: 'FOREMAN', start_time: '08:00:00',
  end_time: '20:00:00', note: '', common_worker_start: '09:00', common_worker_end: '17:00',
  outside_work_movement_workers: [{ id: 'child-1', worker_id: 'robert', worker_name: 'ROBERT', start_time: '09:00:00', end_time: '17:00:00' }] }
let persisted
beforeEach(() => {
  localStorage.setItem('workers_app_language', 'en')
  sessionStorage.clear()
  persisted = [structuredClone(movement)]
  mocks.list.mockImplementation(async () => structuredClone(persisted))
  mocks.save.mockImplementation(async (values) => {
    const id = values.id || 'draft-new'
    const row = { ...structuredClone(values), id, updated_at: '2026-10-14T10:00:00Z',
      team: values.team_id ? { id: values.team_id, name: values.team_id === 'paint' ? 'Peinture' : 'Montage' } : null,
      outside_work_movement_workers: values.workers.map((worker) => ({ ...worker, id: 'child-' + worker.worker_id,
        worker_name: roster.find((item) => item.id === worker.worker_id)?.full_name || worker.worker_name })) }
    persisted = [...persisted.filter((item) => item.id !== id), row]
    return id
  })
  mocks.remove.mockImplementation(async (id) => { persisted = persisted.filter((row) => row.id !== id) })
  mocks.workers.mockResolvedValue({ data: structuredClone(roster) })
  mocks.teams.mockResolvedValue([{ id: 'paint', name: 'Peinture', is_active: true }, { id: 'montage', name: 'Montage', is_active: true }])
  mocks.mappings.mockResolvedValue({ data: [{ worker_id: 'jeremie', device_employee_no: '064', is_active: true, mapping_review_state: 'confirmed' }] })
  window.confirm = vi.fn(() => true)
  window.print = vi.fn()
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
function WorkersStub() {
  const navigate = useNavigate()
  return <div><h1>Workers page</h1><button onClick={() => navigate('/outside-work')}>Return to outside work</button></div>
}
const open = (route = '/outside-work') => render(<LanguageProvider><MemoryRouter initialEntries={[route]}><Routes>
  <Route path="/outside-work" element={<OutsideWork />} /><Route path="/workers" element={<WorkersStub />} />
</Routes></MemoryRouter></LanguageProvider>)
const start = async () => {
  const add = await screen.findByRole('button', { name: 'Add outside-work movement' })
  await waitFor(() => expect(add.disabled).toBe(false))
  fireEvent.click(add)
  return screen.getByRole('form', { name: 'Add outside-work movement' })
}
const team = (form, id = 'paint') => fireEvent.change(within(form).getByLabelText('Team'), { target: { value: id } })
const completeTimesAndForeman = (form) => {
  fireEvent.change(within(form).getByLabelText('Search foreign foremen'), { target: { value: 'foreman' } })
  fireEvent.click(within(form).getByRole('option', { name: /FOREMAN/ }))
  for (const [label, value] of [['Foreman Start', '08:00'], ['Foreman End', '17:00'], ['Common worker start', '08:00'], ['Common worker end', '17:00']]) {
    fireEvent.change(within(form).getByLabelText(label), { target: { value } })
  }
}

describe('team-first outside-work workflow', () => {
  it('shows canonical teams and no worker list before team selection', async () => {
    open()
    const form = await start()
    expect(within(form).getAllByRole('option').map((option) => option.textContent)).toEqual(['Select team', 'Peinture', 'Montage'])
    expect(within(form).queryByRole('checkbox')).toBeNull()
    expect(within(form).queryByLabelText('Add worker from another team')).toBeNull()
    team(form)
    expect(within(form).getAllByRole('checkbox').map((checkbox) => checkbox.parentElement.textContent)).toEqual(['RICHARD80', 'ROBERT79'])
    expect(within(form).queryByText('JEREMIE')).toBeNull()
    expect(within(form).queryByText('INACTIVE WORKER')).toBeNull()
    expect(within(form).queryByText('FUTURE WORKER')).toBeNull()
  })
  it('selects and deselects exactly the selected team without duplicating workers', async () => {
    open()
    const form = await start(); team(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Select all team workers' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Select all team workers' }))
    expect(within(form).getByText('Selected: 2 of 2')).toBeTruthy()
    expect(within(form).getAllByRole('button', { name: /Remove worker:/ })).toHaveLength(2)
    fireEvent.click(within(form).getByRole('button', { name: 'Deselect team workers' }))
    expect(within(form).getByText('Selected: 0 of 2')).toBeTruthy()
  })
  it('finds cross-team workers by name, employee code, or exact-string biometric ID without changing teams', async () => {
    open()
    const form = await start(); team(form)
    expect(within(form).queryByRole('listbox', { name: 'From other teams' })).toBeNull()
    for (const term of ['jer', '100', '064']) {
      fireEvent.change(within(form).getByLabelText('Add worker from another team'), { target: { value: term } })
      expect(within(form).getByRole('option', { name: /JEREMIE.*100.*Montage/ })).toBeTruthy()
    }
    fireEvent.click(within(form).getByRole('option', { name: /JEREMIE/ }))
    fireEvent.click(within(form).getByRole('option', { name: /JEREMIE/ }))
    fireEvent.change(within(form).getByLabelText('Add worker from another team'), { target: { value: '' } })
    expect(within(form).getByText('From other teams')).toBeTruthy()
    expect(within(form).getAllByRole('button', { name: 'Remove worker: JEREMIE' })).toHaveLength(1)
    expect(roster.find((worker) => worker.id === 'jeremie').team_id).toBe('montage')
    expect(mocks.workers).toHaveBeenCalledTimes(1)
    expect(mocks.mappings).toHaveBeenCalledTimes(1)
  })
  it('keeps foreman selection foreign-only and worker overrides collapsed', async () => {
    open()
    const form = await start(); team(form)
    fireEvent.change(within(form).getByLabelText('Search foreign foremen'), { target: { value: 'ROBERT' } })
    expect(within(form).queryByRole('option', { name: /ROBERT/ })).toBeNull()
    fireEvent.change(within(form).getByLabelText('Search foreign foremen'), { target: { value: 'FOREMAN' } })
    expect(within(form).getByRole('option', { name: /FOREMAN/ })).toBeTruthy()
    fireEvent.click(within(form).getByRole('checkbox', { name: /ROBERT/ }))
    const details = within(form).getByText('Override worker time').parentElement
    expect(details.open).toBe(false)
    fireEvent.change(within(form).getByLabelText('ROBERT Start'), { target: { value: '09:30' } })
    fireEvent.change(within(form).getByLabelText('Common worker start'), { target: { value: '08:00' } })
    expect(within(form).getByLabelText('ROBERT Start').value).toBe('09:30')
  })
  it('saves and reopens an incomplete draft with missing-worker text and selections', async () => {
    open()
    const form = await start(); team(form)
    fireEvent.click(within(form).getByRole('checkbox', { name: /ROBERT/ }))
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '' } })
    fireEvent.change(within(form).getByLabelText('Worker not found'), { target: { value: 'WhatsApp unknown worker' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      status: 'draft', work_date: '', foreman_worker_id: '', start_time: '',
      missing_worker_note: 'WhatsApp unknown worker', workers: [expect.objectContaining({ worker_id: 'robert', start_time: '' })],
    })))
    await screen.findByRole('button', { name: 'Continue' })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const reopened = screen.getByRole('form', { name: 'Add outside-work movement' })
    expect(within(reopened).getByLabelText('Worker not found').value).toBe('WhatsApp unknown worker')
    expect(within(reopened).getByLabelText('Date').value).toBe('')
    expect(within(reopened).getByRole('button', { name: 'Remove worker: ROBERT' })).toBeTruthy()
  })
  it('saves before visiting Workers and restores the draft when returning through navigation', async () => {
    open()
    const form = await start(); team(form)
    fireEvent.click(within(form).getByRole('checkbox', { name: /ROBERT/ }))
    fireEvent.change(within(form).getByLabelText('Worker not found'), { target: { value: 'Find this person' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Open Workers page' }))
    await screen.findByRole('heading', { name: 'Workers page' })
    expect(persisted.find((row) => row.id === 'draft-new').missing_worker_note).toBe('Find this person')
    fireEvent.click(screen.getByRole('button', { name: 'Return to outside work' }))
    const resumed = await screen.findByRole('form', { name: 'Add outside-work movement' })
    expect(within(resumed).getByLabelText('Worker not found').value).toBe('Find this person')
    expect(within(resumed).getByRole('button', { name: 'Remove worker: ROBERT' })).toBeTruthy()
  })
  it('blocks final save with unresolved text, then saves real IDs and promotes the same draft', async () => {
    persisted.push({ ...structuredClone(movement), id: 'existing-draft', status: 'draft', missing_worker_note: 'Unknown name' })
    open('/outside-work?draft=existing-draft')
    const form = await screen.findByRole('form', { name: 'Add outside-work movement' })
    fireEvent.click(within(form).getByRole('button', { name: 'Save final' }))
    expect(screen.getByRole('alert').textContent).toContain('Resolve or clear')
    expect(mocks.save).not.toHaveBeenCalled()
    fireEvent.change(within(form).getByLabelText('Worker not found'), { target: { value: '' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save final' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'existing-draft', status: 'final', workers: [expect.objectContaining({ worker_id: 'robert' })],
    })))
    expect(persisted.filter((row) => row.id === 'existing-draft')).toHaveLength(1)
  })
  it('requires a team, real workers, foreman, and valid times for final save', async () => {
    open()
    const form = await start()
    fireEvent.click(within(form).getByRole('button', { name: 'Save final' }))
    expect(screen.getByRole('alert').textContent).toContain('Date and team')
    team(form)
    completeTimesAndForeman(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Save final' }))
    expect(screen.getByRole('alert').textContent).toContain('at least one real worker')
    fireEvent.click(within(form).getByRole('checkbox', { name: /ROBERT/ }))
    fireEvent.click(within(form).getByRole('button', { name: 'Save final' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'final', team_id: 'paint' })))
  })
  it('keeps existing movement details, edit/delete, final-only report, and print working', async () => {
    persisted.push({ ...structuredClone(movement), id: 'draft', status: 'draft', start_time: '01:00', end_time: '23:00' })
    const { container } = open()
    await screen.findByText('FOREMAN', { selector: 'strong' })
    expect(screen.queryByText('ROBERT')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show workers (1)' }))
    expect(screen.getByText('ROBERT')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide workers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(within(screen.getByRole('form')).getByRole('button', { name: 'Save final' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'movement-1', status: 'final' })))
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Weekly foreman report' }))
    fireEvent.change(screen.getByLabelText('Select a foreman'), { target: { value: 'worker:foreman' } })
    const print = container.querySelector('.outside-work-print')
    expect(print.textContent).toContain('12 h')
    expect(print.textContent).not.toContain('22 h')
    expect(print.textContent).not.toContain('ROBERT')
    fireEvent.click(screen.getByRole('button', { name: 'Print Weekly Foreman Report' }))
    expect(window.print).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Movements (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('movement-1'))
  })
})
