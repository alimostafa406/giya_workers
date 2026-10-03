// @vitest-environment jsdom
import React from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LanguageProvider } from '../i18n/LanguageContext'
import BulkEmergencyOvertime from './BulkEmergencyOvertime'

globalThis.React = React
const mocks = vi.hoisted(() => ({ workers: vi.fn(), attendance: vi.fn(), rpc: vi.fn(), clear: vi.fn() }))
const team = { id: 'team-1', name: 'Zarour' }
const otherTeam = { id: 'team-2', name: 'Ali Fakih' }
const worker = (id, name, assignedTeam = team) => ({
  id, full_name: name, team_id: assignedTeam.id, team_name: assignedTeam.name, team: assignedTeam,
  is_active: true, staff_classification: 'normal',
})
const workers = [worker('worker-1', 'FIRST WORKER'), worker('worker-2', 'SECOND WORKER'), worker('worker-3', 'OTHER WORKER', otherTeam)]
const attendance = workers.map((item, index) => ({
  id: `attendance-${index}`, worker_id: item.id, status: 'half_day', attendance_date: '2026-10-02',
  check_in: '07:30:00', check_out: null, updated_at: `2026-10-02T17:00:0${index}Z`,
  attendance_source: 'biometric', manual_override: false,
}))

vi.mock('../api/workersApi', () => ({ getWorkersRequest: mocks.workers }))
vi.mock('../api/attendanceApi', () => ({ getAttendanceRequest: mocks.attendance }))
vi.mock('../api/workerControlData', () => ({ clearWorkerControlDataCache: mocks.clear }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => {
  const query = { select: () => query, eq: () => query, then: (resolve, reject) => Promise.resolve({
    data: workers.map((item, index) => ({ worker_id: item.id, device_employee_no: `02${index + 1}` })), error: null,
  }).then(resolve, reject) }
  return { from: () => query, rpc: mocks.rpc }
} }))

