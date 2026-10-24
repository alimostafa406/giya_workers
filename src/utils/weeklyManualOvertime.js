import { calculateWeeklyOvertimePay, isChauffeurNormalOvertimeExcluded } from './weeklyPayrollOvertime.js'
import { outsideWorkOvertimeDays } from './outsideWorkPayableOvertime.js'
export const hasDailyManualOvertime = (row) => row?.manual_override === true
  && row.emergency_overtime_mode === 'manual_overtime_duration'
  && row.emergency_overtime_minutes != null && Number.isInteger(Number(row.emergency_overtime_minutes)) && Number(row.emergency_overtime_minutes) >= 0
export const manualReportMinutes = (row) => row?.manual_override === true
  && row.emergency_overtime_mode === 'manual_overtime_duration'
  && Number.isInteger(Number(row.emergency_overtime_minutes)) && Number(row.emergency_overtime_minutes) >= 0
  ? Number(row.emergency_overtime_minutes) : 0
export const parseWeeklyDuration = (value) => {
  const text = String(value).trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  const match = text.match(/^(\d{1,3}):([0-5]\d)$/)
  const minutes = match ? Number(match[1]) * 60 + Number(match[2]) : NaN
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= 8640 ? minutes : null
}
export function applyManualWeeklyOvertime(line, override, movements = []) {
  const dailyManualMinutes = (line.details || []).reduce((sum, d) => sum + manualReportMinutes(d.row), 0)
  const outsideDays = outsideWorkOvertimeDays(line.worker || {}, (line.details || []).map((d) => d.date), movements)
  const payableOvertimeDays = (line.details || []).map((detail) => {
    const outside = outsideDays.find((day) => day.date === detail.date)
    const manual = hasDailyManualOvertime(detail.row)
    return { date: detail.date, source: manual ? 'daily_manual' : outside?.minutes ? 'outside_work' : 'none',
      minutes: manual ? manualReportMinutes(detail.row) : outside?.minutes || 0,
      outside_work_minutes: outside?.minutes || 0, movement_ids: outside?.movement_ids || [] }
  })
  const weeklyManualOverrideMinutes = override?.minutes ?? null
  const minutes = isChauffeurNormalOvertimeExcluded(line) ? 0 : weeklyManualOverrideMinutes ?? payableOvertimeDays.reduce((sum, d) => sum + d.minutes, 0)
  const overtime = calculateWeeklyOvertimePay({ eveningOvertimeMinutes: minutes, overtimeHourlyRate: line.term?.overtime_rate_per_hour })
  return { ...line, ...overtime, overtimeRate: line.term?.overtime_rate_per_hour ?? null,
    manualOvertimeOnly: true, payableOvertimeSourceVersion: 2, payableOvertimeDays, dailyManualMinutes, weeklyManualOverrideMinutes, weeklyManualOverrideVersion: override?.version || 0,
    overtimeAmount: overtime.overtimePay ?? 0,
    finalAmount: Math.round((Number(line.finalAmount) - Number(line.overtimeAmount) + (overtime.overtimePay ?? 0)) * 100) / 100 }
}
