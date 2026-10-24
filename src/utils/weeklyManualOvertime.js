import { calculateWeeklyOvertimePay, isChauffeurNormalOvertimeExcluded } from './weeklyPayrollOvertime.js'
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
export function applyManualWeeklyOvertime(line, override) {
  const dailyManualMinutes = (line.details || []).reduce((sum, d) => sum + manualReportMinutes(d.row), 0)
  const weeklyManualOverrideMinutes = override?.minutes ?? null
  const minutes = isChauffeurNormalOvertimeExcluded(line) ? 0 : weeklyManualOverrideMinutes ?? dailyManualMinutes
  const overtime = calculateWeeklyOvertimePay({ eveningOvertimeMinutes: minutes, overtimeHourlyRate: line.term?.overtime_rate_per_hour })
  return { ...line, ...overtime, overtimeRate: line.term?.overtime_rate_per_hour ?? null,
    manualOvertimeOnly: true, dailyManualMinutes, weeklyManualOverrideMinutes, weeklyManualOverrideVersion: override?.version || 0,
    overtimeAmount: overtime.overtimePay ?? 0,
    finalAmount: Math.round((Number(line.finalAmount) - Number(line.overtimeAmount) + (overtime.overtimePay ?? 0)) * 100) / 100 }
}
