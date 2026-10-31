// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { weeklyPayoutLines, assertWeeklyPayoutSnapshotComplete, assertWeeklyPayoutDraftReady } from './weeklyPayoutLines'
import { payrollDraftEligibleLines } from './weeklyPayrollEligibility'
import { teamWeeklyReport } from './teamWeeklyReport'
import { payrollDraftLinePayload } from '../api/payrollOperationsApi'
import { calculatePayrollLine, weeklyDates } from './payrollCalculations'
import TeamWeeklyReport from '../pages/TeamWeeklyReport'
import { LanguageProvider } from '../i18n/LanguageContext'
import WeeklyPayrollSheet from '../components/Payroll/WeeklyPayrollSheet'
globalThis.React = React
const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../api/payrollOperationsApi', async (original) => ({ ...await original(), getPayrollOperationsDataRequest: mocks.load }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: vi.fn() }))
const week = '2026-10-19', end = '2026-10-24'
function data(transport = 5000, minutes = 300, rate = 2500) {
  return { workers: [{ id: 'm', full_name: 'Monthly worker', employee_code: '38', team_id: 'Siraj', team_name: 'Siraj',
    is_active: true, staff_classification: 'normal', payment_type: 'monthly', monthly_salary: 900000,
    payroll_compensation: { currency_code: 'CDF', daily_rate: 99999, monthly_salary: 900000, daily_transport_allowance: transport, overtime_rate_per_hour: rate } }],
    attendance: weeklyDates(week).map(date => ({ worker_id: 'm', attendance_date: date, status: 'present', attendance_day_fraction: 1 })),
    weeklyOvertimeOverrides: [{ worker_id: 'm', week_start: week, minutes }], rules: {}, holidays: [], runs: [], payrollLines: [] }
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); window.history.replaceState({}, '', '/') })
it.each([[5000, 0, 30000], [0, 300, 12500], [5000, 300, 42500]])('monthly transport %s + OT %s produces weekly net %s without salary', (transport, minutes, total) => {
  const d = data(transport, minutes), before = JSON.stringify(d), lines = weeklyPayoutLines(d, week), line = lines[0]
  expect(lines).toHaveLength(1)
  expect(payrollDraftEligibleLines('weekly', lines, end)).toEqual(lines)
  expect(line).toMatchObject({ baseAmount: 0, attendanceWage: 0, monthlySalary: 0, holidayAmount: 0, transportAmount: 6 * transport, eveningOvertimeMinutes: minutes, finalAmount: total })
  const report = teamWeeklyReport(d, week)
  expect(report.lines[0]).toMatchObject({ basePay: 0, transportAmount: 6 * transport, minutes, finalAmount: total })
  expect(report.groups[0].totals.currencies.CDF.finalAmount).toBe(total)
  expect(report.totals.currencies.CDF).toEqual({ basePay: 0, transportAmount: 6 * transport, overtimeAmount: minutes / 60 * 2500, finalAmount: total })
  expect(JSON.stringify(d)).toBe(before)
})
it('monthly zero transport and OT is excluded', () => {
  expect(weeklyPayoutLines(data(0, 0), week)).toEqual([])
  expect(teamWeeklyReport(data(0, 0), week).lines).toEqual([])
})
it('canonical transport eligibility is reused for half-day/late/outside-work and inactive recorded workers', () => {
  const d = data(10, 0); d.workers[0].is_active = false
  d.attendance[0] = { ...d.attendance[0], status: 'half_day', manual_override: true, attendance_day_fraction: .5 }; d.attendance[1].status = 'absent'
  d.attendance[2] = { ...d.attendance[2], attendance_source: 'outside_work' }
  d.rules.transport_eligibility = 'present_and_half_day'
  const canonical = calculatePayrollLine({ worker: d.workers[0], term: d.workers[0].payroll_compensation,
    attendanceByDate: new Map(d.attendance.map(row => [`m|${row.attendance_date}`, row])), dates: weeklyDates(week), rules: d.rules, holidayDates: new Set(), paymentType: 'weekly' })
  expect(weeklyPayoutLines(d, week)[0].transportAmount).toBe(canonical.transportAmount)
  expect(canonical.transportAmount).toBe(50)
})
it('missing OT rate retains transport and hours, but does not invent overtime pay or complete net', () => {
  const d = data(5000, 300, null), line = teamWeeklyReport(d, week).lines[0]
  expect(line).toMatchObject({ basePay: 0, transportAmount: 30000, minutes: 300, overtimeAmount: null, finalAmount: null, unresolved: true })
  expect(() => assertWeeklyPayoutDraftReady([], weeklyPayoutLines(d, week))).toThrow()
})
it.each(['reviewed', 'finalized', 'paid'])('frozen %s monthly transport/OT/rate/net never follows later live changes', status => {
  const d = data(), lines = weeklyPayoutLines(d, week), payload = lines.map(line => payrollDraftLinePayload('run', line, week, end, end))
  expect(() => assertWeeklyPayoutDraftReady(payload, lines)).not.toThrow()
  expect(() => assertWeeklyPayoutSnapshotComplete(payload)).not.toThrow()
  d.runs = [{ id: 'run', payment_type: 'weekly', weekly_period_start: week, weekly_period_end: end, status }]; d.payrollLines = payload
  const frozen = JSON.stringify(payload)
  d.attendance = []; d.weeklyOvertimeOverrides = []; d.workers[0].is_active = false
  d.workers[0].payroll_compensation.daily_transport_allowance = 999999
  d.workers[0].payroll_compensation.overtime_rate_per_hour = 999999
  expect(teamWeeklyReport(d, week).lines[0]).toMatchObject({ basePay: 0, transportAmount: 30000, minutes: 300, overtimeAmount: 12500, finalAmount: 42500 })
  expect(payload[0].compensation_snapshot.overtime_rate_per_hour).toBe(2500)
  expect(JSON.stringify(payload)).toBe(frozen)
})
it('transport-only snapshot stays visible with zero overtime and changed live roster', () => {
  const d = data(5000, 0), line = weeklyPayoutLines(d, week)[0]
  d.payrollLines = [payrollDraftLinePayload('run', line, week, end, end)]
  d.runs = [{ id: 'run', payment_type: 'weekly', weekly_period_start: week, weekly_period_end: end, status: 'paid' }]
  d.workers = []; d.attendance = []
  expect(teamWeeklyReport(d, week).lines[0]).toMatchObject({ minutes: 0, basePay: 0, transportAmount: 30000, finalAmount: 30000 })
})
it('monthly salary calculation and inputs are unchanged by weekly calculation', () => {
  const d = data(), args = { worker: d.workers[0], term: d.workers[0].payroll_compensation, dates: weeklyDates(week), rules: {}, holidayDates: new Set(), attendanceByDate: new Map(d.attendance.map(row => [`m|${row.attendance_date}`, row])), paymentType: 'monthly' }
  const before = calculatePayrollLine(args)
  weeklyPayoutLines(d, week); teamWeeklyReport(d, week)
  expect(calculatePayrollLine(args)).toEqual(before)
  expect(before.baseAmount).toBe(900000)
})
it('review rejects changed transport and finalization rejects inconsistent monthly transport snapshots', () => {
  const d = data(), lines = weeklyPayoutLines(d, week), payload = lines.map(line => payrollDraftLinePayload('run', line, week, end, end))
  d.workers[0].payroll_compensation.daily_transport_allowance = 6000
  expect(() => assertWeeklyPayoutDraftReady(payload, weeklyPayoutLines(d, week))).toThrow('payout changed')
  const invalid = structuredClone(payload)
  invalid[0].transport_amount = 1; invalid[0].final_amount = 12501
  expect(() => assertWeeklyPayoutSnapshotComplete(invalid)).toThrow('incomplete')
})
it('monthly transport is visible in main payroll and all-teams print, with zero wages and correct total', async () => {
  const d = data(); window.history.replaceState({}, '', `/?date=${week}`); mocks.load.mockResolvedValue(d)
  const popup = { document: { write: vi.fn(), close: vi.fn(), fonts: { ready: Promise.resolve() } }, focus: vi.fn(), print: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(popup)
  const sheet = render(<LanguageProvider><WeeklyPayrollSheet lines={weeklyPayoutLines(d, week)} dates={weeklyDates(week)} onEdit={() => {}} /></LanguageProvider>)
  expect(sheet.container.querySelector('[data-total="transport"]').textContent).toContain('30,000')
  expect(sheet.container.querySelector('[data-total="payable"]').textContent).toContain('42,500')
  cleanup(); render(<LanguageProvider><TeamWeeklyReport /></LanguageProvider>)
  await screen.findByText('Monthly worker')
  expect(screen.getByText('شهري — بدل نقل وإضافي')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'طباعة كل الفرق', exact: true }))
  const printed = new DOMParser().parseFromString(popup.document.write.mock.calls[0][0], 'text/html')
  const row = printed.querySelector('.team-report-team tbody tr')
  expect(row.children[11].textContent).toContain('0.00')
  expect(row.children[12].textContent).toContain('12,500')
  expect(row.children[13].textContent).toContain('30,000')
  expect(row.children[14].textContent).toContain('42,500')
  expect(printed.body.textContent).not.toContain('900,000')
})
it.skipIf(!process.env.MONTHLY_PAYOUT_AUDIT_INPUT)('all production monthly workers with weekly transport or OT reach the canonical report', async () => {
  const d = JSON.parse(readFileSync(process.env.MONTHLY_PAYOUT_AUDIT_INPUT, 'utf8')), before = JSON.stringify(d)
  const lines = weeklyPayoutLines(d, '2026-10-26'), report = teamWeeklyReport(d, '2026-10-26')
  expect(lines.length).toBeGreaterThan(0)
  expect(report.lines.map(line => line.worker.id).sort()).toEqual(lines.map(line => line.worker.id).sort())
  for (const line of lines) {
    const shown = report.lines.find(row => row.worker.id === line.worker.id)
    expect(line.transportAmount > 0 || line.eveningOvertimeMinutes > 0).toBe(true)
    expect(shown.basePay).toBe(0)
    expect(shown.transportAmount).toBe(line.transportAmount)
    if (!line.missingRateBlocker) expect(shown.finalAmount).toBe(Math.round((line.transportAmount + line.overtimeAmount) * 100) / 100)
    else expect(shown.overtimeAmount).toBeNull()
  }
  window.history.replaceState({}, '', '/?date=2026-10-26'); mocks.load.mockResolvedValue(d)
  const popup = { document: { write: vi.fn(), close: vi.fn(), fonts: { ready: Promise.resolve() } }, focus: vi.fn(), print: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(popup)
  render(<LanguageProvider><TeamWeeklyReport /></LanguageProvider>)
  await screen.findAllByText('شهري — بدل نقل وإضافي')
  expect([...document.querySelectorAll('.team-report-team')].reduce((count, team) => count + team.querySelector('table').tBodies[0].rows.length, 0)).toBe(lines.length)
  fireEvent.click(screen.getByRole('button', { name: 'طباعة كل الفرق', exact: true }))
  const printed = new DOMParser().parseFromString(popup.document.write.mock.calls[0][0], 'text/html')
  expect([...printed.querySelectorAll('.team-report-team')].reduce((count, team) => count + team.querySelector('table').tBodies[0].rows.length, 0)).toBe(lines.length)
  for (const line of lines) expect(printed.body.textContent).toContain(line.worker.full_name)
  console.log('PRODUCTION MONTHLY WEEKLY AUDIT', JSON.stringify({ included: lines.length, transportWorkers: lines.filter(line => line.transportAmount > 0).length, overtimeWorkers: lines.filter(line => line.eveningOvertimeMinutes > 0).length, missingOTRates: lines.filter(line => line.missingRateBlocker).length }))
  expect(JSON.stringify(d)).toBe(before)
})
