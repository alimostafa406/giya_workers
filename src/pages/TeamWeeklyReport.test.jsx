// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import TeamWeeklyReport from './TeamWeeklyReport'
import { manualReportMinutes, printTeamReport, teamReportPrintCss, teamWeeklyReport } from '../utils/teamWeeklyReport'
import { calculatePayrollLine, weeklyDates } from '../utils/payrollCalculations'
globalThis.React = React
const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../api/payrollOperationsApi', () => ({ getPayrollOperationsDataRequest: mocks.load }))
const week = '2026-10-19'
const worker = (id, team = 'Siraj', extra = {}) => ({ id, full_name: `Worker ${id}`, employee_code: id, team_id: team, team_name: team,
  is_active: true, payment_type: 'weekly', staff_classification: 'normal',
  payroll_compensation: { daily_rate: 100, daily_transport_allowance: 10, overtime_rate_per_hour: 20, currency_code: 'CDF' }, ...extra })
const row = (id, extra = {}) => ({ worker_id: id, attendance_date: week, status: 'present', attendance_day_fraction: 1,
  attendance_source: 'biometric', check_in: '08:00', check_out: '19:30', ...extra })
const manual = (minutes) => ({ manual_override: true, emergency_overtime_mode: 'manual_overtime_duration', emergency_overtime_minutes: minutes })
const data = (rows = [row('a')]) => ({ workers: [worker('a'), worker('b', 'Zarour')], attendance: rows, rules: {}, holidays: [], runs: [], payrollLines: [], payrollAdjustments: [] })
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/') })

