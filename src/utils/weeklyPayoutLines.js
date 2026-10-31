import { calculatePayrollLine, weeklyDates } from './payrollCalculations.js'
import { isNormalPayrollWorkerOnDate, isWeeklyPayrollEligibleWorker, weeklyPayrollPeriodWorkers } from './weeklyPayrollEligibility.js'
import { applyManualWeeklyOvertime } from './weeklyManualOvertime.js'
import { calculateWeeklyOvertimePay } from './weeklyPayrollOvertime.js'

// One calculation path for preview, Save Draft and the payout report.
// Monthly salary, wage deductions and cycle never enter a weekly payout.
// Monthly workers receive canonical attendance-based transport plus payable OT.
export function calculateWeeklyPayoutLine(data, monday, worker) {
  const monthly = worker.payment_type === 'monthly'
  const term = monthly ? { currency_code: worker.payroll_compensation?.currency_code,
    overtime_rate_per_hour: worker.payroll_compensation?.overtime_rate_per_hour,
    daily_rate: 0, daily_transport_allowance: worker.payroll_compensation?.daily_transport_allowance, monthly_salary: 0 } : worker.payroll_compensation
  const dates = weeklyDates(monday).filter((date) => !worker.operational_start_date || date >= worker.operational_start_date)
  const line = calculatePayrollLine({ worker, term, dates,
    attendanceByDate: new Map((data.attendance || []).map((row) => [`${row.worker_id}|${row.attendance_date}`, row])),
    rules: data.rules, holidayDates: new Set((data.holidays || []).map((day) => day.holiday_date)), paymentType: 'weekly', futureDatesAreNeutral: true })
  const effective = applyManualWeeklyOvertime(line, (data.weeklyOvertimeOverrides || []).find((o) => String(o.worker_id) === String(worker.id)), data.outsideWorkMovements || [], data.biometricOvertimeReviews || [])
  // Keep the persisted legacy marker for snapshot compatibility: it now denotes
  // a monthly worker's weekly supplement (transport + OT), never monthly salary.
  return monthly ? { ...effective, paymentType: 'monthly', monthlyOvertimeOnly: true,
    baseAmount: 0, attendanceWage: 0, holidayAmount: 0,
    monthlySalary: 0, dailyValue: 0, absenceDeduction: 0, halfDayDeduction: 0,
    finalAmount: Math.round((effective.transportAmount + effective.overtimeAmount) * 100) / 100 } : effective
}

export function weeklyPayoutLines(data, monday) {
  if (!data) return []
  const end = weeklyDates(monday).at(-1)
  return weeklyPayrollPeriodWorkers(data, monday, end).filter((worker) => isWeeklyPayrollEligibleWorker(worker, end)
    || (worker.payment_type === 'monthly' && isNormalPayrollWorkerOnDate(worker, end)))
    .map((worker) => calculateWeeklyPayoutLine(data, monday, worker))
}

// Stored payment type/marker, never today's roster, decides historical display.
export const weeklyPayoutSnapshotLines = (lines = []) => lines.filter((line) =>
  line.paymentType === 'weekly' || (line.paymentType === 'monthly' && line.monthlyOvertimeOnly === true))

export const weeklyPayoutSourceSnapshot = (line) => ({
  weekly_manual_overtime_override_version: line.weeklyManualOverrideVersion || 0,
  effective_overtime_sources: line.weeklyManualOverrideMinutes != null ? ['weekly_manual_override']
    : [...new Set((line.payableOvertimeDays || []).filter((day) => day.minutes > 0).map((day) => day.source))],
})

// Recheck fresh canonical inputs immediately before moving a Draft to Reviewed.
// Finalization itself keeps the already-reviewed snapshot, never recalculates it.
export function assertWeeklyPayoutDraftReady(stored, calculated) {
  if (stored.length !== calculated.length || !stored.length) throw new Error('Refresh weekly payroll Draft: payout worker population changed.')
  for (const line of calculated) {
    const old = stored.find((s) => String(s.worker_id) === String(line.worker.id))
    const snapshot = old?.attendance_summary_snapshot || {}
    if (line.missingRateBlocker || line.unresolvedDays > 0 || !line.currency) throw new Error(`Weekly payout is unresolved: ${line.worker.full_name}`)
    if (!old || snapshot.weekly_payout_source_version !== 3
      || Number(old.calculation_snapshot?.evening_overtime_minutes) !== Number(line.eveningOvertimeMinutes)
      || Number(old.overtime_hours) !== Number(line.overtimeHours)
      || Number(old.overtime_amount) !== Number(line.overtimeAmount)
      || Number(old.transport_amount) !== Number(line.transportAmount)
      || old.compensation_snapshot?.daily_transport_allowance !== line.term?.daily_transport_allowance
      || old.compensation_snapshot?.overtime_rate_per_hour !== line.term?.overtime_rate_per_hour
      || old.currency_code_snapshot !== line.currency
      || Number(old.final_amount) !== Number(line.finalAmount)
      || Boolean(snapshot.monthly_overtime_only) !== Boolean(line.monthlyOvertimeOnly)
      || (snapshot.weekly_manual_overtime_override_minutes ?? null) !== (line.weeklyManualOverrideMinutes ?? null)
      || JSON.stringify(snapshot.payable_overtime_days || []) !== JSON.stringify(line.payableOvertimeDays || [])) {
      throw new Error(`Refresh weekly payroll Draft: payout changed for ${line.worker.full_name}`)
    }
  }
}

export function assertWeeklyPayoutSnapshotComplete(stored) {
  if (!stored.length || stored.some((line) => {
    const summary = line.attendance_summary_snapshot || {}, rate = line.compensation_snapshot?.overtime_rate_per_hour
    const minutes = Number(line.calculation_snapshot?.evening_overtime_minutes)
    const expected = calculateWeeklyOvertimePay({ eveningOvertimeMinutes: minutes, overtimeHourlyRate: rate })
    return summary.weekly_payout_source_version !== 3 || summary.manual_overtime_only !== true
      || !Number.isFinite(minutes) || minutes < 0
      || Number(line.overtime_hours) !== Number(expected.overtimeHours)
      || Number(line.overtime_amount) !== Number(expected.overtimePay)
      || (summary.monthly_overtime_only && Number(line.transport_amount) > 0 && (line.compensation_snapshot?.daily_transport_allowance == null
        || !Number.isFinite(Number(line.compensation_snapshot.daily_transport_allowance))
        || Number(line.transport_amount) !== Math.round(Number(line.calculation_snapshot?.transport_days) * Number(line.compensation_snapshot.daily_transport_allowance) * 100) / 100))
      || (minutes > 0 && (rate == null || rate === '' || !Number.isFinite(Number(rate)) || Number(rate) < 0))
      || (summary.monthly_overtime_only && (Number(line.base_amount) !== 0 || Number(line.transport_amount) < 0 || !Number.isFinite(Number(line.transport_amount)) || Number(line.holiday_amount) !== 0 || Number(line.final_amount) !== Math.round((Number(line.transport_amount) + Number(line.overtime_amount)) * 100) / 100))
  })) throw new Error('Weekly payout snapshot is incomplete. Reopen Reviewed payroll as Draft and refresh before finalizing.')
}
