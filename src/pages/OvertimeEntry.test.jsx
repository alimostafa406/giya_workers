// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LanguageProvider } from '../i18n/LanguageContext'
import OvertimeEntry from './OvertimeEntry'
import { readFileSync } from 'node:fs'
import { overtimeEntryBlock, parseOvertimeDuration } from '../utils/overtimeEntry'

globalThis.React = React
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), clear: vi.fn() }))
vi.mock('../api/overtimeEntryApi', () => ({ getOvertimeEntryData: mocks.load, saveOvertimeEntry: mocks.save }))
vi.mock('../api/workerControlData', () => ({ clearWorkerControlDataCache: mocks.clear }))
vi.mock('../utils/attendanceOperationalGate', () => ({ kinshasaClock: () => ({ date: '2026-10-24' }) }))
const paint = { id: 'paint', name: 'Peinture', foreman_worker_id: 'foreman' }, other = { id: 'other', name: 'Tamer' }
const worker = (id, name, team = paint, extra = {}) => ({ id, full_name: name, employee_code: id, is_active: true,
  staff_classification: 'normal', team_id: team.id, team_name: team.name, team, ...extra })
let source
beforeEach(() => {
  localStorage.setItem('workers_app_language', 'en')
  source = { date: '2026-10-24', workers: [worker('a', 'ALPHA'), worker('b', 'BETA'), worker('c', 'CHARLIE', other),
    worker('inactive', 'INACTIVE', paint, { is_active: false }), worker('foreman', 'FOREMAN', paint, { staff_classification: 'special_staff' }),
    worker('future', 'FUTURE', paint, { operational_start_date: '2026-11-01' }),
    worker('driver', 'DRIVER', { id: 'driver', name: 'Chauffeur' })],
  attendance: ['a', 'b', 'c'].map((id) => ({ id: `att-${id}`, worker_id: id, attendance_date: '2026-10-24', status: 'half_day', check_in: '08:00:00', check_out: null,
    updated_at: '2026-10-24T08:00:00Z', manual_override: false, attendance_source: 'biometric' })), lockedIds: [] }
  mocks.load.mockReset().mockImplementation(async (date) => structuredClone({ ...source, date }))
  mocks.save.mockReset().mockImplementation(async ({ entries }) => ({ updated: entries.length, skipped: 0, failed: 0,
    results: entries.map((entry) => ({ worker_id: entry.worker_id, outcome: 'updated', reason: null })) }))
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
const open = () => render(<LanguageProvider><OvertimeEntry /></LanguageProvider>)
const team = async (id = 'paint') => {
  await waitFor(() => expect(screen.getByLabelText('Team').disabled).toBe(false))
  fireEvent.change(screen.getByLabelText('Team'), { target: { value: id } })
}
const apply = () => { fireEvent.click(screen.getByRole('button', { name: 'Select all', exact: true })); fireEvent.click(screen.getByRole('button', { name: 'Apply to selected' })) }
const previewSave = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Preview SET overtime', exact: true }))
  fireEvent.click(within(screen.getByRole('region', { name: 'Preview SET overtime' })).getByRole('button', { name: 'Save overtime' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalled())
}

it.each([' beta ', '315', '025', 'et'])('daily search %s finds monthly worker using canonical biometric strings', async (query) => {
  source.workers[1] = { ...source.workers[1], employee_code: '315', payment_type: 'monthly' }
  source.mappings = [{ worker_id: 'b', device_employee_no: '025', is_active: true, mapping_review_state: 'confirmed' }]
  open(); await team()
  fireEvent.change(screen.getByPlaceholderText('بحث بالاسم أو الكود أو رقم البصمة...'), { target: { value: query } })
  expect(screen.getByRole('checkbox', { name: 'BETA' })).toBeTruthy()
  expect(screen.queryByRole('checkbox', { name: 'ALPHA' })).toBeNull()
  expect(screen.getByText('Monthly')).toBeTruthy()
  expect(screen.getByText('#025')).toBeTruthy()
})
it('daily filtered select-all preserves hidden selections and monthly worker uses normal bulk/individual save', async () => {
  source.workers[1].payment_type = 'monthly'
  source.mappings = [{ worker_id: 'b', device_employee_no: '025', is_active: true, mapping_review_state: 'confirmed' }]
  open(); await team()
  fireEvent.click(screen.getByRole('checkbox', { name: 'ALPHA' }))
  const search = screen.getByPlaceholderText('بحث بالاسم أو الكود أو رقم البصمة...')
  fireEvent.change(search, { target: { value: '025' } })
  fireEvent.click(screen.getByRole('button', { name: 'Select all', exact: true }))
  fireEvent.change(search, { target: { value: '' } })
  expect(screen.getByRole('checkbox', { name: 'ALPHA' }).checked).toBe(true)
  expect(screen.getByRole('checkbox', { name: 'BETA' }).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Apply to selected' }))
  fireEvent.change(screen.getByLabelText('New duration: BETA'), { target: { value: '3:00' } })
  await previewSave()
  expect(mocks.save.mock.calls[0][0].entries.map((entry) => [entry.worker_id, entry.minutes])).toEqual([['a',120],['b',180]])
})

it('applies visible quick controls and independent row edits under production StrictMode', async () => {
  render(<React.StrictMode><LanguageProvider><OvertimeEntry /></LanguageProvider></React.StrictMode>)
  await team()
  fireEvent.click(screen.getByRole('checkbox', { name: 'ALPHA' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'BETA' }))
  fireEvent.change(screen.getByLabelText('Overtime for selected workers'), { target: { value: '1:00' } })
  fireEvent.click(screen.getByRole('button', { name: '2 hours', exact: true }))
  expect(screen.getByLabelText('Overtime for selected workers').value).toBe('2:00')
  fireEvent.click(screen.getByRole('button', { name: 'Apply to selected' }))
  expect(screen.getByLabelText('New duration: ALPHA').value).toBe('2:00')
  expect(screen.getByLabelText('New duration: BETA').value).toBe('2:00')
  expect(mocks.save).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('New duration: ALPHA'), { target: { value: '3:00' } })
  expect(screen.getByLabelText('New duration: ALPHA').value).toBe('3:00')
  expect(screen.getByLabelText('New duration: BETA').value).toBe('2:00')
  await previewSave()
  expect(mocks.save.mock.calls[0][0].entries).toEqual([
    expect.objectContaining({ worker_id: 'a', minutes: 180 }), expect.objectContaining({ worker_id: 'b', minutes: 120 }),
  ])
})

it('Arabic visible quick/apply controls update selected rows only and save individual adjustments', async () => {
  localStorage.setItem('workers_app_language', 'ar')
  open()
  await waitFor(() => expect(screen.getByLabelText('الفريق').disabled).toBe(false))
  fireEvent.change(screen.getByLabelText('الفريق'), { target: { value: 'paint' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'ALPHA' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'BETA' }))
  const common = screen.getByLabelText('الوقت الإضافي للمختارين')
  for (const [label, value] of [['1 ساعة','1:00'], ['1:30','1:30'], ['2 ساعات','2:00'], ['3 ساعات','3:00'], ['4 ساعات','4:00'], ['+30 دقيقة','4:30']]) {
    const button = screen.getByRole('button', { name: label, exact: true })
    expect(button.type).toBe('button')
    fireEvent.click(button)
    expect(common.value).toBe(value)
  }
  fireEvent.click(screen.getByRole('button', { name: '2 ساعات', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'تطبيق على المختارين' }))
  expect(screen.getByLabelText('الوقت الجديد: ALPHA').value).toBe('2:00')
  expect(screen.getByLabelText('الوقت الجديد: BETA').value).toBe('2:00')
  expect(screen.getByRole('status').textContent).toContain('تم تطبيق المدة على المختارين: 2')
  expect(mocks.save).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('الوقت الجديد: ALPHA'), { target: { value: '3:00' } })
  expect(screen.getByLabelText('الوقت الجديد: BETA').value).toBe('2:00')
  fireEvent.click(screen.getByRole('button', { name: 'معاينة التعيين', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'حفظ الوقت الإضافي', exact: true }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalled())
  expect(mocks.save.mock.calls[0][0].entries.map(({ worker_id, minutes }) => ({ worker_id, minutes })))
    .toEqual([{ worker_id: 'a', minutes: 180 }, { worker_id: 'b', minutes: 120 }])
})

it('applies Arabic-digit common duration and leaves unselected rows empty without saving', async () => {
  open(); await team()
  fireEvent.click(screen.getByRole('checkbox', { name: 'ALPHA' }))
  fireEvent.change(screen.getByLabelText('Overtime for selected workers'), { target: { value: '٢:٠٠' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply to selected' }))
  expect(screen.getByLabelText('New duration: ALPHA').value).toBe('2:00')
  expect(screen.getByLabelText('New duration: BETA').value).toBe('')
  expect(mocks.save).not.toHaveBeenCalled()
  expect(parseOvertimeDuration('۲:۳۰')).toBe(150)
})

it('shows weekday, blocks future dates and offers a Monday–Saturday strip', async () => {
  open(); await team()
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-23' } })
  expect(screen.getByText('Friday, 23/10/2026')).toBeTruthy()
  expect(screen.getByLabelText('Date').max).toBe('2026-10-24')
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-25' } })
  expect(screen.getByLabelText('Date').value).toBe('2026-10-23')
  expect(within(screen.getByRole('navigation', { name: 'Week days' })).getAllByRole('button')).toHaveLength(6)
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Week days' })).getAllByRole('button')[0])
  expect(screen.getByLabelText('Date').value).toBe('2026-10-19')
})
it('uses only eligible active real team members, not foreman metadata or other teams', async () => {
  open(); await team()
  expect(screen.getAllByRole('checkbox').map((input) => input.getAttribute('aria-label'))).toEqual(['ALPHA', 'BETA'])
  for (const name of ['INACTIVE', 'FOREMAN', 'FUTURE', 'DRIVER', 'CHARLIE']) expect(screen.queryByText(name)).toBeNull()
  expect(screen.getByRole('option', { name: 'Chauffeur' })).toBeTruthy()
})
it('Chauffeur daily manual duration uses normal visible controls and the same save API', async () => {
  source.attendance.push({ ...source.attendance[0], id: 'att-driver', worker_id: 'driver', status: 'present', attendance_day_fraction: 1 })
  open(); await team('driver')
  fireEvent.click(screen.getByRole('checkbox', { name: 'DRIVER' }))
  fireEvent.click(screen.getByRole('button', { name: '2 hours', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Apply to selected' }))
  await previewSave()
  expect(mocks.save.mock.calls[0][0].entries).toEqual([expect.objectContaining({ worker_id: 'driver', minutes: 120, expected_updated_at: '2026-10-24T08:00:00Z' })])
})
it('searches loaded team workers without requests and keeps selections when search clears', async () => {
  open(); await team(); const loads = mocks.load.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: 'Select all', exact: true }))
  fireEvent.change(screen.getByLabelText('Search within team'), { target: { value: 'alpha' } })
  expect(screen.queryByText('BETA')).toBeNull()
  expect(screen.getByRole('checkbox', { name: 'ALPHA' }).checked).toBe(true)
  fireEvent.change(screen.getByLabelText('Search within team'), { target: { value: '' } })
  expect(screen.getByRole('checkbox', { name: 'BETA' }).checked).toBe(true)
  expect(mocks.load).toHaveBeenCalledTimes(loads)
})
it('applies a common duration, allows one-row changes and previews exact totals', async () => {
  open(); await team(); apply()
  expect(screen.getByLabelText('New duration: ALPHA').value).toBe('2:00')
  expect(screen.getByLabelText('New duration: BETA').value).toBe('2:00')
  fireEvent.change(screen.getByLabelText('New duration: BETA'), { target: { value: '3:00' } })
  await previewSave()
  expect(mocks.save.mock.calls[0][0].entries).toEqual([
    expect.objectContaining({ worker_id: 'a', minutes: 120 }), expect.objectContaining({ worker_id: 'b', minutes: 180 }),
  ])
})
it('shows existing manual duration and SETS 2h rather than adding it to 90 minutes', async () => {
  Object.assign(source.attendance[0], { manual_override: true, emergency_overtime_mode: 'manual_overtime_duration', emergency_overtime_minutes: 90 })
  const before = structuredClone(source)
  open(); await team()
  expect(within(screen.getByRole('checkbox', { name: 'ALPHA' }).closest('tr')).getByText('1:30')).toBeTruthy(); expect(screen.getByText('Manual')).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox', { name: 'ALPHA' }))
  fireEvent.click(screen.getByRole('button', { name: 'Apply to selected' }))
  await previewSave()
  expect(mocks.save.mock.calls[0][0].entries[0].minutes).toBe(120)
  expect(source).toEqual(before)
  expect(mocks.save.mock.calls[0][0].entries[0]).not.toHaveProperty('check_out')
  expect(mocks.save.mock.calls[0][0].entries[0]).not.toHaveProperty('check_in')
})
it('allows manual duration alongside real checkout without sending or changing that checkout', async () => {
  Object.assign(source.attendance[0], { check_out: '19:00:00' })
  open(); await team()
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-23' } })
  await waitFor(() => expect(screen.getByLabelText('Team').disabled).toBe(false))
  expect(within(screen.getByRole('checkbox', { name: 'ALPHA' }).closest('tr')).getByText('2:00')).toBeTruthy()
  expect(screen.getByRole('checkbox', { name: 'ALPHA' }).disabled).toBe(false)
  expect(screen.getByText('Recorded checkout:')).toBeTruthy()
  expect(screen.getByText('19:00')).toBeTruthy()
  const before = structuredClone(source)
  apply(); await previewSave()
  expect(mocks.save.mock.calls[0][0].entries).toHaveLength(2)
  expect(mocks.save.mock.calls[0][0].entries[0].minutes).toBe(120)
  expect(mocks.save.mock.calls[0][0].entries[0]).not.toHaveProperty('check_out')
  expect(source).toEqual(before)
})
it('clears successful selection, stays on date, and enters a second team without navigation', async () => {
  open(); await team(); apply(); await previewSave()
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'ALPHA' }).checked).toBe(false))
  expect(screen.getByLabelText('Date').value).toBe('2026-10-24')
  await team('other'); apply(); await previewSave()
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))
  expect(mocks.save.mock.calls[1][0].date).toBe('2026-10-24')
  expect(mocks.save.mock.calls[1][0].entries.map((entry) => entry.worker_id)).toEqual(['c'])
})
it('shows payroll locks and protected rows as read-only and excludes them from select-all', async () => {
  source.lockedIds = ['a']; source.attendance[1].manual_override = true
  open(); await team()
  expect(screen.getByRole('checkbox', { name: 'ALPHA' }).disabled).toBe(true)
  expect(screen.getByRole('checkbox', { name: 'BETA' }).disabled).toBe(true)
  expect(screen.getByText('Finalized / paid payroll — read-only')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Select all', exact: true }))
  expect(screen.getByRole('button', { name: 'Preview SET overtime', exact: true }).disabled).toBe(true)
  expect(mocks.save).not.toHaveBeenCalled()
})
it('preserves skipped selections and names every partial result', async () => {
  mocks.save.mockResolvedValue({ updated: 1, skipped: 1, failed: 0, results: [
    { worker_id: 'a', outcome: 'updated' }, { worker_id: 'b', outcome: 'skipped', reason: 'attendance_changed_since_preview' },
  ] })
  open(); await team(); apply(); await previewSave()
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'ALPHA' }).checked).toBe(false))
  expect(screen.getByRole('checkbox', { name: 'BETA' }).checked).toBe(true)
  const result = screen.getAllByRole('status').find((item) => item.textContent.includes('Saved: 1'))
  expect(result.textContent).toContain('BETA: Attendance changed')
})
it('keeps preview and request ID on a network failure so retry is idempotent', async () => {
  mocks.save.mockRejectedValueOnce(new Error('offline'))
  open(); await team(); apply(); await previewSave()
  await screen.findByRole('alert')
  const requestId = mocks.save.mock.calls[0][0].requestId
  fireEvent.click(screen.getByRole('button', { name: 'Save overtime', exact: true }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))
  expect(mocks.save.mock.calls[1][0].requestId).toBe(requestId)
})
it('rejects invalid durations and Sunday without any writes', async () => {
  open(); await team(); fireEvent.click(screen.getByRole('button', { name: 'Select all', exact: true }))
  fireEvent.change(screen.getByLabelText('Overtime for selected workers'), { target: { value: '25:00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply to selected' }))
  expect(screen.getByRole('alert').textContent).toContain('valid duration')
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-18' } })
  await waitFor(() => expect(screen.getByLabelText('Team').disabled).toBe(false))
  expect(screen.getByRole('checkbox', { name: 'ALPHA' }).disabled).toBe(true)
  expect(mocks.save).not.toHaveBeenCalled()
})
it('uses Arabic labels and weekday names', async () => {
  localStorage.setItem('workers_app_language', 'ar')
  open(); await screen.findByRole('option', { name: 'Peinture' })
  expect(screen.getByRole('heading', { name: 'إدخال الوقت الإضافي' })).toBeTruthy()
  expect(screen.getByText('السبت — 24/10/2026')).toBeTruthy()
})

