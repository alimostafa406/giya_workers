import { expect, it, vi } from 'vitest'
vi.mock('../lib/supabase', () => ({ getSupabaseClient: vi.fn() }))
import { outsideWorkTeamMarkers } from './outsideWorkTeamMarkers'
import { teamWeeklyReport } from './teamWeeklyReport'
import { weeklyPayoutLines } from './weeklyPayoutLines'

const monday = '2026-10-12', tuesday = '2026-10-13'
const worker = { id: 'w', full_name: 'Visitor', employee_code: '23', team_id: 'siraj', team_name: 'Siraj', is_active: true,
  payment_type: 'weekly', staff_classification: 'normal', payroll_compensation: {
    daily_rate: 100, daily_transport_allowance: 0, overtime_rate_per_hour: 60, currency_code: 'CDF' } }
const movement = { id: 'm', team_id: 'mostafa', team: { name: 'Mostafa' }, foreman_worker_id: 'f',
  work_date: monday, status: 'final', outside_work_movement_workers: [{ worker_id: 'w', start_time: '08:00', end_time: '18:00' }] }
const fixture = () => ({ workers: [{ ...worker }], outsideWorkMovements: [structuredClone(movement)],
  attendance: [monday, tuesday].map((date) => ({ worker_id: 'w', attendance_date: date, status: 'present',
    attendance_day_fraction: 1, attendance_source: date === monday ? 'outside_work' : 'biometric' })),
  runs: [], payrollLines: [], rules: {}, holidays: [] })

it.each([true, false])('historical visitor is informational, permanent payroll unchanged (active=%s)', (active) => {
  const d = fixture(); d.workers[0].is_active = active
  const original = JSON.stringify(d), payout = weeklyPayoutLines(d, monday)
  const withoutDestination = teamWeeklyReport({ ...d, outsideWorkMovements: d.outsideWorkMovements.map((m) => ({ ...m, team_id: null })) }, monday)
  const report = teamWeeklyReport(d, monday)
  const origin = report.groups.find((g) => g.id === 'siraj'), destination = report.groups.find((g) => g.id === 'mostafa')
  expect(origin.lines).toHaveLength(1)
  expect(origin.lines[0]).toMatchObject({ workDays: 2, minutes: 60, basePay: 200, overtimeAmount: 60, finalAmount: 260 })
  expect(destination.outsideWorkMarkers).toEqual([{ worker: d.workers[0], dates: [monday] }])
  expect(destination.lines).toEqual([])
  expect(destination.totals).toEqual({ workers: 0, workDays: 0, absentDays: 0, minutes: 0, currencies: {} })
  expect(report.totals).toEqual(withoutDestination.totals)
  expect(report.lines).toEqual(withoutDestination.lines)
  expect(weeklyPayoutLines(d, monday)).toEqual(payout)
  expect(JSON.stringify(d)).toBe(original)
})
it('weekly override and daily manual OT stay entirely in permanent team', () => {
  const d = fixture()
  Object.assign(d.attendance[0], { manual_override: true, emergency_overtime_mode: 'manual_overtime_duration', emergency_overtime_minutes: 120 })
  expect(teamWeeklyReport(d, monday).groups.find((g) => g.id === 'siraj').totals.minutes).toBe(120)
  d.weeklyOvertimeOverrides = [{ worker_id: 'w', week_start: monday, minutes: 300 }]
  const report = teamWeeklyReport(d, monday)
  expect(report.groups.find((g) => g.id === 'siraj').totals.minutes).toBe(300)
  expect(report.groups.find((g) => g.id === 'mostafa').totals.minutes).toBe(0)
  expect(report.totals.workers).toBe(1)
})
it('deduplicates FINAL worker/date markers and ignores drafts, own-team, no-team and other weeks', () => {
  const movements = [movement, movement, { ...movement, status: 'draft', work_date: tuesday },
    { ...movement, team_id: 'siraj' }, { ...movement, team_id: null }, { ...movement, work_date: '2026-10-19' }]
  expect(outsideWorkTeamMarkers([worker], movements, [monday, tuesday])).toEqual([
    { id: 'mostafa', name: 'Mostafa', workers: [{ worker, dates: [monday] }] }])
  expect(outsideWorkTeamMarkers([worker], movements, [tuesday])).toEqual([])
})
it('approved biometric OT also remains exclusively with the permanent team', () => {
  const d = fixture()
  Object.assign(d.attendance[0], { id: 'a', attendance_source: 'biometric', check_in: '08:00:00', check_out: '18:05:00' })
  d.biometricOvertimeReviews = [{ worker: d.workers[0], attendance: d.attendance[0], source_fingerprint: 'same',
    review: { decision: 'approved', minutes: 65, source_fingerprint: 'same', version: 1 } }]
  const report = teamWeeklyReport(d, monday)
  expect(report.groups.find((g) => g.id === 'siraj').totals.minutes).toBe(65)
  expect(report.groups.find((g) => g.id === 'mostafa').totals.minutes).toBe(0)
})
