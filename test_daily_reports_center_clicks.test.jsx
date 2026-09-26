// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DailyReportsCenter from './src/pages/DailyReportsCenter.jsx'
import DailyOperationalReports from './src/pages/DailyOperationalReports.jsx'
import { getOvertimeReportSettings } from './src/api/overtimeReportSettingsApi.js'
import { translations } from './src/i18n/translations.js'
import { getAttendanceRequest } from './src/api/attendanceApi.js'
import { getWorkersRequest } from './src/api/workersApi.js'
import { getBiometricMappingsRequest } from './src/api/biometricMappingApi.js'
import { getAttendanceEvidenceRangeRequest, getCurrentAttendanceEvidenceRequest } from './src/api/currentAttendanceEvidenceApi.js'
import { getMorningVerificationStatusRequest } from './src/api/attendanceAgentApi.js'

vi.mock('./src/api/attendanceApi.js', () => ({ getAttendanceRequest: vi.fn() }))
vi.mock('./src/api/workersApi.js', () => ({ getWorkersRequest: vi.fn() }))
vi.mock('./src/api/biometricMappingApi.js', () => ({ getBiometricMappingsRequest: vi.fn() }))
vi.mock('./src/api/currentAttendanceEvidenceApi.js', () => ({ getAttendanceEvidenceRangeRequest: vi.fn(), getCurrentAttendanceEvidenceRequest: vi.fn() }))
vi.mock('./src/api/attendanceAgentApi.js', () => ({ getMorningVerificationStatusRequest: vi.fn() }))
vi.mock('./src/api/overtimeReportSettingsApi.js', () => ({ getOvertimeReportSettings: vi.fn(async () => ({ team_ids: [], teams: [] })), saveOvertimeReportSettings: vi.fn() }))
vi.mock('./src/store/authStore.js', () => ({ useAuthStore: selector => selector({ admin: { is_active: true } }) }))
vi.mock('./src/utils/attendanceOperationalGate.js', () => ({ kinshasaClock: () => ({ date: '2026-09-26' }) }))
vi.mock('./src/i18n/LanguageContext.jsx', () => ({ useTranslation: () => ({ language: 'ar', t: (key) => key.split('.').reduce((value, part) => value?.[part], translations.ar) || key }) }))

const worker = (id, name, code) => ({ id, full_name: name, employee_code: code, is_active: true, staff_classification: 'normal', team: { name: 'Zarour' } })
const workers = [worker('ignace-id', 'IGNACE', '75'), worker('present-id', 'Present Worker', '101'), worker('missing-id', 'Missing Worker', '102')]
const attendance = [
  { id: 'half-row', worker_id: 'ignace-id', worker: workers[0], team_name: 'Zarour', attendance_date: '2026-09-26', status: 'half_day', check_in: '09:27:50', check_out: null, attendance_day_fraction: 0.5 },
  { id: 'present-row', worker_id: 'present-id', worker: workers[1], team_name: 'Zarour', attendance_date: '2026-09-26', status: 'present', check_in: '07:00:00', check_out: null, attendance_day_fraction: 1 },
]
const original = structuredClone(attendance)

beforeEach(() => {
  // Vitest's default JSX transform is classic; the production Vite build uses automatic JSX.
  vi.stubGlobal('React', React)
  getAttendanceRequest.mockResolvedValue({ data: attendance })
  getWorkersRequest.mockResolvedValue({ data: workers })
  getBiometricMappingsRequest.mockResolvedValue({ data: [{ worker_id: 'ignace-id', device_employee_no: '021', is_active: true, mapping_review_state: 'confirmed' }] })
  getAttendanceEvidenceRangeRequest.mockResolvedValue({ data: [] })
  getCurrentAttendanceEvidenceRequest.mockResolvedValue({ data: [] })
  getOvertimeReportSettings.mockResolvedValue({ team_ids: [], teams: [] })
  getMorningVerificationStatusRequest.mockResolvedValue({ latestAttempt: { status: 'complete' } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

const setup = async () => {
  render(<MemoryRouter initialEntries={['/reports/daily/2026-09-26']}><Routes><Route path="/reports/daily/:date" element={<DailyReportsCenter />} /></Routes></MemoryRouter>)
  await screen.findByRole('button', { name: /نصف يوم/ })
  expect(screen.queryByRole('checkbox')).toBe(null)
  expect(screen.queryByText(translations.ar.reports.overtimeSettingsTitle)).toBe(null)
}
const list = () => document.getElementById('daily-monitoring-worker-list')
test('standalone overtime report silently uses saved teams without rendering configuration controls', async () => {
  const selectedWorker = { ...workers[1], team_id: 'selected-team', full_name: 'Qualified Worker' }
  getOvertimeReportSettings.mockResolvedValue({ team_ids: ['selected-team'], teams: [{ id: 'selected-team', name: 'Zarour' }] })
  getAttendanceRequest.mockResolvedValue({ data: [{ ...attendance[1], worker: selectedWorker, attendance_date: '2026-09-25', check_out: '19:00:00' }] })
  render(<DailyOperationalReports type="overtime" />)
  await screen.findByText('Qualified Worker')
  expect(screen.getByText('2h00')).toBeTruthy()
  expect(screen.queryByRole('checkbox')).toBe(null)
  expect(screen.queryByText(translations.ar.reports.overtimeSettingsTitle)).toBe(null)
})
const click = (key) => {
  const button = screen.getByRole('button', { name: new RegExp(translations.ar.dashboard[key]) })
  // Dispatch on the rendered count span to cover event bubbling from the visible card content.
  fireEvent.click(button.querySelectorAll('span')[1])
  return button
}

test('actual date route: Half-day click reveals IGNACE #75, not just an isolated component', async () => {
  await setup()
  expect(list()).toBeNull()
  const button = click('halfDay')
  expect(within(list()).getByText('IGNACE')).toBeTruthy()
  expect(within(list()).getByText('75')).toBeTruthy()
  expect(within(list()).getByText('021')).toBeTruthy()
  expect(button.getAttribute('aria-pressed')).toBe('true')
})

test('actual date route: switching Half-day → Not recorded → Present replaces filtered rows and selected state', async () => {
  await setup()
  const half = click('halfDay')
  click('notRecorded')
  expect(within(list()).getByText('Missing Worker')).toBeTruthy()
  expect(within(list()).queryByText('IGNACE')).toBeNull()
  expect(half.getAttribute('aria-pressed')).toBe('false')
  click('presentToday')
  expect(within(list()).getByText('Present Worker')).toBeTruthy()
  expect(within(list()).queryByText('Missing Worker')).toBeNull()
})

test('actual date route: Total shows all operational workers; clicking does not reload or mutate attendance', async () => {
  await setup()
  click('totalWorkers')
  expect(list().querySelectorAll('tbody tr')).toHaveLength(3)
  click('halfDay'); click('presentToday'); click('notRecorded')
  expect(getAttendanceRequest).toHaveBeenCalledTimes(1)
  expect(attendance).toEqual(original)
  expect(getAttendanceRequest).toHaveBeenCalledWith({ date_from: '2026-09-26', date_to: '2026-09-26', staff_classification: 'normal', paginate: true })
})
