import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { buildWeeklyPayrollAllTeamsHtml, printAllWeeklyPayrollTeams } from './weeklyPayrollPrintAll.js'
import { translations } from '../i18n/translations.js'

const line = (id, name, amount, status = 'present') => ({
  worker: { id, full_name: name, employee_code: id }, currency: 'CDF',
  term: { daily_rate: 100, overtime_rate_per_hour: 3000, daily_transport_allowance: 0 },
  attendanceWage: amount - 3000, overtimeHours: 1, overtimeAmount: 3000,
  transportAmount: 0, finalAmount: amount,
  details: [{ date: '2026-09-24', status, row: { check_out: '18:00:00' } }],
})
const groups = [
  { id: 'a', name: 'Zarour', amountDueByCurrency: { CDF: 21000 }, lines: [line('1', 'MERVEILLE', 10000), line('2', 'ROBERT', 11000)] },
  { id: 'b', name: 'Peinture Raghibe', amountDueByCurrency: { CDF: 12000 }, lines: [line('3', 'MATAMATA', 12000)] },
]
const labels = {
  period: 'Payroll week', teams: 'Teams', workers: 'Workers', overallTotal: 'Overall total', teamTotal: 'Team total',
  worker: 'Worker', workDayPay: 'Workday wages', overtimeHours: 'Overtime hours', overtimeAmount: 'Overtime amount', transport: 'Transport', total: 'Total',
  status: { present: 'Present', half_day: 'Half day', absent: 'Absent', neutral: '—' },
}
const options = { title: 'Weekly Payroll', periodStart: '2026-09-21', periodEnd: '2026-09-26', groups, overallTotalsByCurrency: { CDF: 33000 }, dates: ['2026-09-24'], labels, language: 'en', direction: 'ltr' }

describe('main weekly payroll print all teams', () => {
  it('has a localized button while keeping existing single-team printing', () => {
    const source = readFileSync('src/components/Payroll/PayrollOperations.jsx', 'utf8')
    expect(source).toMatch(/onClick=\{printEveryTeam\}>\{t\('payroll\.printAllTeams'\)\}/)
    expect(source).toMatch(/exportButtons\(exportTeam\)/)
    expect(translations.ar.payroll.printAllTeams).toBe('طباعة كل الفرق')
    expect(translations.en.payroll.printAllTeams).toBe('Print All Teams')
    expect(translations.fr.payroll.printAllTeams).toBe('Imprimer toutes les équipes')
  })

  it('prints every worker under the right team, canonical totals and the summary', () => {
    const before = structuredClone(groups)
    const html = buildWeeklyPayrollAllTeamsHtml(options)
    expect(html).toMatch(/2026-09-21 → 2026-09-26/)
    expect(html).toMatch(/<dt>Teams<\/dt><dd>2<\/dd>/)
    expect(html).toMatch(/<dt>Workers<\/dt><dd>3<\/dd>/)
    expect(html).toMatch(/33,000/)
    const zarour = html.indexOf('<h2>Zarour</h2>')
    const peinture = html.indexOf('<h2>Peinture Raghibe</h2>')
    expect(zarour).toBeGreaterThan(-1)
    expect(peinture).toBeGreaterThan(zarour)
    for (const worker of ['MERVEILLE', 'ROBERT']) expect(html.indexOf(worker)).toBeGreaterThan(zarour)
    expect(html.indexOf('ROBERT')).toBeLessThan(peinture)
    expect(html.indexOf('MATAMATA')).toBeGreaterThan(peinture)
    expect(html).toMatch(/21,000/)
    expect(html).toMatch(/12,000/)
    expect(html).toMatch(/<th>Transport<\/th><th>Total<\/th>/)
    expect(html).toMatch(/<td class="final">[^<]*10,000/)
    expect(html).toMatch(/1h00/)
    expect(html).not.toMatch(/Morning Overtime|morningOvertime/)
    expect(groups).toEqual(before)
  })

  it('separates teams on A4 landscape pages while allowing long tables to continue', () => {
    const html = buildWeeklyPayrollAllTeamsHtml(options)
    expect(html).toMatch(/@page\{size:A4 landscape/)
    expect(html).toMatch(/\.team\+\.team\{break-before:page;page-break-before:always/)
    expect(html).toMatch(/thead\{display:table-header-group\}/)
    expect(html).toMatch(/tr\{break-inside:avoid;page-break-inside:avoid\}/)
    expect(html).toMatch(/\.team-header\{[^}]*break-after:avoid/)
    expect((html.match(/<section class="team">/g) || []).length).toBe(2)
  })

  it('opens one print document without mutating payroll lines or invoking a workflow action', () => {
    const document = { write: vi.fn(), close: vi.fn() }
    const printWindow = { document, focus: vi.fn(), print: vi.fn() }
    const originalWindow = globalThis.window
    globalThis.window = { open: vi.fn(() => printWindow) }
    try {
      expect(printAllWeeklyPayrollTeams(options)).toBe(true)
      expect(globalThis.window.open).toHaveBeenCalledOnce()
      expect(document.write).toHaveBeenCalledOnce()
      expect(printWindow.print).toHaveBeenCalledOnce()
    } finally {
      globalThis.window = originalWindow
    }
  })
})
