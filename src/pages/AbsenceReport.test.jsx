// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AbsenceReport from './AbsenceReport.jsx'
import { LanguageProvider } from '../i18n/LanguageContext.jsx'

globalThis.React = React
const mocks = vi.hoisted(() => ({ workers: vi.fn(), teams: vi.fn(), attendance: vi.fn(), mappings: vi.fn() }))
vi.mock('../api/workersApi', () => ({ getWorkersRequest: mocks.workers }))
vi.mock('../api/teamsApi', () => ({ getTeamsRequest: mocks.teams }))
vi.mock('../api/attendanceApi', () => ({ getAttendanceRequest: mocks.attendance }))
vi.mock('../api/biometricMappingApi', () => ({ getWorkerBiometricSearchIndexRequest: mocks.mappings }))

beforeEach(() => {
  localStorage.setItem('workers_app_language', 'en')
  mocks.workers.mockResolvedValue({ data: [
    { id: 'mapped', full_name: 'NIVA', employee_code: '211', team_id: 'team', team_name: 'Cleaner', team: { id: 'team', name: 'Cleaner' }, is_active: true, staff_classification: 'normal' },
    { id: 'unmapped', full_name: 'JOHN', employee_code: '212', team_id: 'team', team_name: 'Cleaner', team: { id: 'team', name: 'Cleaner' }, is_active: true, staff_classification: 'normal' },
  ] })
  mocks.teams.mockResolvedValue({ data: [{ id: 'team', name: 'Cleaner', is_active: true }] })
  mocks.attendance.mockResolvedValue({ data: [] })
  mocks.mappings.mockResolvedValue({ data: [
    { worker_id: 'mapped', device_employee_no: '064', is_active: true, mapping_review_state: 'confirmed' },
    { worker_id: 'unmapped', device_employee_no: '084', is_active: true, mapping_review_state: 'needs_review' },
  ] })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('absence-report Biometric ID display', () => {
  it('shows confirmed IDs and fallback in the same printable today layout without changing counts', async () => {
    const { container } = render(<MemoryRouter><LanguageProvider><AbsenceReport /></LanguageProvider></MemoryRouter>)
    fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: '2026-09-03' } })
    const article = container.querySelector('.absence-report-print-root')
    await waitFor(() => expect(within(article).getByText('#064')).toBeTruthy())
    const cards = [...article.querySelectorAll('.absence-worker-card')]
    expect(cards).toHaveLength(2)
    expect(cards.find((card) => card.textContent.includes('NIVA')).textContent).toContain('211#064')
    expect(cards.find((card) => card.textContent.includes('JOHN')).textContent).toContain('—')
    expect(article.textContent).not.toContain('Biometric ID:')
    expect(article.textContent).toContain('Workers missing a morning punch')
  })

  it('renders compact #14, #070, and #084 without numeric conversion', async () => {
    mocks.workers.mockResolvedValue({ data: ['14', '070', '084'].map((id) => ({
      id, full_name: `WORKER ${id}`, employee_code: id, team_id: 'team', team_name: 'Cleaner',
      team: { id: 'team', name: 'Cleaner' }, is_active: true, staff_classification: 'normal',
    })) })
    mocks.mappings.mockResolvedValue({ data: ['14', '070', '084'].map((id) => ({
      worker_id: id, device_employee_no: id, is_active: true, mapping_review_state: 'confirmed',
    })) })
    const { container } = render(<MemoryRouter><LanguageProvider><AbsenceReport /></LanguageProvider></MemoryRouter>)
    fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: '2026-09-03' } })
    await waitFor(() => expect(container.querySelectorAll('.absence-worker-card')).toHaveLength(3))
    const article = container.querySelector('.absence-report-print-root')
    for (const id of ['14', '070', '084']) expect(within(article).getByText(`#${id}`)).toBeTruthy()
  })

  it('places Biometric ID immediately after Employee Code in the printable week table', async () => {
    const { container } = render(<MemoryRouter><LanguageProvider><AbsenceReport /></LanguageProvider></MemoryRouter>)
    fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: '2026-09-03' } })
    fireEvent.click(screen.getByRole('button', { name: 'This week' }))
    await waitFor(() => expect(container.querySelectorAll('.absence-week-table tbody tr')).toHaveLength(2))
    const table = container.querySelector('.absence-report-print-root .absence-week-table')
    expect([...table.querySelectorAll('thead th')].slice(0, 3).map((cell) => cell.textContent)).toEqual(['Worker', 'Employee code', 'Biometric ID'])
    const rows = [...table.querySelectorAll('tbody tr')]
    expect(rows.find((row) => row.textContent.includes('NIVA')).querySelectorAll('td')[2].textContent).toBe('064')
    expect(rows.find((row) => row.textContent.includes('JOHN')).querySelectorAll('td')[2].textContent).toBe('—')
  })
})