it('keeps the entry route inside the admin-protected layout with a visible attendance navigation link', () => {
  const router = readFileSync('src/routes/AppRouter.jsx', 'utf8')
  const route = router.indexOf('<Route path="/attendance/overtime-entry" element={<OvertimeEntry />} />')
  expect(route).toBeGreaterThan(router.indexOf('<Route element={<ProtectedRoute />}>'))
  expect(router.slice(router.indexOf('function ProtectedRoute()'), router.indexOf('function LoginRoute()'))).toContain('if (!admin)')
  expect(readFileSync('src/components/Sidebar/Sidebar.jsx', 'utf8')).toContain("to: '/attendance/overtime-entry'")
})

it('validates minute precision without interpreting a duration as a clock', () => {
  for (const [value, minutes] of [['0:01', 1], ['0:30',30], ['1:30',90], ['2:00',120], ['24:00',1440]]) expect(parseOvertimeDuration(value)).toBe(minutes)
  for (const value of ['0:00','24:01','1:60','-1:00','1.5','2026-10-23T19:00']) expect(parseOvertimeDuration(value)).toBeNull()
})

it('ignores a stale date load when a newer selected date has already loaded', async () => {
  let complete
  mocks.load.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
  open()
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-23' } })
  await team()
  complete(structuredClone({ ...source, workers: [], date: '2026-10-24' }))
  await waitFor(() => expect(screen.getByLabelText('Team').disabled).toBe(false))
  expect(screen.getByRole('option', { name: 'Peinture' })).toBeTruthy()
  expect(screen.getByLabelText('Date').value).toBe('2026-10-23')
})

