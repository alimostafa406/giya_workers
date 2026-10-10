// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AppRouter from './AppRouter.jsx'
import { LanguageProvider } from '../i18n/LanguageContext.jsx'

globalThis.React = React
const mocks = vi.hoisted(() => ({ teams: vi.fn(), supervisors: vi.fn(), workers: vi.fn(), mappings: vi.fn(), bootstrap: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } } }))
vi.mock('../store/authStore', () => ({ useAuthStore: (selector) => selector({ isReady: true, admin: { id: 'admin' }, bootstrapUser: mocks.bootstrap, logout: vi.fn() }) }))
vi.mock('../api/teamsApi', () => ({ getTeamsRequest: mocks.teams, createTeamRequest: vi.fn(), updateTeamRequest: vi.fn() }))
vi.mock('../api/supervisorsApi', () => ({ getSupervisorsRequest: mocks.supervisors }))
vi.mock('../api/workersApi', () => ({ getWorkersRequest: mocks.workers }))
vi.mock('../api/biometricMappingApi', () => ({ getBiometricMappingsRequest: mocks.mappings }))

beforeEach(() => {
  window.history.replaceState(null, '', '/teams')
  localStorage.setItem('workers_app_language', 'en')
  mocks.teams.mockResolvedValue({ data: [
    { id: 'zarour', name: 'Zarour', is_active: true },
    { id: 'paint', name: 'Peinture Raghibe', is_active: true },
  ] })
  mocks.supervisors.mockResolvedValue({ data: [] })
  mocks.workers.mockResolvedValue({ data: [
    { id: 'one', team_id: 'zarour', full_name: 'JEREMIE', employee_code: '1', is_active: true },
    { id: 'other', team_id: 'paint', full_name: 'MATAMATA', employee_code: '339', is_active: true },
  ] })
  mocks.mappings.mockResolvedValue({ data: [
    { worker_id: 'one', device_employee_no: '204', is_active: true, mapping_review_state: 'confirmed' },
    { worker_id: 'other', device_employee_no: '55550008', is_active: true, mapping_review_state: 'confirmed' },
  ] })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('actual admin Teams route', () => {
  it('renders a visible print action in every team row and prints only that team', async () => {
    const printDocument = { write: vi.fn(), close: vi.fn() }
    const printWindow = { document: printDocument, focus: vi.fn(), print: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(printWindow)
    render(<LanguageProvider><AppRouter /></LanguageProvider>)

    const zarourRow = (await screen.findByText('Zarour')).closest('tr')
    const paintRow = screen.getByText('Peinture Raghibe').closest('tr')
    expect(zarourRow).not.toBeNull()
    expect(paintRow).not.toBeNull()
    const zarourButton = within(zarourRow).getByRole('button', { name: 'Print Team Workers' })
    expect(within(paintRow).getByRole('button', { name: 'Print Team Workers' })).toBeTruthy()
    expect(zarourButton.closest('td')).toBe(zarourRow.cells[0])
    await waitFor(() => expect(zarourButton.disabled).toBe(false))
    fireEvent.click(zarourButton)
    const html = printDocument.write.mock.calls[0][0]
    expect(html).toContain('<h1>Zarour</h1>')
    expect(html).toContain('JEREMIE')
    expect(html).toContain('>204</td>')
    expect(html).not.toContain('MATAMATA')
    expect(html).not.toMatch(/<th>[^<]*(payroll|wage|salary|overtime|attendance|transport)[^<]*<\/th>/i)
    expect(printWindow.print).toHaveBeenCalledOnce()
  })
})
