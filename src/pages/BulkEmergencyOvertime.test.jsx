// @vitest-environment jsdom
import React from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LanguageProvider } from '../i18n/LanguageContext'
import BulkEmergencyOvertime from './BulkEmergencyOvertime'

globalThis.React = React
const mocks = vi.hoisted(() => ({ workers: vi.fn(), attendance: vi.fn(), rpc: vi.fn(), clear: vi.fn() }))
const team = { id: 'team-1', name: 'Zarour' }
const worker = { id: 'worker-1', full_name: 'TEST WORKER', team_id: team.id, team_name: team.name, team, is_active: true, staff_classification: 'normal' }
const attendance = { id: 'attendance-1', worker_id: worker.id, status: 'half_day', attendance_date: '2026-09-21', check_in: '07:30:00', check_out: null, updated_at: '2026-09-21T17:00:00Z', attendance_source: 'biometric', manual_override: false }

vi.mock('../api/workersApi', () => ({ getWorkersRequest: mocks.workers }))
vi.mock('../api/attendanceApi', () => ({ getAttendanceRequest: mocks.attendance }))
vi.mock('../api/workerControlData', () => ({ clearWorkerControlDataCache: mocks.clear }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => {
  const query = { select: () => query, eq: () => query, then: (resolve, reject) => Promise.resolve({ data: [{ worker_id: 'worker-1', device_employee_no: '021' }], error: null }).then(resolve, reject) }
  return { from: () => query, rpc: mocks.rpc }
} }))

beforeEach(() => {
  localStorage.setItem('workers_app_language', 'en')
  mocks.workers.mockResolvedValue({ data: [worker] })
  mocks.attendance.mockResolvedValue({ data: [attendance] })
  mocks.rpc.mockResolvedValue({ data: { updated: 1, skipped: 0, failed: 0, results: [{ worker_id: worker.id, outcome: 'updated' }] }, error: null })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const open = () => render(<LanguageProvider><BulkEmergencyOvertime /></LanguageProvider>)
const chooseWorker = async () => {
  await screen.findByText('Zarour')
  fireEvent.click(screen.getByLabelText('Zarour'))
  await screen.findByText('TEST WORKER')
  fireEvent.click(screen.getByRole('checkbox', { name: 'TEST WORKER' }))
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Power outage' } })
}

describe('bulk emergency overtime admin page', () => {
  it('previews and submits a manual checkout for selected workers only', async () => {
    open()
    await chooseWorker()
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }))
    expect(screen.getByText('Confirm emergency entry')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1))
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_mode: 'manual_checkout', p_reason: 'Power outage',
      p_entries: [{ worker_id: worker.id, checkout: '21:00', expected_updated_at: attendance.updated_at }],
    })
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledTimes(1))
  })

  it('submits direct duration without a checkout and requires a reason', async () => {
    open()
    await screen.findByText('Zarour')
    fireEvent.click(screen.getByLabelText('Zarour'))
    await screen.findByText('TEST WORKER')
    fireEvent.click(screen.getByRole('checkbox', { name: 'TEST WORKER' }))
    fireEvent.change(screen.getByLabelText('Entry mode'), { target: { value: 'manual_overtime_duration' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'TEST WORKER' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }))
    expect(screen.getByRole('alert').textContent).toContain('A reason is required')
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Network outage' } })
    fireEvent.change(screen.getByLabelText('Overtime duration (h:mm)'), { target: { value: '3h30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1))
    expect(mocks.rpc.mock.calls[0][1].p_entries).toEqual([{
      worker_id: worker.id, minutes: 210, expected_updated_at: attendance.updated_at,
    }])
    expect(mocks.rpc.mock.calls[0][1].p_mode).toBe('manual_overtime_duration')
  })
})
