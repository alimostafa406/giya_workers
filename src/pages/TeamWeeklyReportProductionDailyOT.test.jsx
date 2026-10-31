// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { LanguageProvider } from '../i18n/LanguageContext'
import TeamWeeklyReport from './TeamWeeklyReport'
import WeeklyPayrollSheet from '../components/Payroll/WeeklyPayrollSheet'
import { teamWeeklyReport } from '../utils/teamWeeklyReport'
import { weeklyPayoutLines } from '../utils/weeklyPayoutLines'
import { teamReportDayOvertime } from '../utils/teamWeeklyReportDayOvertime'
import { renderedPayrollTableHtml } from '../utils/printRenderedPayroll'
const api = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../api/payrollOperationsApi', () => ({ getPayrollOperationsDataRequest: api.load }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: vi.fn() }))
globalThis.React = React
const week = '2026-10-26', dates = ['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31']
function fixture() {
  if (process.env.PAYROLL_PRODUCTION_AUDIT_INPUT) return JSON.parse(readFileSync(process.env.PAYROLL_PRODUCTION_AUDIT_INPUT, 'utf8'))
  const workers = ['LOUANGE', 'JEANCY'].map((full_name, i) => ({ id: full_name, full_name, employee_code: i ? '38' : '41', team_id: 't', team_name: 'Team',
    is_active: true, staff_classification: 'normal', payment_type: i ? 'monthly' : 'weekly', payroll_compensation: {
      daily_rate: 100, daily_transport_allowance: 0, overtime_rate_per_hour: 60, currency_code: 'CDF' } }))
  const attendance = workers.map((w, i) => ({ id: `a${i}`, worker_id: w.id, attendance_date: dates[4], status: 'present', attendance_source: 'biometric',
    manual_override: false, attendance_day_fraction: 1, check_in: i ? '08:01:34' : '07:50:41', check_out: i ? '00:03:47' : '00:03:30',
    biometric_sync_metadata: { check_out_event_timestamp: i ? '2026-10-31T00:03:47+01:00' : '2026-10-31T00:03:30+01:00' } }))
  return { workers, attendance, biometricOvertimeReviews: workers.map((worker, i) => ({ worker, attendance: attendance[i], source_fingerprint: 'same',
    review: { decision: 'approved', minutes: 423, source_fingerprint: 'same', version: 1 } })),
    weeklyOvertimeOverrides: [], outsideWorkMovements: [], runs: [], payrollLines: [], rules: {}, holidays: [] }
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); window.history.replaceState({}, '', '/') })
it('LOUANGE and JEANCY: approved cross-midnight Friday minutes reach the canonical report and Print All Teams', async () => {
  const data = fixture(), before = JSON.stringify(data), report = teamWeeklyReport(data, week)
  for (const line of report.lines) {
    expect(line.minutes).toBe(423)
    expect(dates.map(date => teamReportDayOvertime(line, date))).toEqual([0,0,0,0,423,0])
    console.log(JSON.stringify({ worker: line.worker.full_name, weekly: line.minutes, override: line.weeklyManualOverrideMinutes,
      daily: line.payableOvertimeDays.map(day => ({ date: day.date, source: day.source, minutes: day.minutes, renderer: teamReportDayOvertime(line, day.date) })) }))
  }
  api.load.mockResolvedValue(data); localStorage.setItem('workers_app_language','ar'); window.history.replaceState({}, '', `/?date=${week}`)
  render(<LanguageProvider><TeamWeeklyReport /></LanguageProvider>)
  for (const name of ['LOUANGE', 'JEANCY']) {
    const cell = (await screen.findByText(name)).closest('tr').querySelectorAll('.team-report-day')[4]
    expect(cell.textContent.trim()).toBe('حاضر 7h03')
  }
  const popup = { document: { open: vi.fn(), write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(popup)
  fireEvent.click(screen.getByRole('button', { name: 'طباعة كل الفرق' }))
  await waitFor(() => expect(popup.print).toHaveBeenCalledOnce())
  const doc = new DOMParser().parseFromString(popup.document.write.mock.calls[0][0], 'text/html')
  for (const name of ['LOUANGE','JEANCY']) {
    const row = [...doc.querySelectorAll('tbody tr')].find(row => row.textContent.includes(name))
    expect(row.querySelectorAll('.team-report-day')[4].textContent.trim()).toBe('حاضر 7h03')
  }
  expect(JSON.stringify(data)).toBe(before)
})
it('the actual main payroll sheet uses the same dated OT text, not a separate status-only renderer', () => {
  const data = fixture(), lines = weeklyPayoutLines(data, week)
  localStorage.setItem('workers_app_language','ar')
  render(<LanguageProvider><WeeklyPayrollSheet lines={lines} dates={dates} onEdit={() => {}} /></LanguageProvider>)
  for (const name of ['LOUANGE','JEANCY']) {
    const row = screen.getByText(name).closest('tr')
    expect(row.cells[5].textContent.trim()).toBe('حاضر 7h03')
    const doc = new DOMParser().parseFromString(renderedPayrollTableHtml(row.closest('table')), 'text/html')
    const printedRow = [...doc.querySelectorAll('tbody tr')].find(row => row.textContent.includes(name))
    expect(printedRow.cells[5].textContent.trim()).toBe('حاضر 7h03')
  }
})
