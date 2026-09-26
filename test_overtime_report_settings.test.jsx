// @vitest-environment jsdom
import React from 'react'
import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import OvertimeReportSettings from './src/components/Reports/OvertimeReportSettings.jsx'
import { getOvertimeReportSettings, saveOvertimeReportSettings } from './src/api/overtimeReportSettingsApi.js'
import { useOvertimeReportSettings } from './src/utils/useOvertimeReportSettings.js'
import { dailyReportData } from './src/utils/dailyReportCenter.js'
import AttendanceOvertimeSettings from './src/pages/AttendanceOvertimeSettings.jsx'
vi.mock('./src/api/overtimeReportSettingsApi.js', () => ({ getOvertimeReportSettings: vi.fn(), saveOvertimeReportSettings: vi.fn(async () => ({})) }))
const auth = vi.hoisted(() => ({ admin: { is_active: true } }))
vi.mock('./src/store/authStore.js', () => ({ useAuthStore: selector => selector(auth) }))
vi.mock('./src/i18n/LanguageContext.jsx', () => ({ useTranslation: () => ({ t: key => key }) }))
afterEach(() => { cleanup(); vi.clearAllMocks(); auth.admin = { is_active: true } })
const model = () => ({ settings: { team_ids: [], teams: [{ id: 'a', name: 'Zarour' }] }, loading: false, error: '', load: vi.fn(async () => {}) })
test('all teams disabled by default, cancel resets unsaved selection, save uses team IDs', async () => {
  render(<OvertimeReportSettings model={model()} />)
  const checkbox = screen.getByRole('checkbox', { name: 'Zarour' })
  expect(checkbox.checked).toBe(false)
  fireEvent.click(checkbox); fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
  expect(checkbox.checked).toBe(false)
  expect(saveOvertimeReportSettings).not.toHaveBeenCalled()
  fireEvent.click(checkbox); fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
  await screen.findByRole('status')
  expect(saveOvertimeReportSettings).toHaveBeenCalledWith(['a'])
})
test('configuration is hidden for non-admin users', () => {
  auth.admin = null
  render(<OvertimeReportSettings model={model()} />)
  expect(screen.queryByRole('checkbox')).toBe(null)
})
test('site settings loads saved teams, cancel is local, and save uses the canonical API', async () => {
  let saved = ['a']
  getOvertimeReportSettings.mockImplementation(async () => ({ team_ids: saved, teams: [{ id: 'a', name: 'Zarour' }, { id: 'b', name: 'Siraj' }] }))
  saveOvertimeReportSettings.mockImplementation(async ids => { saved = ids; return {} })
  render(<AttendanceOvertimeSettings />)
  const zarour = await screen.findByRole('checkbox', { name: 'Zarour' })
  const siraj = screen.getByRole('checkbox', { name: 'Siraj' })
  expect(zarour.checked).toBe(true)
  expect(siraj.checked).toBe(false)
  fireEvent.click(siraj)
  fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
  expect(siraj.checked).toBe(false)
  expect(saved).toEqual(['a'])
  expect(saveOvertimeReportSettings).not.toHaveBeenCalled()
  fireEvent.click(siraj)
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
  await screen.findByRole('status')
  expect(saved).toEqual(['a', 'b'])
  expect(saveOvertimeReportSettings).toHaveBeenCalledWith(['a', 'b'])
})
test('settings refresh immediately re-filters Monday and Tuesday without changing canonical rows', async () => {
  let selected = []
  getOvertimeReportSettings.mockImplementation(async () => ({ team_ids: selected, teams: [] }))
  const dates = ['2026-09-21', '2026-09-22']
  const worker = { id: 'w', full_name: 'Worker', is_active: true, staff_classification: 'normal', team_id: 'a', team: { name: 'Zarour' } }
  const attendance = dates.map(date => ({ id: date, worker_id: 'w', worker, attendance_date: date, status: 'present', check_out: '19:00:00' }))
  function Harness() {
    const model = useOvertimeReportSettings()
    return <>{dates.map(date => <p key={date}>{date}: {dailyReportData({ date, attendance, overtimeTeamIds: model.loading ? [] : model.settings.team_ids }).overtime.length}</p>)}</>
  }
  render(<Harness />)
  await screen.findByText('2026-09-21: 0')
  selected = ['a']
  fireEvent(window, new Event('overtime-report-settings-changed'))
  await screen.findByText('2026-09-21: 1')
  await screen.findByText('2026-09-22: 1')
  expect(attendance.every(row => row.check_out === '19:00:00' && row.status === 'present')).toBe(true)
  getOvertimeReportSettings.mockRejectedValue(new Error('Settings unavailable'))
  fireEvent(window, new Event('focus'))
  await screen.findByText('2026-09-21: 0')
})
