// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import OvertimeEntry from './OvertimeEntry'
import { LanguageProvider } from '../i18n/LanguageContext'
import { parseWeeklyDuration, applyManualWeeklyOvertime } from '../utils/weeklyManualOvertime'
import { teamWeeklyReport } from '../utils/teamWeeklyReport'
globalThis.React = React
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), daily: vi.fn() }))
vi.mock('../api/payrollOperationsApi', () => ({ getPayrollOperationsDataRequest: mocks.load }))
vi.mock('../api/weeklyOvertimeApi', () => ({ saveWeeklyOvertime: mocks.save }))
vi.mock('../api/overtimeEntryApi', () => ({ getOvertimeEntryData: mocks.daily, saveOvertimeEntry: vi.fn() }))
const week = '2026-10-19', end = '2026-10-24'
const worker = (id, team = 'Siraj') => ({ id, full_name: id, employee_code: id, team_id: team, team_name: team, payment_type: 'weekly', is_active: true,
  payroll_compensation: { daily_rate: 100, daily_transport_allowance: 0, overtime_rate_per_hour: 20, currency_code: 'CDF' } })
const manual = { manual_override: true, emergency_overtime_mode: 'manual_overtime_duration', emergency_overtime_minutes: 360 }
const fixture = () => ({ workers: [worker('A'), worker('B'), worker('C', 'Zarour')], attendance: [19, 20, 21].map((day) => ({ worker_id: 'A', attendance_date: `2026-10-${day}`, status: 'present', attendance_day_fraction: 1, ...manual })), weeklyOvertimeOverrides: [], runs: [], payrollLines: [], payrollAdjustments: [], rules: {}, holidays: [] })
afterEach(() => { cleanup(); vi.clearAllMocks() })
async function open(data) {
  mocks.load.mockResolvedValue(data); mocks.daily.mockResolvedValue({ workers: [], attendance: [], lockedIds: [], date: '2026-10-24' }); mocks.save.mockResolvedValue([])
  render(<LanguageProvider><OvertimeEntry /></LanguageProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'إجمالي أسبوعي', exact: true }))
  await waitFor(() => expect(screen.getByLabelText('الفريق').disabled).toBe(false))
  fireEvent.change(screen.getByLabelText('الأسبوع'), { target: { value: week } })
  await waitFor(() => expect(screen.getByLabelText('الفريق').disabled).toBe(false))
  fireEvent.change(screen.getByLabelText('الفريق'), { target: { value: 'Siraj' } })
}
it.each(['0:00', '2:30', '10:00', '25:00', '37:30', '50:00', '144:00'])('accepts weekly duration %s without wrapping', (value) => expect(parseWeeklyDuration(value)).not.toBeNull())
it('rejects invalid minutes and durations beyond six complete days', () => {
  for (const value of ['25:60', '-1:00', '144:01', '200:00']) expect(parseWeeklyDuration(value)).toBeNull()
})
it('visible weekly mode applies 25h to two workers, keeps individual 27h, saves week IDs not dates', async () => {
  const d = fixture(), before = JSON.stringify(d.attendance)
  await open(d)
  fireEvent.click(screen.getByRole('button', { name: 'اختيار الكل', exact: true }))
  fireEvent.change(screen.getByLabelText('إجمالي الإضافي الأسبوعي'), { target: { value: '25:00' } })
  fireEvent.click(screen.getByRole('button', { name: 'تطبيق على المختارين' }))
  expect(screen.getByLabelText('القيمة الجديدة: A').value).toBe('25:00')
  expect(screen.getByLabelText('القيمة الجديدة: B').value).toBe('25:00')
  fireEvent.change(screen.getByLabelText('القيمة الجديدة: B'), { target: { value: '27:00' } })
  expect(screen.getByLabelText('القيمة الجديدة: A').value).toBe('25:00'); expect(mocks.save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'معاينة الإجمالي الأسبوعي' }))
  fireEvent.click(screen.getByRole('button', { name: 'حفظ الإجمالي الأسبوعي' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ week, entries: [
    { worker_id: 'A', minutes: 1500, expected_version: 0 }, { worker_id: 'B', minutes: 1620, expected_version: 0 },
  ] }))
  await screen.findByText('تم حفظ الإجمالي الأسبوعي')
  expect(screen.getByLabelText('الأسبوع').value).toBe(week)
  expect(JSON.stringify(d.attendance)).toBe(before)
  fireEvent.change(screen.getByLabelText('الفريق'), { target: { value: 'Zarour' } })
  expect(screen.getByRole('checkbox', { name: 'C' })).toBeTruthy()
})
it('clear sends null with version, not zero and not attendance writes', async () => {
  const d = fixture(); d.weeklyOvertimeOverrides = [{ worker_id: 'A', minutes: 1500, version: 3 }]
  await open(d); fireEvent.click(screen.getByRole('checkbox', { name: 'A' }))
  fireEvent.click(screen.getByRole('button', { name: 'مسح التجاوز الأسبوعي للمختارين' }))
  fireEvent.click(screen.getByRole('button', { name: 'حفظ الإجمالي الأسبوعي' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ week, entries: [{ worker_id: 'A', minutes: null, expected_version: 3 }] }))
})
it.each(['finalized', 'paid', 'reviewed'])('weekly controls cannot edit %s week', async (status) => {
  const d = fixture(); d.runs = [{ payment_type: 'weekly', weekly_period_start: week, weekly_period_end: end, status }]
  await open(d)
  expect(screen.getByText('أسبوع الرواتب مقفل — للقراءة فقط')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'تطبيق على المختارين' }).closest('fieldset').disabled).toBe(true)
})
it('weekly 25 overrides daily 18, clear restores 18; zero overrides and biometric never falls back', () => {
  const line = { worker: worker('A'), term: { overtime_rate_per_hour: 20 }, finalAmount: 400, overtimeAmount: 100,
    details: [1, 2, 3].map(() => ({ row: manual })) }
  expect(applyManualWeeklyOvertime(line, { minutes: 1500 })).toMatchObject({ overtimeHours: 25, overtimeAmount: 500, finalAmount: 800 })
  expect(applyManualWeeklyOvertime(line, { minutes: null })).toMatchObject({ overtimeHours: 18, overtimeAmount: 360 })
  expect(applyManualWeeklyOvertime(line, { minutes: 0 }).overtimeHours).toBe(0)
  expect(applyManualWeeklyOvertime({ ...line, details: [{ row: { check_out: '23:00' } }] }).overtimeHours).toBe(0)
})
it('team report and all-team totals use effective overrides with canonical rates, without mutation', () => {
  const d = fixture(); d.weeklyOvertimeOverrides = [{ worker_id: 'A', minutes: 1500, version: 1 }, { worker_id: 'B', minutes: 120, version: 1 }]
  const before = JSON.stringify(d), report = teamWeeklyReport(d, week)
  expect(report.lines[0]).toMatchObject({ minutes: 1500, overtimeAmount: 500, basePay: 300, finalAmount: 800 })
  expect(report.groups.find((g) => g.id === 'Siraj').totals.minutes).toBe(1620)
  expect(report.totals.currencies.CDF.overtimeAmount).toBe(540)
  expect(report.totals.currencies.CDF.finalAmount).toBe(840)
  expect(JSON.stringify(d)).toBe(before)
})
it.each([0, 1500])('finalized snapshot freezes weekly override %s despite later live changes', (minutes) => {
  const d = fixture(); d.weeklyOvertimeOverrides = [{ worker_id: 'A', minutes: 3000 }]
  d.runs = [{ id: 'run', payment_type: 'weekly', weekly_period_start: week, weekly_period_end: end, status: 'finalized' }]
  d.payrollLines = [{ payroll_run_id: 'run', worker_id: 'A', worker_name_snapshot: 'A', present_days: 3, half_days: 0, absent_days: 3,
    currency_code_snapshot: 'CDF', final_amount: 300 + minutes / 60 * 20, overtime_hours: minutes / 60, overtime_amount: minutes / 60 * 20,
    compensation_snapshot: { overtime_rate_per_hour: 20 }, attendance_summary_snapshot: { manual_overtime_source_version: 1,
      weekly_manual_overtime_override_minutes: minutes, days: d.attendance.map((r) => ({ ...r, date: r.attendance_date })) } }]
  const before = JSON.stringify(d), report = teamWeeklyReport(d, week)
  expect(report.lines[0]).toMatchObject({ minutes, overtimeAmount: minutes / 60 * 20, finalAmount: 300 + minutes / 60 * 20 })
  expect(JSON.stringify(d)).toBe(before)
})