beforeEach(() => {
  localStorage.setItem('workers_app_language', 'en')
  mocks.workers.mockResolvedValue({ data: workers })
  mocks.attendance.mockResolvedValue({ data: attendance })
  mocks.rpc.mockResolvedValue({ data: { updated: 2, skipped: 0, failed: 0, results: [] }, error: null })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const open = () => render(<LanguageProvider><BulkEmergencyOvertime /></LanguageProvider>)
const chooseTeam = async (name = 'Zarour') => {
  await screen.findByRole('option', { name })
  fireEvent.change(screen.getByLabelText('Team'), { target: { value: name === 'Zarour' ? team.id : otherTeam.id } })
}

describe('simplified bulk emergency overtime page', () => {
  it('changes date and shows only the selected team with the seven requested columns', async () => {
    open()
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-02' } })
    await waitFor(() => expect(mocks.attendance).toHaveBeenCalledWith({ date: '2026-10-02', paginate: true }))
    await chooseTeam('Ali Fakih')
    expect(screen.getByText('OTHER WORKER')).toBeTruthy()
    expect(screen.queryByText('FIRST WORKER')).toBeNull()
    expect(screen.getAllByRole('columnheader')).toHaveLength(7)
    await chooseTeam()
    expect(screen.getByText('FIRST WORKER')).toBeTruthy()
    expect(screen.getByText('SECOND WORKER')).toBeTruthy()
    expect(screen.queryByText('OTHER WORKER')).toBeNull()
  })

  it('selects all team workers and sends one common checkout through the protected RPC', async () => {
    open()
    await chooseTeam()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all workers in team' }))
    expect(screen.getByText(/Shown: 2 .* Selected: 2/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Common checkout time'), { target: { value: '21:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save overtime' }))
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(screen.getByText('Confirm emergency entry · 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1))
    expect(mocks.rpc.mock.calls[0][0]).toBe('admin_apply_bulk_emergency_overtime')
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_mode: 'manual_checkout', p_reason: 'Emergency manual overtime',
      p_entries: [
        { worker_id: 'worker-1', checkout: '21:00', expected_updated_at: attendance[0].updated_at },
        { worker_id: 'worker-2', checkout: '21:00', expected_updated_at: attendance[1].updated_at },
      ],
    })
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledTimes(1))
  })

  it('allows individual selection and an individual checkout override', async () => {
    open()
    await chooseTeam()
    fireEvent.click(screen.getByRole('checkbox', { name: 'FIRST WORKER' }))
    fireEvent.change(screen.getByLabelText('Individual checkout: FIRST WORKER'), { target: { value: '22:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save overtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1))
    expect(mocks.rpc.mock.calls[0][1].p_entries).toEqual([
      { worker_id: 'worker-1', checkout: '22:30', expected_updated_at: attendance[0].updated_at },
    ])
  })

  it('searches names case-insensitively within the selected team without new requests', async () => {
    open()
    await chooseTeam()
    const callsBeforeSearch = mocks.attendance.mock.calls.length
    fireEvent.change(screen.getByLabelText('Search worker or biometric ID'), { target: { value: 'fIrSt' } })
    expect(screen.getByText('FIRST WORKER')).toBeTruthy()
    expect(screen.queryByText('SECOND WORKER')).toBeNull()
    expect(screen.queryByText('OTHER WORKER')).toBeNull()
    expect(screen.getByText(/Shown: 1 .* Selected: 0/)).toBeTruthy()
    expect(mocks.attendance).toHaveBeenCalledTimes(callsBeforeSearch)
  })

  it('searches biometric IDs and never includes a worker from another team', async () => {
    open()
    await chooseTeam()
    fireEvent.change(screen.getByLabelText('Search worker or biometric ID'), { target: { value: '022' } })
    expect(screen.getByText('SECOND WORKER')).toBeTruthy()
    expect(screen.queryByText('FIRST WORKER')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search worker or biometric ID'), { target: { value: '023' } })
    expect(screen.queryByText('OTHER WORKER')).toBeNull()
    expect(screen.getByText('No workers match the search')).toBeTruthy()
  })

  it('selects only visible search results and preserves selection when search is cleared', async () => {
    open()
    await chooseTeam()
    const search = screen.getByLabelText('Search worker or biometric ID')
    fireEvent.change(search, { target: { value: 'FIRST' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select visible' }))
    expect(screen.getByText(/Shown: 1 .* Selected: 1/)).toBeTruthy()
    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getByRole('checkbox', { name: 'FIRST WORKER' }).checked).toBe(true)
    expect(screen.getByRole('checkbox', { name: 'SECOND WORKER' }).checked).toBe(false)
    expect(screen.getByText(/Shown: 2 .* Selected: 1/)).toBeTruthy()
  })

  it('keeps Select all workers in team independent of the search filter', async () => {
    open()
    await chooseTeam()
    fireEvent.change(screen.getByLabelText('Search worker or biometric ID'), { target: { value: 'FIRST' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all workers in team' }))
    expect(screen.getByText(/Shown: 1 .* Selected: 2/)).toBeTruthy()
  })

  it('keeps hidden selections in the unchanged save payload', async () => {
    open()
    await chooseTeam()
    fireEvent.click(screen.getByRole('checkbox', { name: 'FIRST WORKER' }))
    fireEvent.change(screen.getByLabelText('Search worker or biometric ID'), { target: { value: '022' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select visible' }))
    expect(screen.getByText(/Shown: 1 .* Selected: 2/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save overtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1))
    expect(mocks.rpc.mock.calls[0][1].p_entries).toEqual([
      { worker_id: 'worker-1', checkout: '21:00', expected_updated_at: attendance[0].updated_at },
      { worker_id: 'worker-2', checkout: '21:00', expected_updated_at: attendance[1].updated_at },
    ])
  })

  it('keeps direct duration behind Advanced options without fabricating checkout', async () => {
    open()
    await chooseTeam()
    expect(screen.getByText('Advanced options').closest('details').open).toBe(false)
    fireEvent.click(screen.getByText('Advanced options'))
    fireEvent.click(screen.getByLabelText('Enter overtime duration manually'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'FIRST WORKER' }))
    fireEvent.change(screen.getByLabelText('Overtime duration (h:mm)'), { target: { value: '3h30' } })
    fireEvent.change(screen.getByLabelText('Additional note'), { target: { value: 'Power outage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save overtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1))
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_mode: 'manual_overtime_duration', p_reason: 'Emergency manual overtime', p_note: 'Power outage',
      p_entries: [{ worker_id: 'worker-1', minutes: 210, expected_updated_at: attendance[0].updated_at }],
    })
    expect(mocks.rpc.mock.calls[0][1].p_entries[0]).not.toHaveProperty('checkout')
  })

  it('shows a compact skipped result without changing payroll or attendance in the UI', async () => {
    mocks.rpc.mockResolvedValue({ data: { updated: 0, skipped: 1, failed: 0, results: [
      { worker_id: 'worker-1', outcome: 'skipped', reason: 'payroll_finalized_or_paid' },
    ] }, error: null })
    open()
    await chooseTeam()
    fireEvent.click(screen.getByRole('checkbox', { name: 'FIRST WORKER' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save overtime' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and save' }))
    const result = await screen.findByRole('status')
    expect(result.textContent).toContain('Updated: 0 · Skipped: 1 · Failed: 0')
    fireEvent.click(within(result).getByText('Processing result'))
    expect(result.textContent).toContain('payroll_finalized_or_paid')
  })
})
