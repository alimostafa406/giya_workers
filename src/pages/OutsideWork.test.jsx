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

describe('individual-worker outside-work entry', () => {
  it('has no extra options, foreman, shared times, note, or reminder controls', async () => {
    open()
    const form = await start()
    expect(within(form).queryByText(/Additional options|خيارات إضافية/)).toBeNull()
    for (const label of ['Common worker start', 'Common worker end', 'Search foreign foremen', 'Foreman Start', 'Note', 'Worker not found']) {
      expect(within(form).queryByLabelText(label)).toBeNull()
    }
    expect(within(form).getAllByRole('option').map((option) => option.textContent)).toEqual(['Select team', 'Peinture', 'Montage'])
    expect(within(form).queryByRole('checkbox')).toBeNull()
    team(form)
    expect(within(form).getAllByRole('checkbox').map((checkbox) => checkbox.parentElement.textContent)).toEqual(['RICHARD80', 'ROBERT79'])
    expect(within(form).queryByText('JEREMIE')).toBeNull()
    expect(within(form).queryByText('INACTIVE WORKER')).toBeNull()
    expect(within(form).queryByText('FUTURE WORKER')).toBeNull()
    expect(within(form).getByLabelText('Add worker from another team')).toBeTruthy()
  })
  it('selects all only in the chosen team and gives each worker visible individual times', async () => {
    open()
    const form = await start(); team(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Select all team workers' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Select all team workers' }))
    expect(within(form).getByText('Selected: 2 of 2')).toBeTruthy()
    expect(within(form).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Workers', 'Team', 'Start', 'End', 'Remove worker'])
    for (const name of ['ROBERT', 'RICHARD']) {
      expect(within(form).getByLabelText(name + ' Start').value).toBe('08:00')
      expect(within(form).getByLabelText(name + ' End').value).toBe('17:00')
    }
    fireEvent.click(within(form).getByRole('button', { name: 'Deselect team workers' }))
    expect(within(form).queryByRole('table')).toBeNull()
  })
  it('searches cross-team replacements without dumping the company or changing their team', async () => {
    open()
    const form = await start(); team(form)
    expect(within(form).queryByRole('listbox')).toBeNull()
    for (const term of ['jer', '100', '064']) {
      fireEvent.change(within(form).getByLabelText('Add worker from another team'), { target: { value: term } })
      expect(within(form).getByRole('option', { name: /JEREMIE.*100.*Montage/ })).toBeTruthy()
    }
    fireEvent.click(within(form).getByRole('option', { name: /JEREMIE/ }))
    fireEvent.click(within(form).getByRole('option', { name: /JEREMIE/ }))
    fireEvent.change(within(form).getByLabelText('Add worker from another team'), { target: { value: '' } })
    const row = within(form).getByLabelText('JEREMIE Start').closest('tr')
    expect(within(row).getByText('Montage')).toBeTruthy()
    expect(within(row).getByText('From other teams')).toBeTruthy()
    expect(within(form).getAllByRole('button', { name: 'Remove worker: JEREMIE' })).toHaveLength(1)
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'final',
      foreman_worker_id: '', foreman_name: '', workers: [expect.objectContaining({ worker_id: 'jeremie' })] })))
    expect(roster.find((worker) => worker.id === 'jeremie').team_id).toBe('montage')
  })
  it('editing one worker affects only that row and final save needs no foreman', async () => {
    open()
    const form = await start(); team(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Select all team workers' }))
    fireEvent.change(within(form).getByLabelText('ROBERT Start'), { target: { value: '09:00' } })
    fireEvent.change(within(form).getByLabelText('ROBERT End'), { target: { value: '18:00' } })
    expect(within(form).getByLabelText('RICHARD Start').value).toBe('08:00')
    expect(within(form).getByLabelText('RICHARD End').value).toBe('17:00')
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      status: 'final', workers: [expect.objectContaining({ worker_id: 'richard', start_time: '08:00', end_time: '17:00' }),
        expect.objectContaining({ worker_id: 'robert', start_time: '09:00', end_time: '18:00' })],
    })))
  })
  it('defaults Saturday workers independently to 08:00–14:00 and Sunday to blank', async () => {
    open()
    const form = await start(); team(form)
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-10-17' } })
    fireEvent.click(within(form).getByRole('checkbox', { name: /ROBERT/ }))
    expect(within(form).getByLabelText('ROBERT Start').value).toBe('08:00')
    expect(within(form).getByLabelText('ROBERT End').value).toBe('14:00')
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-10-18' } })
    expect(within(form).getByLabelText('ROBERT Start').value).toBe('')
    expect(within(form).getByLabelText('ROBERT End').value).toBe('')
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toContain('valid times')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('date changes update untouched worker times while preserving individual edits', async () => {
    open()
    const form = await start(); team(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Select all team workers' }))
    fireEvent.change(within(form).getByLabelText('ROBERT Start'), { target: { value: '09:00' } })
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-10-17' } })
    expect(within(form).getByLabelText('ROBERT Start').value).toBe('09:00')
    expect(within(form).getByLabelText('RICHARD Start').value).toBe('08:00')
    expect(within(form).getByLabelText('ROBERT End').value).toBe('14:00')
    expect(within(form).getByLabelText('RICHARD End').value).toBe('14:00')
  })
  it('drafts preserve cross-team workers and all individual times after leaving and reopening', async () => {
    const rendered = open()
    const form = await start(); team(form)
    fireEvent.click(within(form).getByRole('checkbox', { name: /ROBERT/ }))
    fireEvent.change(within(form).getByLabelText('Add worker from another team'), { target: { value: '064' } })
    fireEvent.click(within(form).getByRole('option', { name: /JEREMIE/ }))
    fireEvent.change(within(form).getByLabelText('ROBERT Start'), { target: { value: '09:10' } })
    fireEvent.change(within(form).getByLabelText('JEREMIE End'), { target: { value: '16:30' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save as draft' }))
    await screen.findByRole('button', { name: 'Continue' })
    rendered.unmount()
    open('/outside-work?draft=draft-new')
    const resumed = await screen.findByRole('form', { name: 'Add outside-work movement' })
    expect(within(resumed).getByLabelText('ROBERT Start').value).toBe('09:10')
    expect(within(resumed).getByLabelText('JEREMIE End').value).toBe('16:30')
    expect(within(resumed).getByLabelText('Team').value).toBe('paint')
    expect(within(resumed).getByLabelText('Date').value).toBe('2026-10-14')
  })
  it('allows incomplete drafts and does not erase archived note/foreman fields', async () => {
    persisted.push({ ...structuredClone(movement), id: 'old-draft', status: 'draft', note: 'Archived note', missing_worker_note: 'Archived reminder' })
    open('/outside-work?draft=old-draft')
    const form = await screen.findByRole('form', { name: 'Add outside-work movement' })
    expect(within(form).queryByLabelText('Note')).toBeNull()
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'old-draft', status: 'final', foreman_worker_id: 'foreman', foreman_name: 'FOREMAN',
      note: 'Archived note', missing_worker_note: 'Archived reminder', start_time: '08:00', end_time: '20:00',
    })))
  })
  it('remove and cancel work without mutating worker records', async () => {
    open()
    const form = await start(); team(form)
    fireEvent.click(within(form).getByRole('checkbox', { name: /ROBERT/ }))
    fireEvent.click(within(form).getByRole('button', { name: 'Remove worker: ROBERT' }))
    expect(within(form).queryByRole('table')).toBeNull()
    expect(within(form).getByRole('checkbox', { name: /ROBERT/ }).checked).toBe(false)
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form')).toBeNull()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('keeps historical foreman reports and print values unchanged', async () => {
    persisted.push({ ...structuredClone(movement), id: 'draft', status: 'draft', start_time: '01:00', end_time: '23:00' })
    persisted.push({ ...structuredClone(movement), id: 'individual', foreman_worker_id: null, foreman_name: null, start_time: null, end_time: null })
    const { container } = open()
    await screen.findByText('FOREMAN', { selector: 'strong' })
    fireEvent.click(screen.getByRole('button', { name: 'Weekly foreman report' }))
    fireEvent.change(screen.getByLabelText('Select a foreman'), { target: { value: 'worker:foreman' } })
    const print = container.querySelector('.outside-work-print')
    expect(print.textContent).toContain('12 h')
    expect(print.textContent).not.toContain('22 h')
    expect(print.textContent).not.toContain('ROBERT')
    fireEvent.click(screen.getByRole('button', { name: 'Print Weekly Foreman Report' }))
    expect(window.print).toHaveBeenCalledOnce()
  })
})