it('biometric overtime alone is zero payable OT', () => {
  const line = teamWeeklyReport(data(), week).lines[0]
  expect(line.minutes).toBe(0); expect(line.overtimeAmount).toBe(0); expect(line.finalAmount).toBe(110)
})
it.each([[120, 2, 40], [180, 3, 60], [210, 3.5, 70], [1, 1 / 60, .33], [0, 0, 0]])('manual %s minutes replaces biometric 2.5h at the existing rate', (minutes, hours, amount) => {
  const line = teamWeeklyReport(data([row('a', manual(minutes))]), week).lines[0]
  expect(line.minutes / 60).toBe(hours); expect(line.overtimeAmount).toBe(amount); expect(line.finalAmount).toBe(110 + amount)
})
it('mode alone without canonical manual provenance does not claim manual overtime', () => {
  expect(manualReportMinutes({ emergency_overtime_mode: 'manual_overtime_duration', emergency_overtime_minutes: 120 })).toBe(0)
})
it('attendance/absence and base pay reuse canonical classifier including historical half days and holidays', () => {
  const oldWeek = '2026-09-21', d = data([row('a', { attendance_date: oldWeek, status: 'half_day', attendance_day_fraction: .5, check_out: null })])
  d.holidays = [{ holiday_date: oldWeek }]
  const report = teamWeeklyReport(d, oldWeek).lines[0]
  const canonical = calculatePayrollLine({ worker: d.workers[0], term: d.workers[0].payroll_compensation,
    attendanceByDate: new Map([[`a|${oldWeek}`, d.attendance[0]]]), dates: weeklyDates(oldWeek), rules: d.rules,
    holidayDates: new Set([oldWeek]), paymentType: 'weekly', futureDatesAreNeutral: true })
  expect(report.workDays).toBe(.5); expect(report.absentDays).toBe(canonical.absentDays)
  expect(report.basePay).toBe(canonical.finalAmount - canonical.overtimeAmount)
})
it('operational start date does not produce pre-employment absences', () => {
  const d = data(); d.workers = [worker('a', 'Siraj', { operational_start_date: '2026-10-23' })]
  expect(teamWeeklyReport(d, week).lines[0].absentDays).toBeLessThanOrEqual(2)
})
it('team and grand totals sum manual minutes, canonical base and payable by currency', () => {
  const d = data([row('a', manual(120)), row('b', manual(180))]); d.workers.push(worker('c'))
  d.attendance.push(row('c', manual(30)))
  const report = teamWeeklyReport(d, week), siraj = report.groups.find((g) => g.name === 'Siraj')
  expect(siraj.lines).toHaveLength(2); expect(siraj.totals.minutes).toBe(150)
  expect(siraj.totals.currencies.CDF).toEqual({ basePay: 220, overtimeAmount: 50, finalAmount: 270 })
  expect(report.totals.workers).toBe(3); expect(report.totals.workDays).toBe(3); expect(report.totals.minutes).toBe(330)
  expect(report.totals.currencies.CDF).toEqual({ basePay: 330, overtimeAmount: 110, finalAmount: 440 })
})
it('inactive, monthly and special staff are excluded and team foreman metadata adds nobody', () => {
  const d = data(); d.workers.push(worker('inactive', 'Siraj', { is_active: false }), worker('monthly', 'Siraj', { payment_type: 'monthly' }), worker('foreign', 'Siraj', { staff_classification: 'special_staff' }))
  d.workers[0].team = { name: 'Siraj', foreman_worker_id: 'foreign' }
  expect(teamWeeklyReport(d, week).lines.map((l) => l.worker.id)).toEqual(['a', 'b'])
})
it.each(['reviewed', 'finalized', 'paid'])('never reinterprets %s snapshots with unknown manual provenance', (status) => {
  const d = data(); d.runs = [{ id: 'run', payment_type: 'weekly', weekly_period_start: week, weekly_period_end: '2026-10-24', status }]
  d.payrollLines = [{ payroll_run_id: 'run', overtime_hours: 2, overtime_amount: 40 }]
  const before = JSON.stringify(d)
  expect(teamWeeklyReport(d, week).unavailable).toBeTruthy()
  expect(JSON.stringify(d)).toBe(before)
})
it('zero-OT immutable snapshot uses stored totals, not live wages/attendance', () => {
  const d = data(); d.runs = [{ id: 'run', payment_type: 'weekly', weekly_period_start: week, weekly_period_end: '2026-10-24', status: 'paid' }]
  d.payrollLines = [{ payroll_run_id: 'run', worker_id: 'a', worker_name_snapshot: 'Frozen worker', overtime_hours: 0, overtime_amount: 0, final_amount: 999, present_days: 4, half_days: 0, absent_days: 2, currency_code_snapshot: 'CDF' }]
  const before = JSON.stringify(d), report = teamWeeklyReport(d, week)
  expect(report.lines[0].finalAmount).toBe(999); expect(report.lines[0].workDays).toBe(4); expect(JSON.stringify(d)).toBe(before)
})
it('versioned finalized snapshot uses frozen manual evidence/rate and base, never current rows', () => {
  const d = data([row('a', manual(999))]); d.runs = [{ id: 'run', payment_type: 'weekly', weekly_period_start: week, weekly_period_end: '2026-10-24', status: 'finalized' }]
  d.payrollLines = [{ payroll_run_id: 'run', worker_id: 'a', worker_name_snapshot: 'Frozen', overtime_hours: 5.5, overtime_amount: 110,
    final_amount: 770, present_days: 6, half_days: 0, absent_days: 0, currency_code_snapshot: 'CDF', compensation_snapshot: { overtime_rate_per_hour: 20 },
    attendance_summary_snapshot: { manual_overtime_source_version: 1, days: [{ date: week, ...manual(180) }] } }]
  const before = JSON.stringify(d), line = teamWeeklyReport(d, week).lines[0]
  expect(line).toMatchObject({ minutes: 180, basePay: 660, overtimeAmount: 60, finalAmount: 720 })
  expect(JSON.stringify(d)).toBe(before)
  const api = readFileSync('src/api/payrollOperationsApi.js', 'utf8')
  expect(api).toContain('manual_overtime_source_version: 1')
  expect(api).toContain('emergency_overtime_minutes: detail.row?.emergency_overtime_minutes ?? null')
})
it('missing rate retains manual hours and leaves money and affected total unresolved', () => {
  const d = data([row('a', manual(120))]); d.workers[0].payroll_compensation.overtime_rate_per_hour = null
  const report = teamWeeklyReport(d, week)
  expect(report.lines[0].minutes).toBe(120); expect(report.lines[0].overtimeAmount).toBeNull(); expect(report.totals.currencies.CDF.finalAmount).toBeNull()
})
it('matches the production KAMANGO week: five days, one absent, base 87500, payable manual OT zero', () => {
  const d = data(); d.workers = [worker('a', 'Siraj', { payroll_compensation: { daily_rate: 17500, daily_transport_allowance: 0, overtime_rate_per_hour: 2000, currency_code: 'CDF' } })]
  d.attendance = weeklyDates(week).map((date, i) => row('a', { attendance_date: date, status: i === 1 ? 'absent' : 'present', check_in: i === 1 ? null : '07:56', check_out: i === 1 || i === 5 ? null : '19:30' }))
  expect(teamWeeklyReport(d, week).lines[0]).toMatchObject({ workDays: 5, absentDays: 1, basePay: 87500, overtimeAmount: 0, finalAmount: 87500 })
})
it('all eligible teams render together; one print includes every worker and the final standalone summary', async () => {
  window.history.replaceState({}, '', `/?date=${week}`)
  const fixture = data([row('a', manual(120)), row('b', manual(180))]); fixture.workers.push(worker('c'))
  fixture.workers.push(worker('inactive', 'Siraj', { is_active: false, full_name: 'INACTIVE' }))
  mocks.load.mockResolvedValue(fixture)
  const popup = { document: { write: vi.fn(), close: vi.fn(), fonts: { ready: Promise.resolve() } }, focus: vi.fn(), print: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(popup)
  render(<TeamWeeklyReport />)
  await screen.findByRole('heading', { name: 'الفريق: Siraj' })
  expect(screen.getByRole('heading', { name: 'الفريق: Zarour' })).toBeTruthy()
  expect(screen.queryByRole('combobox')).toBeNull()
  const teams = screen.getAllByRole('region', { name: /^تقرير الفريق:/ })
  expect(teams).toHaveLength(2)
  const summaryColumns = ['العامل', 'الكود', 'أيام العمل', 'أيام الغياب', 'ساعات الإضافي', 'أجر أيام العمل', 'مبلغ الإضافي', 'إجمالي القبض']
  for (const team of teams) {
    expect(within(team).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(summaryColumns)
    const table = within(team).getByRole('table')
    const totalRow = within(table).getByRole('row', { name: /^إجمالي الفرقة/ })
    expect(totalRow.parentElement.tagName).toBe('TFOOT')
    expect(totalRow.children).toHaveLength(8)
    expect(table.tFoot.rows).toHaveLength(1)
    expect(team.querySelector('.team-report-totals')).toBeNull()
    const expectedGroup = teamWeeklyReport(fixture, week).groups.find((g) => team.getAttribute('aria-label') === `تقرير الفريق: ${g.name}`)
    expect(table.tBodies[0].rows).toHaveLength(expectedGroup.lines.length)
    expect(totalRow.children[1].textContent).toBe(`${expectedGroup.lines.length} عمال`)
    expect(totalRow.children[2].textContent).toBe(String(expectedGroup.totals.workDays))
    expect(totalRow.children[3].textContent).toBe(String(expectedGroup.totals.absentDays))
    for (const forbidden of ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'إضافي صباحي', 'إضافي مسائي'])
      expect(within(team).queryByRole('columnheader', { name: forbidden, exact: true })).toBeNull()
  }
  expect(teams[0].textContent).toContain('Worker a'); expect(teams[0].textContent).toContain('Worker c')
  expect(teams[1].textContent).toContain('Worker b'); expect(teams[1].textContent).not.toContain('Worker a')
  fireEvent.click(screen.getByRole('button', { name: 'طباعة كل الفرق', exact: true }))
  let html = popup.document.write.mock.calls.at(-1)[0]
  expect(html).toContain('Worker a'); expect(html).toContain('Worker c'); expect(html).toContain('Worker b'); expect(html).toContain('إجمالي الفرقة')
  for (const worker of ['Worker a', 'Worker b', 'Worker c']) expect(html.split(worker)).toHaveLength(2)
  expect(html).toContain('class="team-report-content team-report-summary"')
  expect(html.lastIndexOf('ملخص أجور جميع الفرق')).toBeGreaterThan(html.lastIndexOf('Worker b'))
  expect(html).not.toContain('إضافي صباحي'); expect(html).not.toContain('إضافي مسائي')
  expect(html).not.toContain('INACTIVE')
  expect(html).toContain('الاثنين 19/10/2026'); expect(html).toContain('السبت 24/10/2026'); expect(html).not.toContain('<button')
  fireEvent.click(screen.getByRole('button', { name: 'طباعة ملخص كل الفرق' }))
  html = popup.document.write.mock.calls.at(-1)[0]
  expect(html).toContain('ملخص أجور جميع الفرق'); expect(html).toContain('الإجمالي العام'); expect(html).toContain('Siraj'); expect(html).toContain('Zarour'); expect(html).not.toContain('Worker a')
  await waitFor(() => expect(popup.print).toHaveBeenCalledTimes(2))
  expect(teamReportPrintCss).toContain('A4 landscape'); expect(teamReportPrintCss).toContain('table-header-group')
  expect(teamReportPrintCss).toContain('.team-report-team+.team-report-team,.team-report-summary{break-before:page;page-break-before:always}')
  expect(teamReportPrintCss).toContain('.team-report-header{break-inside:avoid')
  expect(teamReportPrintCss).toContain('tfoot{display:table-row-group;break-inside:avoid')
  const summary = screen.getByRole('region', { name: 'ملخص أجور جميع الفرق' })
  const summaryTable = within(summary).getByRole('table')
  expect(within(summaryTable).getAllByRole('columnheader').map((h) => h.textContent).slice(0, 7))
    .toEqual(['الفريق', 'عدد العمال', 'أيام العمل', 'ساعات الإضافي', 'مبلغ الإضافي', 'أجر أيام العمل', 'إجمالي القبض'])
  expect(within(summaryTable).getByRole('row', { name: /^الإجمالي العام/ }).parentElement.tagName).toBe('TFOOT')
})
it('print popup failure is reported and the admin route/navigation are wired', () => {
  vi.spyOn(window, 'open').mockReturnValue(null)
  expect(printTeamReport({ innerHTML: '<p>Report</p>' })).toBe(false)
  expect(readFileSync('src/routes/AppRouter.jsx', 'utf8')).toContain('<Route path="/payroll/team-weekly-report" element={<TeamWeeklyReport />} />')
  expect(readFileSync('src/pages/OvertimeEntry.jsx', 'utf8')).toContain('عرض وطباعة أجور الأسبوع')
})

const monthlyWorker = (id = 'm', extra = {}) => worker(id, 'Siraj', {
  payment_type: 'monthly', monthly_salary: 600,
  payroll_compensation: { monthly_salary: 600, monthly_payroll_cycle_start_date: '2026-10-07',
    daily_rate: 999, daily_transport_allowance: 999, overtime_rate_per_hour: 2.5, currency_code: 'CDF' }, ...extra,
})
it('monthly manual overtime appears with zero base and overtime-only total alongside normal weekly pay', () => {
  const d = data([row('a', manual(120)), row('m', manual(360))]); d.workers = [worker('a'), monthlyWorker()]
  const before = JSON.stringify(d), report = teamWeeklyReport(d, week)
  expect(report.lines.find((l) => l.worker.id === 'a')).toMatchObject({ basePay: 110, overtimeAmount: 40, finalAmount: 150 })
  expect(report.lines.find((l) => l.worker.id === 'm')).toMatchObject({ monthlyOvertimeOnly: true, minutes: 360, basePay: 0, overtimeAmount: 15, finalAmount: 15 })
  expect(report.groups[0].totals.currencies.CDF).toEqual({ basePay: 110, overtimeAmount: 55, finalAmount: 165 })
  expect(report.totals.currencies.CDF).toEqual({ basePay: 110, overtimeAmount: 55, finalAmount: 165 })
  expect(JSON.stringify(d)).toBe(before)
})
it('monthly zero manual overtime and biometric-only overtime are excluded; weekly base-only remains', () => {
  const d = data([row('a'), row('m', { check_out: '23:00' })]); d.workers = [worker('a'), monthlyWorker()]
  const report = teamWeeklyReport(d, week)
  expect(report.lines).toHaveLength(1)
  expect(report.lines[0]).toMatchObject({ basePay: 110, overtimeAmount: 0, finalAmount: 110 })
})
it('monthly override replaces daily sum, zero excludes, and clearing restores daily sum', () => {
  const d = data([row('m', manual(360))]); d.workers = [monthlyWorker()]
  d.weeklyOvertimeOverrides = [{ worker_id: 'm', minutes: 1500 }]
  expect(teamWeeklyReport(d, week).lines[0]).toMatchObject({ minutes: 1500, basePay: 0, overtimeAmount: 62.5, finalAmount: 62.5 })
  d.weeklyOvertimeOverrides[0].minutes = 0
  expect(teamWeeklyReport(d, week).lines).toHaveLength(0)
  d.weeklyOvertimeOverrides[0].minutes = null
  expect(teamWeeklyReport(d, week).lines[0]).toMatchObject({ minutes: 360, basePay: 0, finalAmount: 15 })
})
it('monthly salary, daily wage, transport, holiday multipliers and adjustments cannot leak into weekly payout', () => {
  const d = data([row('m', manual(360))]); d.workers = [monthlyWorker()]
  d.holidays = [{ holiday_date: week }]; d.rules = { weekly_holiday_multiplier: 2 }
  d.payrollAdjustments = [{ payroll_line_id: 'monthly-line', adjustment_type: 'bonus', amount: 10000 }]
  const first = teamWeeklyReport(d, week).lines[0]
  d.workers[0].monthly_salary = 900000; d.workers[0].payroll_compensation.monthly_salary = 900000
  expect(teamWeeklyReport(d, week).lines[0]).toMatchObject({ basePay: 0, overtimeAmount: first.overtimeAmount, finalAmount: first.finalAmount })
})
it('all-team summary includes monthly OT money only and keeps currencies separate', () => {
  const d = data([row('a', manual(120)), row('m', manual(360))]); d.workers = [worker('a'), monthlyWorker('m', { team_id: 'Zarour', team_name: 'Zarour' })]
  const report = teamWeeklyReport(d, week)
  expect(report.groups.find((g) => g.name === 'Zarour').totals.currencies.CDF).toEqual({ basePay: 0, overtimeAmount: 15, finalAmount: 15 })
  expect(report.totals.currencies.CDF.finalAmount).toBe(165)
})
it('inactive, future-start and special-staff monthly workers remain excluded', () => {
  const d = data(); d.workers = [monthlyWorker('inactive', { is_active: false }), monthlyWorker('future', { operational_start_date: '2026-11-01' }), monthlyWorker('foreign', { staff_classification: 'special_staff' })]
  d.attendance = d.workers.map((w) => row(w.id, manual(360)))
  expect(teamWeeklyReport(d, week).lines).toHaveLength(0)
})
it('monthly payroll cycle, deductions and finalized salary snapshots remain untouched', () => {
  const d = data([row('m', manual(360))]); d.workers = [monthlyWorker()]
  d.runs = [{ id: 'monthly-run', payment_type: 'monthly', status: 'paid' }]
  d.payrollLines = [{ id: 'monthly-line', payroll_run_id: 'monthly-run', worker_id: 'm', payment_type_snapshot: 'monthly',
    final_amount: 550, base_amount: 600, absent_days: 2, calculation_snapshot: { absence_deduction: 50 } }]
  const before = JSON.stringify(d), report = teamWeeklyReport(d, week)
  expect(report.lines[0].finalAmount).toBe(15); expect(JSON.stringify(d)).toBe(before)
})
it('monthly OT supplement does not recalculate a locked weekly salary snapshot', () => {
  const d = data([row('m', manual(360))]); d.workers = [worker('a'), monthlyWorker()]
  d.runs = [{ id: 'weekly-run', payment_type: 'weekly', status: 'paid', weekly_period_start: week, weekly_period_end: '2026-10-24' }]
  d.payrollLines = [{ payroll_run_id: 'weekly-run', worker_id: 'a', worker_name_snapshot: 'Frozen A', overtime_hours: 0, overtime_amount: 0,
    final_amount: 999, present_days: 6, half_days: 0, absent_days: 0, currency_code_snapshot: 'CDF' }]
  const before = JSON.stringify(d), report = teamWeeklyReport(d, week)
  expect(report.lines[0].finalAmount).toBe(999); expect(report.lines[1].finalAmount).toBe(15)
  expect(report.totals.currencies.CDF.finalAmount).toBe(1014)
  expect(report.hasLiveMonthlyOvertime).toBe(true); expect(JSON.stringify(d)).toBe(before)
})
it('monthly OT-only label and zero base are present on screen and in all-teams print', async () => {
  window.history.replaceState({}, '', `/?date=${week}`)
  const d = data([row('m', manual(360))]); d.workers = [monthlyWorker()]
  mocks.load.mockResolvedValue(d)
  const popup = { document: { write: vi.fn(), close: vi.fn(), fonts: { ready: Promise.resolve() } }, focus: vi.fn(), print: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(popup)
  render(<TeamWeeklyReport />)
  await screen.findByText('شهري — إضافي فقط')
  fireEvent.click(screen.getByRole('button', { name: 'طباعة كل الفرق', exact: true }))
  const html = popup.document.write.mock.calls[0][0]
  expect(html).toContain('شهري — إضافي فقط'); expect(html).toContain('0.00'); expect(html).toContain('15.00'); expect(html).not.toContain('600.00')
})
it('comprehensive grand totals never add CDF and USD payouts together', () => {
  const d = data([row('a', manual(120)), row('b', manual(60))])
  d.workers[1].payroll_compensation = { ...d.workers[1].payroll_compensation, currency_code: 'USD', overtime_rate_per_hour: 10 }
  const report = teamWeeklyReport(d, week)
  expect(report.totals.currencies).toEqual({ CDF: { basePay: 110, overtimeAmount: 40, finalAmount: 150 }, USD: { basePay: 110, overtimeAmount: 10, finalAmount: 120 } })
  for (const currency of ['CDF', 'USD']) expect(report.totals.currencies[currency].finalAmount)
    .toBe(report.groups.reduce((sum, g) => sum + (g.totals.currencies[currency]?.finalAmount || 0), 0))
})