it.each([
  ['biometric two punches', { check_in: '08:00', check_out: '19:00' }],
  ['biometric one punch', { check_in: '08:00', check_out: null }],
  ['canonical present without punches', {}],
  ['outside-work present', { attendance_source: 'outside_work' }],
  ['supervisor P', { attendance_source: 'manual', manual_override: true, biometric_sync_metadata: { supervisor_morning_review: { choice: 'P' } } }],
  ['supervisor O', { attendance_source: 'manual', manual_override: true, biometric_sync_metadata: { supervisor_morning_review: { choice: 'O' } } }],
])('allows %s without mutating protected attendance evidence', async (_, fields) => {
  Object.assign(source.attendance[0], { status: 'present', attendance_day_fraction: '1.0', check_in: null, check_out: null, ...fields })
  const before = structuredClone(source)
  open(); await team()
  expect(screen.getByRole('checkbox', { name: 'ALPHA' }).disabled).toBe(false)
  fireEvent.click(screen.getByRole('checkbox', { name: 'ALPHA' }))
  fireEvent.click(screen.getByRole('button', { name: 'Apply to selected' }))
  await previewSave()
  const entry = mocks.save.mock.calls[0][0].entries[0]
  expect(entry).not.toHaveProperty('check_in')
  expect(entry).not.toHaveProperty('check_out')
  expect(source).toEqual(before)
})

