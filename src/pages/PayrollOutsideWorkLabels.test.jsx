// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import TeamWeeklyReport from './TeamWeeklyReport'
import WeeklyPayrollSheet from '../components/Payroll/WeeklyPayrollSheet'
import { LanguageProvider } from '../i18n/LanguageContext'
import { teamWeeklyReport, printTeamReport } from '../utils/teamWeeklyReport'
import { weeklyPayoutLines } from '../utils/weeklyPayoutLines'
import { printRenderedPayrollTables } from '../utils/printRenderedPayroll'
import { buildWeeklyPayrollAllTeamsHtml } from '../utils/weeklyPayrollPrintAll'
globalThis.React = React
const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../api/payrollOperationsApi', () => ({ getPayrollOperationsDataRequest: mocks.load }))
const dates = ['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31']
function fixture() {
  const workers = ['REAGEN shingo','MATHIEU'].map((full_name, index) => ({ id: `w${index}`, full_name, employee_code: String(index),
    team_id: 'home', team_name: 'Wamba', is_active: true, staff_classification: 'normal', payment_type: 'weekly',
    payroll_compensation: { daily_rate: 100, daily_transport_allowance: 0, overtime_rate_per_hour: 60, currency_code: 'CDF' } }))
  const attendance = workers.flatMap(worker => dates.map(attendance_date => ({ worker_id: worker.id, attendance_date,
    status: 'present', attendance_day_fraction: 1, attendance_source: 'outside_work', manual_override: false })))
  return { workers, attendance, rules: {}, holidays: [], runs: [], payrollLines: [], teams: [{ id: 'destination', name: 'Montage mostafa' }],
    outsideWorkMovements: dates.map((work_date, i) => ({ id: `m${i}`, status: 'final', work_date, team_id: 'destination',
      outside_work_movement_workers: workers.map(worker => ({ worker_id: worker.id, start_time: '08:00', end_time: i === 2 ? '19:50' : i === 3 ? '18:00' : i === 5 ? '14:00' : '17:00' })) })) }
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); window.history.replaceState({}, '', '/') })
const noOutsideO = root => {
  for (const td of root.querySelectorAll('tbody td')) expect(td.textContent.trim()).not.toMatch(/^O(?:\s|$)/)
}
async function verify(d) {
  const before = JSON.stringify(d), reportBefore = teamWeeklyReport(d, dates[0]), totalsBefore = structuredClone(reportBefore.totals)
  window.history.replaceState({}, '', `/?date=${dates[0]}`); mocks.load.mockResolvedValue(d)
  const popup = { document: { write: vi.fn(), close: vi.fn(), fonts: { ready: Promise.resolve() } }, focus: vi.fn(), print: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(popup)
  const view = render(<LanguageProvider><TeamWeeklyReport /></LanguageProvider>)
  await screen.findAllByText('REAGEN shingo')
  noOutsideO(view.container)
  const screenRow = [...view.container.querySelectorAll('.team-report-team tbody tr')].find(row => row.firstElementChild.textContent.includes('REAGEN shingo') && row.querySelector('.team-report-day'))
  const screenCells = [...screenRow.querySelectorAll('.team-report-day')].map(td => td.textContent.trim())
  fireEvent.click(screen.getByRole('button', { name: 'طباعة كل الفرق', exact: true }))
  const all = new DOMParser().parseFromString(popup.document.write.mock.calls.at(-1)[0], 'text/html')
  noOutsideO(all)
  const printRow = [...all.querySelectorAll('.team-report-team tbody tr')].find(row => row.firstElementChild.textContent.includes('REAGEN shingo') && row.querySelector('.team-report-day'))
  expect([...printRow.querySelectorAll('.team-report-day')].map(td => td.textContent.trim())).toEqual(screenCells)
  const team = screenRow.closest('.team-report-team')
  printTeamReport(team, { language: 'ar' })
  noOutsideO(new DOMParser().parseFromString(popup.document.write.mock.calls.at(-1)[0], 'text/html'))
  cleanup()
  const lines = weeklyPayoutLines(d, dates[0])
  const sheet = render(<LanguageProvider><WeeklyPayrollSheet lines={lines} dates={dates} onEdit={() => {}} /></LanguageProvider>)
  noOutsideO(sheet.container)
  // Main payroll's actual current-team and all-team exports both clone these
  // rendered cells, not a different attendance classifier.
  const options = { title: 'Payroll', language: 'ar', direction: 'rtl' }
  for (const sections of [[{ name: 'Current team', element: sheet.container }], [{ name: 'All teams', element: sheet.container }]]) {
    printRenderedPayrollTables(sections, options)
    noOutsideO(new DOMParser().parseFromString(popup.document.write.mock.calls.at(-1)[0], 'text/html'))
  }
  const legacy = buildWeeklyPayrollAllTeamsHtml({ ...options, periodStart: dates[0], periodEnd: dates.at(-1), dates,
    groups: [{ name: 'Wamba', lines, amountDueByCurrency: {} }], overallTotalsByCurrency: {},
    labels: { status: { present: 'حاضر', absent: 'غائب', half_day: '½', neutral: '—' } } })
  noOutsideO(new DOMParser().parseFromString(legacy, 'text/html'))
  expect(teamWeeklyReport(d, dates[0]).totals).toEqual(totalsBefore)
  expect(JSON.stringify(d)).toBe(before)
  return screenCells
}
it('all payroll render/print paths show present and preserve 2h50/1h; informational destination rows add no money', async () => {
  const d = fixture(), totals = teamWeeklyReport(d, dates[0]).totals
  expect(await verify(d)).toEqual(['حاضر','حاضر','حاضر 2h50','حاضر 1h','حاضر','حاضر'])
  expect(totals.workers).toBe(2)
  expect(totals.minutes).toBe(460)
  expect(totals.currencies.CDF.finalAmount).toBe(1660)
})
it.skipIf(!process.env.OUTSIDE_PAYROLL_LABEL_AUDIT_INPUT)('real REAGEN shingo and MATHIEU production data has no O in payroll or print', async () => {
  const d = JSON.parse(readFileSync(process.env.OUTSIDE_PAYROLL_LABEL_AUDIT_INPUT, 'utf8'))
  console.log('REAL REAGEN PAYROLL DAY CELLS', JSON.stringify(await verify(d)))
})
