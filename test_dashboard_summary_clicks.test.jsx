// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from './src/pages/Dashboard.jsx'
import { translations } from './src/i18n/translations.js'
import { getAttendanceRequest } from './src/api/attendanceApi.js'
import { getWorkersRequest } from './src/api/workersApi.js'
import { getBiometricMappingsRequest } from './src/api/biometricMappingApi.js'
import { getCurrentAttendanceEvidenceRequest } from './src/api/currentAttendanceEvidenceApi.js'

vi.mock('./src/api/attendanceApi.js', () => ({ getAttendanceRequest: vi.fn() }))
vi.mock('./src/api/workersApi.js', () => ({ getWorkersRequest: vi.fn() }))
vi.mock('./src/api/biometricMappingApi.js', () => ({ getBiometricMappingsRequest: vi.fn(), getRecentUnmappedBiometricIdentitiesRequest: async () => ({ data: [] }), getUnresolvedBiometricAttendanceRequest: async () => ({ data: [] }) }))
vi.mock('./src/api/currentAttendanceEvidenceApi.js', () => ({ getCurrentAttendanceEvidenceRequest: vi.fn() }))
vi.mock('./src/components/Attendance/AttendanceAgentStatus.jsx', () => ({ default: () => null }))
vi.mock('./src/components/Attendance/UnresolvedBiometricAttendancePanel.jsx', () => ({ default: () => null }))
vi.mock('./src/i18n/LanguageContext.jsx', () => ({ useTranslation: () => ({ language: 'ar', t: (key) => key.split('.').reduce((value, part) => value?.[part], translations.ar) || key }) }))

const worker = (id, name, code) => ({ id, full_name: name, employee_code: code, is_active: true, staff_classification: 'normal', team: { name: 'Zarour' } })
const workers = [worker('ignace-id', 'IGNACE', '75'), worker('present-id', 'Present Worker', '101'), worker('missing-id', 'Missing Worker', '102'), worker('absent-id', 'Absent Worker', '103')]
const attendance = [
  { id: 'half-row', worker_id: 'ignace-id', worker: workers[0], team_name: 'Zarour', attendance_date: '2026-09-26', status: 'half_day', check_in: '09:27:50', check_out: null, attendance_day_fraction: 0.5 },
  { id: 'present-row', worker_id: 'present-id', worker: workers[1], team_name: 'Zarour', attendance_date: '2026-09-26', status: 'present', check_in: '07:00:00', check_out: null, attendance_day_fraction: 1 },
  { id: 'absent-row', worker_id: 'absent-id', worker: workers[3], team_name: 'Zarour', attendance_date: '2026-09-26', status: 'absent', check_in: null, check_out: null },
]
const original = structuredClone({ workers, attendance })
beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-26T10:00:00+01:00'))
  getWorkersRequest.mockResolvedValue({ data: workers })
  getAttendanceRequest.mockResolvedValue({ data: attendance })
  getBiometricMappingsRequest.mockResolvedValue({ data: [{ worker_id: 'ignace-id', device_employee_no: '021', is_active: true, mapping_review_state: 'confirmed' }] })
  getCurrentAttendanceEvidenceRequest.mockResolvedValue({ data: [{ worker_id: 'ignace-id', attendance_date: '2026-09-26', event_timestamp: '2026-09-26T08:27:50Z' }] })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const setup = async () => { render(<MemoryRouter initialEntries={['/']}><Dashboard /></MemoryRouter>); await screen.findByRole('button', { name: /نصف يوم/ }) }
const click = (key) => { const button = screen.getByRole('button', { name: new RegExp(translations.ar.dashboard[key]) }); fireEvent.click(button.querySelectorAll('span')[1]); return button }
const list = () => document.getElementById('daily-monitoring-worker-list')
const assertCountMatches = (button) => expect(list().querySelectorAll('tbody tr').length).toBe(Number(button.querySelectorAll('span')[1].textContent))

test('main dashboard Half-day click shows IGNACE #75 / Zarour / biometric 021 with worker Details link', async () => {
  await setup(); expect(list()).toBeNull()
  const button = click('halfDay')
  for (const text of ['IGNACE', '75', '021', 'Zarour', '09:27']) expect(within(list()).getAllByText(text).length).toBeGreaterThan(0)
  expect(within(list()).getByRole('link').getAttribute('href')).toBe('/worker-control-center/worker/ignace-id')
  expect(button.getAttribute('aria-pressed')).toBe('true'); assertCountMatches(button)
})
test('main dashboard Not recorded click shows only the corresponding worker and clears prior selection', async () => {
  await setup(); const half = click('halfDay'); const button = click('notRecorded')
  expect(within(list()).getByText('Missing Worker')).toBeTruthy()
  expect(within(list()).queryByText('IGNACE')).toBeNull()
  expect(half.getAttribute('aria-pressed')).toBe('false'); assertCountMatches(button)
})
test('main dashboard Present click shows only present workers; Saturday checkout remains null', async () => {
  await setup(); const button = click('presentToday')
  expect(within(list()).getByText('Present Worker')).toBeTruthy()
  expect(within(list()).queryByText('IGNACE')).toBeNull(); assertCountMatches(button)
  expect(attendance[1].check_out).toBeNull()
})
test('main dashboard Total click shows every operational worker and matching total', async () => {
  await setup(); const button = click('totalWorkers'); assertCountMatches(button)
  expect(list().querySelectorAll('tbody tr')).toHaveLength(4)
})
test('main dashboard Absent click shows only canonical absent workers', async () => {
  await setup(); const button = click('absentToday'); assertCountMatches(button)
  expect(within(list()).getByText('Absent Worker')).toBeTruthy()
  expect(within(list()).queryByText('Missing Worker')).toBeNull()
})
test('dashboard clicks do not mutate workers/attendance or trigger new attendance requests', async () => {
  await setup(); for (const key of ['halfDay', 'notRecorded', 'presentToday', 'totalWorkers']) click(key)
  expect({ workers, attendance }).toEqual(original)
  expect(getAttendanceRequest).toHaveBeenCalledTimes(1)
})
