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
  const form = await screen.findByRole('form', { name: 'Add outside-work movement' })
  await within(form).findByRole('option', { name: 'Peinture' })
  return form
}
const showDay = async (date = '2026-10-13') => {
  await start()
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: date } })
}
const showSelected = (form) => {
  const details = form.querySelector('.outside-work-selected-workers')
  if (!details.open) fireEvent.click(details.querySelector('summary'))
}

const team = (form, id = 'paint') => fireEvent.change(within(form).getByLabelText('Team'), { target: { value: id } })

const chooseForeman = (form) => {
  fireEvent.change(within(form).getByLabelText('Search foreign foremen'), { target: { value: 'FOREMAN' } })
  fireEvent.click(within(form).getByRole('option', { name: /FOREMAN/ }))
}

describe('outside-work separate movement ranges', () => {
  it('shows saved Sunday foreman overtime in the movement card without changing actual or worker times', async () => {
    Object.assign(persisted[0], { work_date: '2026-10-11', start_time: '09:00:00', end_time: '18:00:00' })
    const before = structuredClone(persisted)
    open(); await showDay('2026-10-11')
    const card = (await screen.findByRole('button', { name: 'Show workers (1)' })).closest('article')
    expect(within(card).getByText('4 h')).toBeTruthy()
    expect(within(card).getByText('9 h')).toBeTruthy()
    expect(within(card).getByText('09:00 → 18:00')).toBeTruthy()
    expect(within(card).getByText('09:00 → 17:00')).toBeTruthy()
    expect(persisted).toEqual(before)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('titles an independent foreman card once and formats only its real times in 24-hour display', async () => {
    localStorage.setItem('workers_app_language', 'ar')
    Object.assign(persisted[0], { team_id: null, team: null, foreman_name: 'Ahmad abo hussien', end_time: '18:00:00', common_worker_start: '08:00' })
    persisted[0].outside_work_movement_workers[0].start_time = '08:00:00'
    const before = structuredClone(persisted)
    open()
    await screen.findByRole('option', { name: 'Peinture' })
    fireEvent.change(screen.getByLabelText('التاريخ'), { target: { value: '2026-10-13' } })
    const show = await screen.findByRole('button', { name: 'عرض العمال (1)' })
    const card = show.closest('article')
    expect(within(card).getByRole('heading', { name: 'Ahmad abo hussien' })).toBeTruthy()
    expect(within(card).getAllByText('Ahmad abo hussien')).toHaveLength(1)
    expect(within(card).getByText('معلم مستقل')).toBeTruthy()
    expect(within(card).getByText('محفوظة')).toBeTruthy()
    expect(card.querySelector('[aria-label="المعلم"] .outside-work-person')).toBeNull()
    expect(within(card).getByText('08:00 → 18:00')).toBeTruthy()
    expect(within(card).getByText('08:00 → 17:00')).toBeTruthy()
    expect(within(card).getByText('1 h')).toBeTruthy()
    expect(within(card).getByText('10 h')).toBeTruthy()
    expect(card.textContent).not.toMatch(/AM|PM|بدون فريق رئيسي/)
    fireEvent.click(show)
    expect(within(card).getByRole('cell', { name: 'ROBERT' })).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'تعديل' })).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'حذف' })).toBeTruthy()
    expect(persisted).toEqual(before)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('saves a foreman-led movement without a primary team and preserves mixed-team workers through reload and edit', async () => {
    const originalRoster = structuredClone(roster)
    const first = open()
    const form = await start()
    expect(within(form).queryByRole('checkbox')).toBeNull()
    expect(within(form).queryByLabelText('Search workers by name / employee code / biometric ID')).toBeNull()
    chooseForeman(form)
    expect(within(form).getByLabelText('Team').value).toBe('')
    expect(within(form).queryByRole('checkbox')).toBeNull()
    const search = within(form).getByRole('textbox', { name: 'Search workers by name / employee code / biometric ID' })
    expect(search.closest('details').open).toBe(true)
    expect(within(form).queryByRole('listbox')).toBeNull()
    for (const name of ['ROBERT', 'JEREMIE']) {
      fireEvent.change(search, { target: { value: name } })
      fireEvent.click(within(form).getByRole('option', { name: new RegExp(name) }))
    }
    fireEvent.click(within(form).getByRole('option', { name: /JEREMIE/ }))
    const selected = form.querySelector('.outside-work-selected-workers')
    expect(selected.open).toBe(true)
    expect(selected.querySelector('summary').textContent).toBe('Selected workers (2)')
    for (const text of ['ROBERT', 'JEREMIE', 'Peinture', 'Montage']) expect(within(selected).getByRole('cell', { name: text })).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Save movement' }))
    const show = await screen.findByRole('button', { name: 'Show workers (2)' })
    expect(within(show.closest('article')).getByRole('heading', { name: 'FOREMAN' })).toBeTruthy()
    expect(show.closest('article').textContent).toContain('Independent foreman')
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      status: 'final', team_id: '', foreman_worker_id: 'foreman',
      workers: [expect.objectContaining({ worker_id: 'robert' }), expect.objectContaining({ worker_id: 'jeremie' })],
    }))
    expect(persisted.find(row => row.id === 'draft-new').outside_work_movement_workers).toHaveLength(2)
    first.unmount()
    const reopened = open()
    await start()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const editForm = screen.getByRole('form')
    expect(within(editForm).getByLabelText('Team').value).toBe('')
    for (const name of ['ROBERT', 'JEREMIE']) expect(within(editForm).getByRole('button', { name: `Remove worker: ${name}` })).toBeTruthy()
    fireEvent.click(within(editForm).getByRole('button', { name: 'Save movement' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))
    await screen.findByRole('button', { name: 'Show workers (2)' })
    expect(persisted.find(row => row.id === 'draft-new').outside_work_movement_workers.map(row => row.worker_id)).toEqual(['robert', 'jeremie'])
    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }))
    fireEvent.change(screen.getByLabelText('Report type'), { target: { value: 'foreman' } })
    await screen.findByRole('option', { name: 'FOREMAN' })
    fireEvent.change(screen.getByLabelText('Select a foreman'), { target: { value: 'worker:foreman' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show workers (2)' }))
    for (const name of ['ROBERT', 'JEREMIE', 'Peinture', 'Montage']) expect(screen.getAllByRole('cell', { name }).length).toBeGreaterThan(0)
    expect(reopened.container.querySelector('.outside-work-print').textContent).toContain('JEREMIE')
    expect(roster).toEqual(originalRoster)
  })
  it('opens a ready entry workspace, shows only the selected day, and keeps report separate', async () => {
    const { container } = open()
    const form = await start()
    expect(screen.getByRole('heading', { name: 'Record a new movement' })).toBeTruthy()
    expect(container.querySelector('.outside-work-entry-layout')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show workers (1)' })).toBeNull()
    team(form); chooseForeman(form)
    fireEvent.click(within(form).getByRole('checkbox', { name: /ROBERT/ }))
    fireEvent.change(within(form).getByLabelText('Foreman End'), { target: { value: '20:00' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }))
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Reports' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Record movements' }))
    const restored = screen.getByRole('form')
    expect(within(restored).getByLabelText('Foreman End').value).toBe('20:00')
    expect(within(restored).getByRole('checkbox', { name: /ROBERT/ }).checked).toBe(true)
    await showDay()
    expect(await screen.findByRole('button', { name: 'Show workers (1)' })).toBeTruthy()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('edits the existing movement in the visible form and saves its original ID', async () => {
    open(); await showDay()
    const edit = await screen.findByRole('button', { name: 'Edit' })
    fireEvent.click(edit)
    const heading = screen.getByRole('heading', { name: 'Edit outside-work movement' })
    expect(document.activeElement).toBe(heading)
    const form = screen.getByRole('form')
    expect(within(form).getByLabelText('Foreman End').value).toBe('20:00')
    expect(within(form).getByLabelText('Workers End').value).toBe('17:00')
    fireEvent.change(within(form).getByLabelText('Foreman End'), { target: { value: '21:00' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save movement' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'movement-1', end_time: '21:00', common_worker_end: '17:00' })))
    await screen.findByRole('button', { name: 'Edit' })
    expect(persisted.filter((row) => row.id === 'movement-1')).toHaveLength(1)
  })
  it('keeps cross-team search and selected-worker details compact and expandable', async () => {
    open(); const form = await start(); team(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Select all team workers' }))
    const selected = form.querySelector('.outside-work-selected-workers')
    expect(selected.open).toBe(false)
    expect(selected.querySelector('summary').textContent).toBe('Selected workers (2)')
    const cross = form.querySelector('.outside-work-cross-search')
    expect(cross.open).toBe(false)
    expect(within(form).getByLabelText('Add worker from another team').closest('details').open).toBe(false)
    fireEvent.click(cross.querySelector('summary'))
    const search = within(form).getByRole('textbox', { name: 'Add worker from another team' })
    fireEvent.change(search, { target: { value: '064' } })
    fireEvent.click(within(form).getByRole('option', { name: /JEREMIE/ }))
    expect(form.querySelector('.outside-work-selected-workers').open).toBe(true)
    expect(selected.querySelector('summary').textContent).toBe('Selected workers (3)')
    showSelected(form)
    expect(within(form).getByRole('cell', { name: 'JEREMIE' })).toBeTruthy()
    expect(within(form).getByRole('cell', { name: /Montage/ })).toBeTruthy()
    fireEvent.click(selected.querySelector('summary'))
    expect(selected.open).toBe(false)
    fireEvent.click(within(form).getByRole('option', { name: /JEREMIE/ }))
    expect(selected.open).toBe(false)
    expect(selected.querySelector('summary').textContent).toBe('Selected workers (3)')
    showSelected(form)
    expect(within(form).getAllByRole('cell', { name: 'JEREMIE' })).toHaveLength(1)
    fireEvent.click(within(form).getByRole('button', { name: 'Remove worker: JEREMIE' }))
    expect(within(form).queryByRole('cell', { name: 'JEREMIE' })).toBeNull()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('filters already loaded team workers without new requests or lost selections', async () => {
    open(); const form = await start(); team(form)
    fireEvent.click(within(form).getByRole('checkbox', { name: /ROBERT/ }))
    const requests = mocks.workers.mock.calls.length
    fireEvent.change(within(form).getByLabelText('Search within team'), { target: { value: 'rich' } })
    expect(within(form).getAllByRole('checkbox')).toHaveLength(1)
    expect(within(form).getByRole('checkbox', { name: /RICHARD/ })).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('Search within team'), { target: { value: 'no-match' } })
    expect(form.querySelector('.outside-work-worker-list').textContent).toContain('No matches')
    fireEvent.change(within(form).getByLabelText('Search within team'), { target: { value: '' } })
    expect(within(form).getByRole('checkbox', { name: /ROBERT/ }).checked).toBe(true)
    expect(mocks.workers).toHaveBeenCalledTimes(requests)
  })
  it('keeps delete confirmation and existing deletion API behavior', async () => {
    open(); await showDay()
    const button = await screen.findByRole('button', { name: 'Delete' })
    window.confirm.mockReturnValueOnce(false)
    fireEvent.click(button)
    expect(mocks.remove).not.toHaveBeenCalled()
    fireEvent.click(button)
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('movement-1'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show workers (1)' })).toBeNull())
  })
  it('expands weekly workers while print always includes names without actions', async () => {
    const { container } = open()
    await screen.findByRole('option', { name: 'Peinture' })
    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }))
    fireEvent.change(screen.getByLabelText('Report type'), { target: { value: 'foreman' } })
    await screen.findByRole('option', { name: 'FOREMAN' })
    fireEvent.change(screen.getByLabelText('Select a foreman'), { target: { value: 'worker:foreman' } })
    expect(screen.queryByRole('cell', { name: 'ROBERT' })).toBeNull()
    const print = container.querySelector('.outside-work-print')
    for (const text of ['ROBERT', 'Peinture', 'FOREMAN', 'Outside-work reports', '2026-10-01 → 2026-10-14']) expect(print.textContent).toContain(text)
    expect(print.querySelector('button,select,input')).toBeNull()
    expect(print.querySelectorAll('.outside-report-movement')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Show workers (1)' }))
    expect(screen.getByRole('cell', { name: 'ROBERT' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'Peinture' })).toBeTruthy()
    const details = screen.getByRole('table')
    expect(details.querySelectorAll(':scope > tbody > tr')).toHaveLength(1)
    expect(details.querySelectorAll('th')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Hide workers (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Print Report' }))
    expect(window.print).toHaveBeenCalledOnce()
    expect(print.textContent).toContain('ROBERT')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('isolates Arabic overtime and week ranges and shares three compact summary cards with print', async () => {
    localStorage.setItem('workers_app_language', 'ar')
    persisted[0].end_time = '17:00:00'
    const { container } = open()
    await screen.findByRole('option', { name: 'Peinture' })
    expect(container.querySelector('.outside-work-selected-date').textContent).toBe('الأربعاء — 14/10/2026')
    fireEvent.change(screen.getByLabelText('التاريخ'), { target: { value: '2026-10-13' } })
    expect(container.querySelector('.outside-work-selected-date').textContent).toBe('الثلاثاء — 13/10/2026')
    fireEvent.click(screen.getByRole('tab', { name: 'التقارير' }))
    fireEvent.change(screen.getByLabelText('نوع التقرير'), { target: { value: 'foreman' } })
    await screen.findByRole('option', { name: 'FOREMAN' })
    fireEvent.change(screen.getByLabelText('اختر معلماً للتقرير'), { target: { value: 'worker:foreman' } })
    await waitFor(() => expect(container.querySelectorAll('.foreman-report-summary')).toHaveLength(2))
    const summaries = container.querySelectorAll('.foreman-report-summary')
    expect(summaries).toHaveLength(2)
    for (const summary of summaries) {
      expect(summary.children).toHaveLength(3)
      expect([...summary.querySelectorAll('bdi')].map((value) => value.textContent)).toEqual(['1', '1', '0 h'])
      expect(summary.querySelectorAll('bdi[dir="ltr"]')).toHaveLength(3)
      expect(summary.className).toContain('outside-report-summary')
    }
    for (const range of container.querySelectorAll('.outside-report-period')) {
      if (range.textContent.includes('→')) {
        expect(range.textContent).toBe('الخميس 01/10/2026 → الأربعاء 14/10/2026')
        expect(range.dir).toBe('ltr')
      }
    }
    for (const overtime of container.querySelectorAll('td bdi.whitespace-nowrap')) {
      expect(overtime.textContent).toBe('0 h')
      expect(overtime.dir).toBe('ltr')
    }
    expect(container.querySelector('.outside-work-print p bdi').textContent).toBe('الخميس 01/10/2026 → الأربعاء 14/10/2026')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('separates foreman and shared worker ranges and omits redundant worker time columns', async () => {
    open()
    await showDay()
    const show = await screen.findByRole('button', { name: 'Show workers (1)' })
    const card = show.closest('article')
    expect(within(card).getByRole('heading', { name: 'Peinture' })).toBeTruthy()
    expect(card.querySelector('[aria-label="Foreman"]').textContent).toContain('FOREMAN')
    expect(card.textContent).not.toContain('Independent foreman')
    expect(card.querySelector('[aria-label="Foreman"]').textContent).toContain('08:00 → 20:00')
    expect(card.querySelector('[aria-label="Foreman"]').textContent).toContain('12 h')
    expect(card.querySelector('[aria-label="Workers"]').textContent).toContain('09:00 → 17:00')
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
    await showDay()
    const show = await screen.findByRole('button', { name: 'Show workers (2)' })
    const card = show.closest('article')
    expect(within(card).getByText('Individual times shown in worker details')).toBeTruthy()
    fireEvent.click(show)
    expect(within(card).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Workers', 'Team', 'Start', 'End'])
    expect(within(card).getByRole('cell', { name: '17:00' })).toBeTruthy()
    expect(within(card).getByRole('cell', { name: '18:00' })).toBeTruthy()
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
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: date } })
    await waitFor(() => expect(form.querySelector('fieldset').disabled).toBe(false))
    fireEvent.click(within(form).getByRole('button', { name: 'Save movement' }))
    const show = await screen.findByRole('button', { name: 'Show workers (2)' })
    expect(mocks.list).toHaveBeenLastCalledWith(weekStart, weekEnd)
    expect(mocks.save.mock.calls[0][0].work_date).toBe(date)
    expect(show.closest('section').querySelector('.outside-work-panel-heading').textContent).toContain(date === '2026-10-10' ? '10/10/2026' : '10/14/2026')
    fireEvent.click(show)
    expect(within(show.closest('section')).getByRole('cell', { name: 'ROBERT' })).toBeTruthy()
    expect(within(show.closest('section')).getByRole('cell', { name: 'RICHARD' })).toBeTruthy()
  })
  it('switches to a dated draft week and keeps the Drafts tab usable', async () => {
    open()
    const form = await start(); team(form)
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-10' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save as draft' }))
    await screen.findByRole('button', { name: 'Continue' })
    expect(screen.getByLabelText('Date').value).toBe('2026-10-10')
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
    showSelected(form)
    expect(within(form).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Workers', 'Team', 'Remove worker'])
  })
  it('preserves weekday/Saturday defaults and defaults only Sunday foreman times', async () => {
    open()
    const form = await start()
    expect(within(form).getByLabelText('Foreman Start').value).toBe('08:00')
    expect(within(form).getByLabelText('Foreman End').value).toBe('17:00')
    expect(within(form).getByLabelText('Workers Start').value).toBe('08:00')
    expect(within(form).getByLabelText('Workers End').value).toBe('17:00')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-17' } })
    expect(within(form).getByLabelText('Foreman End').value).toBe('14:00')
    expect(within(form).getByLabelText('Workers End').value).toBe('14:00')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-18' } })
    expect(within(form).getByLabelText('Foreman Start').value).toBe('09:00')
    expect(within(form).getByLabelText('Foreman End').value).toBe('14:00')
    for (const label of ['Workers Start', 'Workers End']) {
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
    fireEvent.click(within(form).getByRole('button', { name: 'Save movement' }))
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
    showSelected(form)
    expect(within(form).getByText('From other teams')).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Save movement' }))
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
  it('visibly adds cross-team workers and preserves them through final save, reload, edit, resave and report', async () => {
    const originalRoster = structuredClone(roster)
    const rendered = open()
    const form = await start(); team(form); chooseForeman(form)
    fireEvent.click(within(form).getByRole('checkbox', { name: /ROBERT/ }))
    fireEvent.change(within(form).getByLabelText('Add worker from another team'), { target: { value: '064' } })
    const result = within(form).getByRole('option', { name: /JEREMIE/ })
    fireEvent.click(result)
    fireEvent.click(result)
    expect(result.getAttribute('aria-selected')).toBe('true')
    expect(result.textContent).toContain('✓')
    expect(form.querySelector('.outside-work-selected-workers').open).toBe(true)
    expect(within(form).getAllByRole('cell', { name: 'JEREMIE' })).toHaveLength(1)
    expect(within(form).getByRole('cell', { name: /Montage/ })).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Save movement' }))
    const savedCard = (await screen.findByRole('button', { name: 'Show workers (2)' })).closest('article')
    expect(mocks.save.mock.calls[0][0].workers.map(row => row.worker_id)).toEqual(['robert', 'jeremie'])
    expect(persisted.find(row => row.id === 'draft-new').outside_work_movement_workers.map(row => row.worker_id)).toEqual(['robert', 'jeremie'])
    fireEvent.click(within(savedCard).getByRole('button', { name: 'Show workers (2)' }))
    expect(within(savedCard).getByRole('cell', { name: 'JEREMIE' })).toBeTruthy()
    expect(within(savedCard).getByRole('cell', { name: 'Montage' })).toBeTruthy()
    rendered.unmount()
    const reopened = open()
    await start()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const editForm = screen.getByRole('form')
    expect(within(editForm).getByRole('button', { name: 'Remove worker: JEREMIE' })).toBeTruthy()
    fireEvent.click(within(editForm).getByRole('button', { name: 'Save movement' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))
    await screen.findByRole('button', { name: 'Show workers (2)' })
    expect(persisted.find(row => row.id === 'draft-new').outside_work_movement_workers.map(row => row.worker_id)).toEqual(['robert', 'jeremie'])
    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }))
    fireEvent.change(screen.getByLabelText('Report type'), { target: { value: 'foreman' } })
    await screen.findByRole('option', { name: 'FOREMAN' })
    fireEvent.change(screen.getByLabelText('Select a foreman'), { target: { value: 'worker:foreman' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show workers (2)' }))
    expect(screen.getByRole('cell', { name: 'JEREMIE' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'Montage' })).toBeTruthy()
    expect(reopened.container.querySelector('.outside-work-print').textContent).toContain('JEREMIE')
    expect(roster).toEqual(originalRoster)
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
    await screen.findByRole('heading', { name: 'Edit outside-work movement' })
    const resumed = screen.getByRole('form', { name: 'Add outside-work movement' })
    expect(within(resumed).getByLabelText('Foreman End').value).toBe('20:00')
    expect(within(resumed).getByLabelText('Workers End').value).toBe('18:00')
    expect(within(resumed).getByRole('button', { name: 'Remove worker: ROBERT' })).toBeTruthy()
    expect(within(resumed).getByRole('button', { name: 'Remove worker: JEREMIE' })).toBeTruthy()
    expect(screen.getByLabelText('Date').value).toBe('2026-10-14')
  })
  it('preserves saved individual times until a shared range is explicitly edited', async () => {
    persisted.push({ ...structuredClone(movement), id: 'legacy-draft', status: 'draft',
      common_worker_start: null, common_worker_end: null,
      outside_work_movement_workers: [...movement.outside_work_movement_workers,
        { id: 'child-two', worker_id: 'jeremie', worker_name: 'JEREMIE', start_time: '08:00', end_time: '18:00' }] })
    open('/outside-work?draft=legacy-draft')
    await screen.findByText(/Saved worker times differ/)
    const form = screen.getByRole('form', { name: 'Add outside-work movement' })
    expect(within(form).getByText(/Saved worker times differ/)).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      workers: [expect.objectContaining({ worker_id: 'robert', start_time: '09:00', end_time: '17:00' }),
        expect.objectContaining({ worker_id: 'jeremie', start_time: '08:00', end_time: '18:00' })],
    })))
  })
  it('keeps historical weekly report and print values unchanged', async () => {
    const { container } = open()
    await screen.findByRole('option', { name: 'Peinture' })
    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }))
    fireEvent.change(screen.getByLabelText('Report type'), { target: { value: 'foreman' } })
    await screen.findByRole('option', { name: 'FOREMAN' })
    fireEvent.change(screen.getByLabelText('Select a foreman'), { target: { value: 'worker:foreman' } })
    const print = container.querySelector('.outside-work-print')
    expect(print.querySelector('.foreman-report-summary').textContent).toContain('Total foreman overtime3 h')
    expect(print.textContent).not.toMatch(/Total hours|Daily average/)
    expect(screen.getAllByText('Foreman overtime')).toHaveLength(2)
    expect(print.querySelector('.outside-report-facts').textContent).toContain('3 h')
    expect(print.querySelectorAll('th')[3].textContent).toBe('Workers End')
    fireEvent.click(screen.getByRole('button', { name: 'Print Report' }))
    expect(window.print).toHaveBeenCalledOnce()
  })
})
