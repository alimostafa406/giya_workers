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
  mocks.list.mockImplementation(async (start, end) => structuredClone(persisted.filter((row) => row.status === 'draft' || (row.work_date >= start && row.work_date <= end))))
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

const chooseForeman = (form) => {
  fireEvent.change(within(form).getByLabelText('Search foreign foremen'), { target: { value: 'FOREMAN' } })
  fireEvent.click(within(form).getByRole('option', { name: /FOREMAN/ }))
}

describe('outside-work separate movement ranges', () => {
  it('isolates Arabic overtime and week ranges and shares three compact summary cards with print', async () => {
    localStorage.setItem('workers_app_language', 'ar')
    persisted[0].end_time = '17:00:00'
    const { container } = open()
    await screen.findByText('FOREMAN', { selector: 'strong' })
    fireEvent.click(screen.getByRole('button', { name: 'تقرير المعلم الأسبوعي' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'worker:foreman' } })
    const summaries = container.querySelectorAll('.foreman-report-summary')
    expect(summaries).toHaveLength(2)
    for (const summary of summaries) {
      expect(summary.children).toHaveLength(3)
      expect([...summary.querySelectorAll('bdi')].map((value) => value.textContent)).toEqual(['1', '0 h', '1'])
      expect(summary.querySelectorAll('bdi[dir="ltr"]')).toHaveLength(3)
      expect(summary.className).toContain('sm:grid-cols-3')
    }
    for (const range of container.querySelectorAll('bdi')) {
      if (range.textContent.includes('→')) {
        expect(range.textContent).toBe('2026-10-12 → 2026-10-18')
        expect(range.dir).toBe('ltr')
      }
    }
    for (const overtime of container.querySelectorAll('td bdi')) {
      expect(overtime.textContent).toBe('0 h')
      expect(overtime.dir).toBe('ltr')
    }
    expect(container.querySelector('.outside-work-print p bdi').textContent).toBe('2026-10-12 → 2026-10-18')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('separates foreman and shared worker ranges and omits redundant worker time columns', async () => {
    open()
    const show = await screen.findByRole('button', { name: 'Show workers (1)' })
    const card = show.closest('article')
    expect(card.querySelector('[aria-label="Foreman"]').textContent).toContain('8:00 AM → 8:00 PM')
    expect(card.querySelector('[aria-label="Foreman"]').textContent).toContain('12 h')
    expect(card.querySelector('[aria-label="Workers"]').textContent).toContain('9:00 AM → 5:00 PM')
    fireEvent.click(show)
    expect(within(card).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Workers', 'Team'])
    const hide = within(card).getByRole('button', { name: 'Hide workers (1)' })
    fireEvent.click(hide)
    expect(within(card).queryByRole('table')).toBeNull()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('preserves genuinely different historical worker times in the expanded table', async () => {
    persisted[0].common_worker_start = null
    persisted[0].common_worker_end = null
    persisted[0].outside_work_movement_workers.push({ id: 'child-two', worker_id: 'richard', worker_name: 'RICHARD', start_time: '08:00:00', end_time: '18:00:00' })
    const before = structuredClone(persisted)
    open()
    const show = await screen.findByRole('button', { name: 'Show workers (2)' })
    const card = show.closest('article')
    expect(within(card).getByText('Individual times shown in worker details')).toBeTruthy()
    fireEvent.click(show)
    expect(within(card).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Workers', 'Team', 'Start', 'End'])
    expect(within(card).getByRole('cell', { name: '5:00 PM' })).toBeTruthy()
    expect(within(card).getByRole('cell', { name: '6:00 PM' })).toBeTruthy()
    expect(persisted).toEqual(before)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it.each([
    ['2026-10-14', '2026-10-12', '2026-10-18'],
    ['2026-10-10', '2026-10-05', '2026-10-11'],
  ])('shows the finalized movement immediately in the correct week for %s', async (date, weekStart, weekEnd) => {
    open()
    const form = await start(); team(form); chooseForeman(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Select all team workers' }))
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: date } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    const show = await screen.findByRole('button', { name: 'Show workers (2)' })
    expect(mocks.list).toHaveBeenLastCalledWith(weekStart, weekEnd)
    expect(mocks.save.mock.calls[0][0].work_date).toBe(date)
    expect(show.closest('section').querySelector('h2').textContent).toContain(date === '2026-10-10' ? '10/10/2026' : '10/14/2026')
    fireEvent.click(show)
    expect(within(show.closest('section')).getByRole('cell', { name: 'ROBERT' })).toBeTruthy()
    expect(within(show.closest('section')).getByRole('cell', { name: 'RICHARD' })).toBeTruthy()
  })
  it('switches to a dated draft week and keeps the Drafts tab usable', async () => {
    open()
    const form = await start(); team(form)
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-10-10' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save as draft' }))
    await screen.findByRole('button', { name: 'Continue' })
    expect(screen.getByLabelText('Week').value).toBe('2026-10-10')
    expect(mocks.list).toHaveBeenLastCalledWith('2026-10-05', '2026-10-11')
  })
  it('automatically uses the linked team foreman and shows fallback for an unlinked team', async () => {
    mocks.teams.mockResolvedValue([{ id: 'paint', name: 'Peinture', foreman_worker_id: 'foreman' }, { id: 'montage', name: 'Montage' }])
    open()
    const form = await start(); team(form)
    expect(within(form).getByRole('button', { name: 'Change foreman' })).toBeTruthy()
    expect(within(form).queryByLabelText('Search foreign foremen')).toBeNull()
    expect(within(form).getAllByRole('checkbox')).toHaveLength(2)
    team(form, 'montage')
    expect(within(form).getByRole('status').textContent).toBe('No foreman is linked to this team')
    expect(within(form).getByLabelText('Search foreign foremen')).toBeTruthy()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('keeps team-first selection and shows exactly four movement time inputs', async () => {
    open()
    const form = await start()
    expect(within(form).queryByRole('checkbox')).toBeNull()
    expect(within(form).queryByText(/Additional options|خيارات إضافية/)).toBeNull()
    team(form)
    expect(within(form).getAllByRole('checkbox').map((checkbox) => checkbox.parentElement.textContent)).toEqual(['RICHARD #80', 'ROBERT #79'])
    expect(within(form).getByRole('combobox', { name: 'Team' }).multiple).toBe(false)
    expect(within(form).getAllByRole('heading', { name: 'Foreman', exact: true })).toHaveLength(1)
    expect(form.querySelectorAll('.outside-work-worker-list > li')).toHaveLength(2)
    expect(within(form).queryByRole('listbox')).toBeNull()
    fireEvent.click(within(form).getByRole('button', { name: 'Select all team workers' }))
    for (const label of ['Foreman Start', 'Foreman End', 'Workers Start', 'Workers End']) {
      expect(within(form).getByLabelText(label)).toBeTruthy()
    }
    expect(form.querySelectorAll('input[type="time"]')).toHaveLength(4)
    expect(within(form).queryByLabelText('ROBERT Start')).toBeNull()
    expect(within(form).queryByLabelText('RICHARD End')).toBeNull()
    expect(within(form).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Workers', 'Team', 'Remove worker'])
  })
  it('defaults both ranges on weekdays and Saturday, and leaves Sunday blank', async () => {
    open()
    const form = await start()
    expect(within(form).getByLabelText('Foreman Start').value).toBe('08:00')
    expect(within(form).getByLabelText('Foreman End').value).toBe('17:00')
    expect(within(form).getByLabelText('Workers Start').value).toBe('08:00')
    expect(within(form).getByLabelText('Workers End').value).toBe('17:00')
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-10-17' } })
    expect(within(form).getByLabelText('Foreman End').value).toBe('14:00')
    expect(within(form).getByLabelText('Workers End').value).toBe('14:00')
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-10-18' } })
    for (const label of ['Foreman Start', 'Foreman End', 'Workers Start', 'Workers End']) {
      expect(within(form).getByLabelText(label).value).toBe('')
    }
  })
  it('keeps foreman and shared worker times independent and saves all workers with the shared range', async () => {
    open()
    const form = await start(); team(form); chooseForeman(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Select all team workers' }))
    fireEvent.change(within(form).getByLabelText('Foreman End'), { target: { value: '20:00' } })
    expect(within(form).getByLabelText('Workers End').value).toBe('17:00')
    fireEvent.change(within(form).getByLabelText('Workers End'), { target: { value: '18:00' } })
    expect(within(form).getByLabelText('Foreman End').value).toBe('20:00')
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      status: 'final', foreman_worker_id: 'foreman', start_time: '08:00', end_time: '20:00',
      common_worker_start: '08:00', common_worker_end: '18:00',
      workers: [expect.objectContaining({ worker_id: 'richard', start_time: '08:00', end_time: '18:00' }),
        expect.objectContaining({ worker_id: 'robert', start_time: '08:00', end_time: '18:00' })],
    })))
  })
  it('uses the same worker range for cross-team additions and never changes their real team', async () => {
    open()
    const form = await start(); team(form); chooseForeman(form)
    fireEvent.click(within(form).getByRole('checkbox', { name: /ROBERT/ }))
    fireEvent.change(within(form).getByLabelText('Workers End'), { target: { value: '18:30' } })
    expect(within(form).queryByRole('listbox')).toBeNull()
    for (const term of ['jer', '100', '064']) {
      fireEvent.change(within(form).getByLabelText('Add worker from another team'), { target: { value: term } })
      expect(within(form).getByRole('option', { name: /JEREMIE.*100.*Montage/ })).toBeTruthy()
    }
    fireEvent.click(within(form).getByRole('option', { name: /JEREMIE/ }))
    fireEvent.click(within(form).getByRole('option', { name: /JEREMIE/ }))
    fireEvent.change(within(form).getByLabelText('Add worker from another team'), { target: { value: '' } })
    expect(within(form).getByText('From other teams')).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      workers: [expect.objectContaining({ worker_id: 'robert', end_time: '18:30' }),
        expect.objectContaining({ worker_id: 'jeremie', end_time: '18:30' })],
    })))
    expect(roster.find((worker) => worker.id === 'jeremie').team_id).toBe('montage')
  })
  it('keeps the foreman selector active foreign-only', async () => {
    open()
    const form = await start()
    fireEvent.change(within(form).getByLabelText('Search foreign foremen'), { target: { value: 'ROBERT' } })
    expect(within(form).queryByRole('option', { name: /ROBERT/ })).toBeNull()
    chooseForeman(form)
    expect(within(form).getByRole('button', { name: 'Change foreman' })).toBeTruthy()
  })
  it('preserves both independent time ranges and all worker selections across draft reopening', async () => {
    const rendered = open()
    const form = await start(); team(form); chooseForeman(form)
    fireEvent.click(within(form).getByRole('checkbox', { name: /ROBERT/ }))
    fireEvent.change(within(form).getByLabelText('Add worker from another team'), { target: { value: '064' } })
    fireEvent.click(within(form).getByRole('option', { name: /JEREMIE/ }))
    fireEvent.change(within(form).getByLabelText('Foreman End'), { target: { value: '20:00' } })
    fireEvent.change(within(form).getByLabelText('Workers End'), { target: { value: '18:00' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save as draft' }))
    await screen.findByRole('button', { name: 'Continue' })
    rendered.unmount()
    open('/outside-work?draft=draft-new')
    const resumed = await screen.findByRole('form', { name: 'Add outside-work movement' })
    expect(within(resumed).getByLabelText('Foreman End').value).toBe('20:00')
    expect(within(resumed).getByLabelText('Workers End').value).toBe('18:00')
    expect(within(resumed).getByRole('button', { name: 'Remove worker: ROBERT' })).toBeTruthy()
    expect(within(resumed).getByRole('button', { name: 'Remove worker: JEREMIE' })).toBeTruthy()
    expect(within(resumed).getByLabelText('Date').value).toBe('2026-10-14')
  })
  it('preserves saved individual times until a shared range is explicitly edited', async () => {
    persisted.push({ ...structuredClone(movement), id: 'legacy-draft', status: 'draft',
      common_worker_start: null, common_worker_end: null,
      outside_work_movement_workers: [...movement.outside_work_movement_workers,
        { id: 'child-two', worker_id: 'jeremie', worker_name: 'JEREMIE', start_time: '08:00', end_time: '18:00' }] })
    open('/outside-work?draft=legacy-draft')
    const form = await screen.findByRole('form', { name: 'Add outside-work movement' })
    expect(within(form).getByText(/Saved worker times differ/)).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      workers: [expect.objectContaining({ worker_id: 'robert', start_time: '09:00', end_time: '17:00' }),
        expect.objectContaining({ worker_id: 'jeremie', start_time: '08:00', end_time: '18:00' })],
    })))
  })
  it('keeps historical weekly report and print values unchanged', async () => {
    const { container } = open()
    await screen.findByText('FOREMAN', { selector: 'strong' })
    fireEvent.click(screen.getByRole('button', { name: 'Weekly foreman report' }))
    fireEvent.change(screen.getByLabelText('Select a foreman'), { target: { value: 'worker:foreman' } })
    const print = container.querySelector('.outside-work-print')
    expect(print.querySelector('.foreman-report-summary').textContent).toContain('Total foreman overtime3 h')
    expect(print.textContent).not.toMatch(/Total hours|Daily average/)
    const reportTable = screen.getByRole('table')
    expect(within(reportTable).getByRole('cell', { name: '3 h' })).toBeTruthy()
    expect(within(reportTable).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Day', 'Date', 'Foreman Start', 'Foreman End', 'Overtime', 'Worker count'])
    expect(print.querySelectorAll('th')[4].textContent).toBe('Overtime')
    fireEvent.click(screen.getByRole('button', { name: 'Print Weekly Foreman Report' }))
    expect(window.print).toHaveBeenCalledOnce()
  })
})
