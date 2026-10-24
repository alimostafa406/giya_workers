import { describe, expect, it } from 'vitest'
import { applyManualWeeklyOvertime } from './weeklyManualOvertime.js'
import { outsideWorkOvertimeDays } from './outsideWorkPayableOvertime.js'
import { teamWeeklyReport } from './teamWeeklyReport.js'
import { staleWeeklyPayrollWorkerIds } from './weeklyPayrollDraftFreshness.js'

const dates = ['2026-10-19', '2026-10-20', '2026-10-23', '2026-10-24']
const worker = { id: 'w', full_name: 'Worker', team_id: 't', team_name: 'Team', is_active: true, staff_classification: 'normal', payment_type: 'weekly', payroll_compensation: { daily_rate: 100, daily_transport_allowance: 0, currency_code: 'CDF', overtime_rate_per_hour: 10 } }
const movement = (date = dates[0], end = '20:00', extra = {}) => ({ id: date, status: 'final', work_date: date, foreman_worker_id: 'special', start_time: '08:00', end_time: '23:00', outside_work_movement_workers: [{ worker_id: 'w', start_time: '08:00', end_time: end }], ...extra })
const line = (rows = {}) => ({ worker, term: worker.payroll_compensation, finalAmount: 125, overtimeAmount: 25, details: dates.map((date) => ({ date, row: rows[date] || { check_out: '23:00' } })) })
const manual = (minutes) => ({ manual_override: true, emergency_overtime_mode: 'manual_overtime_duration', emergency_overtime_minutes: minutes })

describe('canonical payable outside-work overtime', () => {
  it('FINAL counts, drafts and biometric overtime do not; worker time differs from foreman', () => {
    const m = [movement(), movement(dates[1], '23:00', { status: 'draft' })]
    const before = JSON.stringify(m)
    expect(applyManualWeeklyOvertime(line(), null, m)).toMatchObject({ overtimeHours: 3, overtimeAmount: 30, finalAmount: 130 })
    expect(applyManualWeeklyOvertime(line()).overtimeHours).toBe(0)
    expect(JSON.stringify(m)).toBe(before)
  })
  it.each([0, 120])('explicit manual %s overrides same-day outside work including zero', (minutes) => {
    expect(applyManualWeeklyOvertime(line({ [dates[0]]: manual(minutes) }), null, [movement(), movement(dates[1], '19:30')]).overtimeHours).toBe(minutes / 60 + 2.5)
  })
  it.each([0, 360])('weekly override %s beats both daily sources', (minutes) => {
    expect(applyManualWeeklyOvertime(line({ [dates[0]]: manual(120) }), { minutes }, [movement(), movement(dates[1])]).overtimeHours).toBe(minutes / 60)
  })
  it('Friday and Saturday reuse existing normal end; duplicate and overlapping movements do not double count', () => {
    const m = [movement(dates[2], '19:00'), movement(dates[3], '18:00'), movement(dates[3], '18:00')]
    expect(outsideWorkOvertimeDays(worker, dates, m).map((d) => d.minutes)).toEqual([0, 0, 120, 240])
  })
  it('Sunday has no worker normal end; only explicit foreman rule applies to an eligible payroll person', () => {
    const sunday = '2026-10-25', m = movement(sunday, '18:00')
    expect(outsideWorkOvertimeDays(worker, [sunday], [m])[0].minutes).toBe(0)
    expect(outsideWorkOvertimeDays(worker, [sunday], [{ ...m, foreman_worker_id: 'w', end_time: '18:00' }])[0].minutes).toBe(240)
  })
  it('monthly outside-work-only worker has zero base; team/grand totals include it; no fake foreman membership', () => {
    const d = { workers: [{ ...worker, payment_type: 'monthly' }, { ...worker, id: 'special', staff_classification: 'special_staff' }], attendance: [], outsideWorkMovements: [movement()], rules: {}, runs: [] }
    const before = JSON.stringify(d), report = teamWeeklyReport(d, dates[0])
    expect(report.lines).toHaveLength(1)
    expect(report.lines[0]).toMatchObject({ monthlyOvertimeOnly: true, basePay: 0, minutes: 180, finalAmount: 30 })
    expect(report.groups[0].totals.currencies.CDF.overtimeAmount).toBe(30)
    expect(report.totals.currencies.CDF.finalAmount).toBe(30)
    expect(JSON.stringify(d)).toBe(before)
  })
  it('locked paid snapshot uses saved payable value, never newer outside work', () => {
    const d = { workers: [worker], outsideWorkMovements: [movement()], runs: [{ id: 'r', payment_type: 'weekly', weekly_period_start: dates[0], weekly_period_end: dates[3], status: 'paid' }],
      payrollLines: [{ payroll_run_id: 'r', worker_id: 'w', present_days: 6, half_days: 0, absent_days: 0, final_amount: 777, overtime_amount: 50, overtime_hours: 5, currency_code_snapshot: 'CDF',
        compensation_snapshot: { overtime_rate_per_hour: 10 }, attendance_summary_snapshot: { manual_overtime_source_version: 1, payable_overtime_source_version: 2 }, calculation_snapshot: { evening_overtime_minutes: 300 } }] }
    const before = JSON.stringify(d)
    expect(teamWeeklyReport(d, dates[0]).lines[0]).toMatchObject({ minutes: 300, overtimeAmount: 50, finalAmount: 777 })
    expect(JSON.stringify(d)).toBe(before)
  })
  it('changed source evidence invalidates draft even when effective minutes are unchanged', () => {
    const current = applyManualWeeklyOvertime(line(), null, [movement()])
    expect(staleWeeklyPayrollWorkerIds([{ ...current, payableOvertimeDays: [] }], [current])).toEqual(['w'])
  })
})
