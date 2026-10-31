// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Payroll from './Payroll'
import { LanguageProvider } from '../i18n/LanguageContext'
import TeamWeeklyReport from './TeamWeeklyReport'

globalThis.React = React
const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../api/payrollOperationsApi', () => ({ getPayrollOperationsDataRequest: mocks.load }))
vi.mock('../components/Payroll/PayrollOperations', () => ({ default: () => <div>Existing weekly payroll</div> }))
vi.mock('../components/Payroll/MonthlyPayrollOperations', () => ({ default: () => <div>Existing monthly payroll</div> }))
vi.mock('../components/Payroll/PayrollHistory', () => ({ default: () => <div>Existing history</div> }))
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/') })

it('real Payroll page exposes one primary report link and clicking opens the report route', () => {
  render(<LanguageProvider><MemoryRouter initialEntries={['/payroll']}><Routes>
    <Route path="/payroll" element={<Payroll />} />
    <Route path="/payroll/team-weekly-report" element={<h1>Team payout destination</h1>} />
  </Routes></MemoryRouter></LanguageProvider>)
  expect(screen.getByText('Existing weekly payroll')).toBeTruthy()
  const links = screen.getAllByRole('link', { name: 'تقرير قبض الفرق' })
  expect(links).toHaveLength(1)
  expect(links[0].className).toContain('btn-primary')
  expect(links[0].getAttribute('href')).toBe('/payroll/team-weekly-report')
  expect(links[0].closest('details')).toBeNull()
  expect(links[0].closest('header')).not.toBeNull()
  expect(links[0].className).toContain('w-full')
  fireEvent.click(links[0])
  expect(screen.getByRole('heading', { name: 'Team payout destination' })).toBeTruthy()
})

it('clicking the prominent payroll action reaches the canonical report with daily OT and all-teams print', async () => {
  localStorage.setItem('workers_app_language', 'ar')
  window.history.replaceState({}, '', '/payroll?date=2026-10-19')
  mocks.load.mockResolvedValue({ workers: ['A', 'B'].map(id => ({ id, full_name: `Worker ${id}`, employee_code: id,
    team_id: id, team_name: `Team ${id}`, is_active: true, staff_classification: 'normal', payment_type: 'weekly',
    payroll_compensation: { daily_rate: 100, daily_transport_allowance: 0, overtime_rate_per_hour: 60, currency_code: 'CDF' } })),
    attendance: [{ worker_id: 'A', attendance_date: '2026-10-19', status: 'present', attendance_source: 'manual',
      manual_override: true, emergency_overtime_mode: 'manual_overtime_duration', emergency_overtime_minutes: 180 }],
    rules: {}, holidays: [], runs: [], payrollLines: [] })
  render(<LanguageProvider><MemoryRouter initialEntries={['/payroll']}><Routes>
    <Route path="/payroll" element={<Payroll />} />
    <Route path="/payroll/team-weekly-report" element={<TeamWeeklyReport />} />
  </Routes></MemoryRouter></LanguageProvider>)
  fireEvent.click(screen.getByRole('link', { name: 'تقرير قبض الفرق' }))
  const worker = await screen.findByText('Worker A')
  expect(worker.closest('tr').querySelector('.team-report-day').textContent.trim()).toBe('حاضر 3h')
  const popup = { document: { open: vi.fn(), write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(popup)
  fireEvent.click(screen.getByRole('button', { name: 'طباعة كل الفرق' }))
  await waitFor(() => expect(popup.print).toHaveBeenCalledOnce())
  const html = popup.document.write.mock.calls[0][0], doc = new DOMParser().parseFromString(html, 'text/html')
  expect(doc.querySelectorAll('.team-report-team')).toHaveLength(2)
  expect(doc.querySelector('.team-report-summary')).not.toBeNull()
  expect(html).toContain('A4 landscape')
  expect(doc.body.textContent).toContain('حاضر 3h')
})
