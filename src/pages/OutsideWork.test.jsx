// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LanguageProvider } from '../i18n/LanguageContext'
import OutsideWork from './OutsideWork'

globalThis.React = React
const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), remove: vi.fn(), workers: vi.fn() }))
vi.mock('../api/outsideWorkApi', () => ({ getOutsideWorkMovements: mocks.list,
  saveOutsideWorkMovement: mocks.save, deleteOutsideWorkMovement: mocks.remove }))
vi.mock('../api/workersApi', () => ({ getWorkersRequest: mocks.workers }))
vi.mock('../utils/attendanceOperationalGate', () => ({ kinshasaClock: () => ({ date: '2026-10-13' }) }))

const movement = { id: 'movement-1', work_date: '2026-10-13', foreman_worker_id: 'worker-1',
  foreman_name: 'FOREMAN', start_time: '08:00:00', end_time: '20:00:00', note: '',
  outside_work_movement_workers: [{ id: 'child-1', worker_id: 'worker-2', worker_name: 'ACTIVE WORKER',
    start_time: '09:00:00', end_time: '17:00:00' }] }
beforeEach(() => {
  localStorage.setItem('workers_app_language', 'en')
  mocks.list.mockResolvedValue([movement])
  mocks.save.mockResolvedValue('movement-1')
  mocks.remove.mockResolvedValue(undefined)
  mocks.workers.mockResolvedValue({ data: [
    { id: 'worker-1', full_name: 'FOREMAN', is_active: true },
    { id: 'worker-2', full_name: 'ACTIVE WORKER', is_active: true },
    { id: 'worker-3', full_name: 'INACTIVE WORKER', is_active: false },
  ] })
  window.confirm = vi.fn(() => true)
  window.print = vi.fn()
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
const open = () => render(<LanguageProvider><OutsideWork /></LanguageProvider>)

describe('outside-work page', () => {
  it('hides worker details until expanded, and displays foreman duration', async () => {
    open()
    await screen.findByText('FOREMAN', { selector: 'strong' })
    expect(screen.queryByText('ACTIVE WORKER')).toBeNull()
    expect(screen.getByText('Duration: 12 h')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show workers (1)' }))
    expect(screen.getByText('ACTIVE WORKER')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide workers' }))
    expect(screen.queryByText('ACTIVE WORKER')).toBeNull()
  })
  it('creates and edits through only the outside-work RPC wrapper, with active selections', async () => {
    open()
    await screen.findByText('FOREMAN', { selector: 'strong' })
    fireEvent.click(screen.getByRole('button', { name: 'Add foreman movement' }))
    const form = screen.getByRole('form', { name: 'Add foreman movement' })
    expect(within(form).queryByText('INACTIVE WORKER')).toBeNull()
    fireEvent.change(within(form).getByLabelText('Foreman name'), { target: { value: 'NEW FOREMAN' } })
    fireEvent.click(within(form).getByRole('checkbox', { name: 'ACTIVE WORKER' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      id: null, foreman_name: 'NEW FOREMAN', workers: [expect.objectContaining({ worker_id: 'worker-2' })],
    })))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(within(screen.getByRole('form', { name: 'Add foreman movement' })).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'movement-1' })))
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('deletes only the selected movement after confirmation', async () => {
    open(); await screen.findByText('FOREMAN', { selector: 'strong' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('movement-1'))
  })
  it('prints a foreman-only weekly report without worker details or payroll data', async () => {
    const { container } = open()
    await screen.findByText('FOREMAN', { selector: 'strong' })
    fireEvent.change(screen.getByLabelText('Select a foreman'), { target: { value: 'worker:worker-1' } })
    const print = container.querySelector('.outside-work-print')
    expect(print.textContent).toContain('FOREMAN')
    expect(print.textContent).toContain('12 h')
    expect(print.textContent).toContain('Worker count')
    expect(print.textContent).not.toContain('ACTIVE WORKER')
    expect(print.textContent).not.toMatch(/payroll|attendance|biometric|wage/i)
    fireEvent.click(screen.getByRole('button', { name: 'Print Weekly Foreman Report' }))
    expect(window.print).toHaveBeenCalledOnce()
  })
})