it('keeps absent, missing, protected medical and locked full-present workers blocked', () => {
  const present = { id: 'a', status: 'present', attendance_day_fraction: 1, updated_at: 'stamp', check_in: null }
  expect(overtimeEntryBlock(present, '2026-10-19', true)).toBe('payroll_finalized_or_paid')
  expect(overtimeEntryBlock(undefined, '2026-10-19')).toBe('valid_check_in_required')
  expect(overtimeEntryBlock({ ...present, status: 'absent', attendance_day_fraction: 0 }, '2026-10-19')).toBe('valid_check_in_required')
  for (const choice of ['A', 'M']) expect(overtimeEntryBlock({ ...present, manual_override: true,
    biometric_sync_metadata: { supervisor_morning_review: { choice } } }, '2026-10-19')).toBe('protected_manual_attendance')
})

it('matches Siraj October 19 canonical count: thirteen present, one protected A and one missing', async () => {
  source.workers = Array.from({ length: 15 }, (_, i) => worker(String(i), `Siraj ${i}`))
  source.attendance = source.workers.slice(0, 14).map((w, i) => ({ id: `att-${i}`, worker_id: w.id,
    status: i === 13 ? 'absent' : 'present', attendance_day_fraction: i === 13 ? 0 : 1,
    check_in: i === 13 ? null : '08:00', manual_override: i === 13, updated_at: '2026-10-19T17:00:00Z' }))
  open(); await team()
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-19' } })
  await waitFor(() => expect(screen.getByLabelText('Team').disabled).toBe(false))
  expect(screen.getAllByRole('checkbox').filter((input) => !input.disabled)).toHaveLength(13)
  expect(screen.getAllByRole('checkbox').filter((input) => input.disabled)).toHaveLength(2)
})
