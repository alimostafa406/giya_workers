// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import TeamWeeklyReport from './TeamWeeklyReport'
import { LanguageProvider } from '../i18n/LanguageContext'
import { outsideWorkMarkerLabels } from '../utils/outsideWorkTeamMarkers'
globalThis.React = React
const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../api/payrollOperationsApi', () => ({ getPayrollOperationsDataRequest: mocks.load }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); window.history.replaceState({}, '', '/') })
it('real team payout page renders dated O visitors separately from financial rows, including print DOM', async () => {
  window.history.replaceState({}, '', '/payroll/team-weekly-report?date=2026-10-12')
  mocks.load.mockResolvedValue({ workers: [{ id: 'w', full_name: 'Visitor', employee_code: '23', team_id: 'siraj', team_name: 'Siraj',
    is_active: true, staff_classification: 'normal', payment_type: 'weekly',
    payroll_compensation: { daily_rate: 100, daily_transport_allowance: 0, currency_code: 'CDF', overtime_rate_per_hour: 60 } }],
    attendance: [{ worker_id: 'w', attendance_date: '2026-10-12', status: 'present', attendance_source: 'outside_work', attendance_day_fraction: 1 }],
    outsideWorkMovements: [{ id: 'm', status: 'final', work_date: '2026-10-12', team_id: 'mostafa', team: { name: 'Mostafa' },
      outside_work_movement_workers: [{ worker_id: 'w', start_time: '08:00', end_time: '18:00' }] }], runs: [], payrollLines: [], rules: {}, holidays: [] })
  render(<LanguageProvider><TeamWeeklyReport /></LanguageProvider>)
  const markers = await screen.findByRole('region', { name: outsideWorkMarkerLabels.ar.title })
  const row = within(markers).getByText('Visitor').closest('tr')
  expect([...row.cells].map((cell) => cell.textContent)).toEqual(['Visitor', '23', 'Siraj', 'O', '—', '—', '—', '—', '—'])
  expect(markers.closest('.team-report-team').textContent).toContain('Mostafa')
  expect(markers.closest('.team-report-all')).not.toBeNull()
  expect(markers.querySelector('button')).toBeNull()
  expect(within(markers).queryByText('60')).toBeNull()
  const popup = { document: { open: vi.fn(), write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(popup)
  fireEvent.click(screen.getByRole('button', { name: 'طباعة كل الفرق' }))
  await waitFor(() => expect(popup.print).toHaveBeenCalledOnce())
  const html = popup.document.write.mock.calls[0][0]
  expect(html).toContain('outside-work-team-markers')
  expect(html).toContain('Mostafa')
  expect(html).toContain('<td>O</td>')
})
