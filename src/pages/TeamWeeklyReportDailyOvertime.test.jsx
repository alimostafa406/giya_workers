// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import TeamWeeklyReport from './TeamWeeklyReport'
import { LanguageProvider } from '../i18n/LanguageContext'
import { teamWeeklyReport, teamReportPrintCss } from '../utils/teamWeeklyReport'
import { weeklyPayoutLines } from '../utils/weeklyPayoutLines'
import { payrollDraftLinePayload } from '../api/payrollOperationsApi'
import { formatTeamReportDayOvertime, teamReportDayOvertime } from '../utils/teamWeeklyReportDayOvertime'
globalThis.React = React
const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../api/payrollOperationsApi', async importOriginal => ({ ...await importOriginal(), getPayrollOperationsDataRequest: mocks.load }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: vi.fn() }))
const week = '2026-10-19', end = '2026-10-24'
const dates = Array.from({ length: 6 }, (_, i) => `2026-10-${19 + i}`)
function fixture() {
  const worker = { id: 'w', full_name: 'DAILY WORKER', employee_code: '77', team_id: 'a', team_name: 'Team A', is_active: false,
    payment_type: 'weekly', staff_classification: 'normal', payroll_compensation: { daily_rate: 100, daily_transport_allowance: 0, overtime_rate_per_hour: 60, currency_code: 'CDF' } }
  const attendance = dates.map((attendance_date, i) => ({ id: `a${i}`, worker_id: 'w', attendance_date,
    status: [3, 5].includes(i) ? 'absent' : 'present', attendance_day_fraction: [3, 5].includes(i) ? 0 : 1,
    attendance_source: i === 2 ? 'outside_work' : i === 0 ? 'manual' : 'biometric',
    ...(i === 0 ? { manual_override: true, emergency_overtime_mode: 'manual_overtime_duration', emergency_overtime_minutes: 180 } : {}),
    ...(i === 4 ? { check_in: '08:00:00', check_out: '17:55:19' } : {}) }))
  return { workers: [worker, { ...worker, id: 'monthly', full_name: 'MONTHLY WORKER', team_id: 'b', team_name: 'Team B', payment_type: 'monthly', monthly_salary: 999999 }], attendance,
    weeklyOvertimeOverrides: [{ worker_id: 'monthly', week_start: week, minutes: 300 }],
    biometricOvertimeReviews: [{ worker, attendance: attendance[4], source_fingerprint: 'same', review: { decision: 'approved', minutes: 55, source_fingerprint: 'same', version: 1 } }],
    outsideWorkMovements: [{ id: 'm', work_date: dates[2], status: 'final', outside_work_movement_workers: [{ worker_id: 'w', start_time: '08:00', end_time: '18:30' }] }],
    rules: {}, holidays: [], runs: [], payrollLines: [] }
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); window.history.replaceState({}, '', '/') })
it.each([[30, '30 min'], [55, '55 min'], [65, '1h05'], [90, '1h30'], [135, '2h15'], [180, '3h'], [0, '']])('formats %s canonical minutes compactly', (minutes, text) => {
  expect(formatTeamReportDayOvertime(minutes)).toBe(text)
})
it.each(['pending', 'rejected', 'stale'])('%s biometric OT never becomes payable day text', decision => {
  const d = fixture(), review = d.biometricOvertimeReviews[0].review
  if (decision === 'stale') review.source_fingerprint = 'old'; else review.decision = decision
  const line = teamWeeklyReport(d, week).lines.find(l => l.worker.id === 'w')
  expect(teamReportDayOvertime(line, dates[4])).toBe(0)
  expect(line.minutes).toBe(270)
})
it('weekly override including explicit zero is never distributed or added to daily OT', () => {
  const d = fixture()
  for (const minutes of [360, 0]) {
    d.weeklyOvertimeOverrides = [{ worker_id: 'w', week_start: week, minutes }]
    const line = teamWeeklyReport(d, week).lines.find(l => l.worker.id === 'w')
    expect(line.minutes).toBe(minutes)
    expect(dates.map(date => teamReportDayOvertime(line, date))).toEqual([0, 0, 0, 0, 0, 0])
  }
})
it('frozen daily OT comes only from the saved ledger and keeps the saved weekly total', () => {
  const d = fixture(), lines = weeklyPayoutLines(d, week)
  d.payrollLines = lines.map(line => payrollDraftLinePayload('run', line, week, end, end))
  d.runs = [{ id: 'run', payment_type: 'weekly', weekly_period_start: week, weekly_period_end: end, status: 'paid' }]
  const saved = JSON.stringify(d.payrollLines)
  d.attendance = []; d.outsideWorkMovements = []; d.biometricOvertimeReviews = []; d.weeklyOvertimeOverrides = []
  const line = teamWeeklyReport(d, week).lines.find(l => l.worker.id === 'w')
  expect(dates.map(date => teamReportDayOvertime(line, date))).toEqual([180, 0, 90, 0, 55, 0])
  expect(line.minutes).toBe(325)
  expect(JSON.stringify(d.payrollLines)).toBe(saved)
})
it.each(['ar', 'fr'])('%s screen and Print All Teams preserve separate landscape tables, summary and canonical totals', async language => {
  localStorage.setItem('workers_app_language', language)
  window.history.replaceState({}, '', `/?date=${week}`)
  const d = fixture(), before = JSON.stringify(d), canonical = weeklyPayoutLines(d, week).find(l => l.worker.id === 'w')
  mocks.load.mockResolvedValue(d)
  const { container } = render(<LanguageProvider><TeamWeeklyReport /></LanguageProvider>)
  await screen.findByText('DAILY WORKER')
  const row = screen.getByText('DAILY WORKER').closest('tr')
  const cells = [...row.querySelectorAll('.team-report-day')]
  expect(cells[0].textContent.trim()).toMatch(/3h$/)
  expect(cells[1].textContent).not.toMatch(/min|\dh/)
  expect(cells[2].textContent.trim()).toBe('O 1h30')
  expect(cells[3].textContent).not.toMatch(/min|\dh/)
  expect(cells[4].textContent.trim()).toMatch(/55 min$/)
  expect(cells[0].querySelector('bdi').dir).toBe('ltr')
  const report = teamWeeklyReport(d, week), line = report.lines.find(l => l.worker.id === 'w')
  expect(line.minutes).toBe(canonical.eveningOvertimeMinutes)
  expect(line.finalAmount).toBe(canonical.finalAmount)
  expect(line.minutes).toBe(325)
  expect(report.lines.find(l => l.worker.id === 'monthly')).toMatchObject({ basePay: 0, minutes: 300, finalAmount: 300 })
  expect(JSON.stringify(d)).toBe(before)
  const popup = { document: { open: vi.fn(), write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(popup)
  fireEvent.click(container.querySelector('.team-report-controls .btn-primary'))
  await waitFor(() => expect(popup.print).toHaveBeenCalledOnce())
  const html = popup.document.write.mock.calls[0][0], doc = new DOMParser().parseFromString(html, 'text/html')
  expect(doc.querySelectorAll('.team-report-team')).toHaveLength(2)
  expect(doc.querySelector('.team-report-summary')).not.toBeNull()
  expect(doc.body.textContent).toContain('O 1h30')
  expect(doc.documentElement.dir).toBe(language === 'ar' ? 'rtl' : 'ltr')
  expect(teamReportPrintCss).toContain('A4 landscape')
  expect(teamReportPrintCss).toContain('.team-report-team+.team-report-team,.team-report-summary{break-before:page')
  expect(teamReportPrintCss).not.toMatch(/rotate\(/)
})
