// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Teams from './Teams.jsx'
import { LanguageProvider } from '../i18n/LanguageContext.jsx'

globalThis.React = React
const mocks = vi.hoisted(() => ({ teams: vi.fn(), supervisors: vi.fn(), workers: vi.fn(), mappings: vi.fn() }))
vi.mock('../api/teamsApi', () => ({ getTeamsRequest: mocks.teams, createTeamRequest: vi.fn(), updateTeamRequest: vi.fn() }))
vi.mock('../api/supervisorsApi', () => ({ getSupervisorsRequest: mocks.supervisors }))
vi.mock('../api/workersApi', () => ({ getWorkersRequest: mocks.workers }))
vi.mock('../api/biometricMappingApi', () => ({ getBiometricMappingsRequest: mocks.mappings }))

beforeEach(() => {
  localStorage.setItem('workers_app_language', 'en')
  mocks.teams.mockResolvedValue({ data: [
    { id: 'zarour', name: 'Zarour', is_active: true, workers: [{ id: 'one', full_name: 'JEREMIE' }] },
    { id: 'paint', name: 'Peinture Raghibe', is_active: true, workers: [{ id: 'other', full_name: 'MATAMATA' }] },
  ] })
  mocks.supervisors.mockResolvedValue({ data: [] })
  mocks.workers.mockResolvedValue({ data: [
    { id: 'one', team_id: 'zarour', full_name: 'JEREMIE', employee_code: '1', is_active: true },
    { id: 'two', team_id: 'zarour', full_name: 'ROBERT', employee_code: '79', is_active: false },
    { id: 'other', team_id: 'paint', full_name: 'MATAMATA', employee_code: '339', is_active: true },
  ] })
  mocks.mappings.mockResolvedValue({ data: [
    { worker_id: 'one', device_employee_no: '204', is_active: true, mapping_review_state: 'confirmed' },
    { worker_id: 'two', device_employee_no: '79', is_active: true, mapping_review_state: 'confirmed' },
    { worker_id: 'other', device_employee_no: '55550008', is_active: true, mapping_review_state: 'confirmed' },
  ] })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('Teams worker-list print actions', () => {
  it('shows one localized print button per team and prints only the chosen team', async () => {
    const printDocument = { write: vi.fn(), close: vi.fn() }
    const printWindow = { document: printDocument, focus: vi.fn(), print: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(printWindow)
    render(<LanguageProvider><Teams /></LanguageProvider>)
    const buttons = await screen.findAllByRole('button', { name: 'Print Team Workers' })
    expect(buttons).toHaveLength(2)
    await waitFor(() => expect(buttons[0].disabled).toBe(false))
    fireEvent.click(buttons[0])
    const html = printDocument.write.mock.calls[0][0]
    expect(html).toContain('<h1>Zarour</h1>')
    expect(html).toContain('JEREMIE')
    expect(html).toContain('ROBERT')
    expect(html).toContain('>204</td>')
    expect(html).not.toContain('MATAMATA')
    expect(printWindow.print).toHaveBeenCalledOnce()
  })

  it('does not print incomplete lists when the canonical worker read fails', async () => {
    mocks.workers.mockRejectedValueOnce(new Error('Unavailable'))
    const open = vi.spyOn(window, 'open')
    render(<LanguageProvider><Teams /></LanguageProvider>)
    const buttons = await screen.findAllByRole('button', { name: 'Print Team Workers' })
    await screen.findByText('The worker list or biometric IDs could not be loaded for printing.')
    expect(buttons.every((button) => button.disabled)).toBe(true)
    expect(open).not.toHaveBeenCalled()
  })
})
