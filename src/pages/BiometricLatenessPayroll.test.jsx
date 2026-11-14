// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '../i18n/LanguageContext'
import TeamWeeklyReport from './TeamWeeklyReport'
import WeeklyPayrollSheet from '../components/Payroll/WeeklyPayrollSheet'
import { calculateWeeklyPayoutLine } from '../utils/weeklyPayoutLines'
import { renderedPayrollTableHtml } from '../utils/printRenderedPayroll'
import { weeklyDates } from '../utils/payrollCalculations'
globalThis.React = React
const mock = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../api/payrollOperationsApi', () => ({ getPayrollOperationsDataRequest: mock.load }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); window.history.replaceState({}, '', '/') })
it.each(['weekly', 'monthly'])('%s deductions render identically in main payroll, team report and both print paths', async payment_type => {
  const date = '2026-11-09'
  const worker = { id: 'w', full_name: 'Reviewed late worker', employee_code: '1', team_id: 'team', team_name: 'Team', is_active: true, staff_classification: 'normal', payment_type,
    payroll_compensation: { daily_rate: 10000, daily_transport_allowance: 6000, overtime_rate_per_hour: 1000, currency_code: 'CDF' } }
  const attendance = { id: 'a', worker_id: 'w', attendance_date: date, status: 'present', attendance_day_fraction: 1, attendance_source: 'biometric', check_in: '08:35:00', check_out: '17:00:00' }
  const data = { workers: [worker], attendance: [attendance], rules: {}, holidays: [], runs: [], payrollLines: [], latenessReviews: [{ worker, attendance,
    evidence: { source_fingerprint: 'fp', raw_minutes: 35 }, review: { decision: 'approved', source_fingerprint: 'fp' },
    payroll_source: { date, version: 1, source_fingerprint: 'fp', deduction_amount: 2000, approved_minutes: 30 } }] }
  const line = calculateWeeklyPayoutLine(data, date, worker)
  localStorage.setItem('workers_app_language', 'ar')
  const view = render(<LanguageProvider><WeeklyPayrollSheet lines={[line]} dates={weeklyDates(date)} onEdit={() => {}} /></LanguageProvider>)
  expect(screen.getByRole('columnheader', { name: 'خصم التأخير' })).toBeTruthy()
  const row = view.container.querySelector('tbody tr')
  expect(row.cells[11].textContent).toContain('2,000')
  const mainPrint = new DOMParser().parseFromString(renderedPayrollTableHtml(view.container), 'text/html')
  expect(mainPrint.querySelector('tbody tr').cells[11].textContent).toBe(row.cells[11].textContent)
  expect(mainPrint.querySelector('tbody tr').cells[14].textContent).toBe(row.cells[14].textContent)
  cleanup(); window.history.replaceState({}, '', `/?date=${date}`)
  mock.load.mockResolvedValue(data)
  const popup = { document: { write: vi.fn(), close: vi.fn(), fonts: { ready: Promise.resolve() } }, focus: vi.fn(), print: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(popup)
  render(<LanguageProvider><TeamWeeklyReport /></LanguageProvider>)
  await screen.findByText(worker.full_name)
  const team = screen.getByRole('region', { name: 'تقرير الفريق: Team' }), teamRow = team.querySelector('tbody tr')
  expect(teamRow.cells[12].textContent).toContain('2,000')
  expect(team.querySelector('tfoot tr').cells[12].textContent).toContain('2,000')
  fireEvent.click(screen.getByRole('button', { name: 'طباعة كل الفرق', exact: true }))
  const print = new DOMParser().parseFromString(popup.document.write.mock.calls[0][0], 'text/html')
  expect(print.querySelector('.team-report-team tbody tr').textContent).toBe(teamRow.textContent)
  expect(print.querySelector('.team-report-summary tfoot tr').cells[7].textContent).toContain('2,000')
  expect(print.querySelectorAll('button,input')).toHaveLength(0)
})
