import { calculateWeeklyOvertimePay, isChauffeurNormalOvertimeExcluded } from './weeklyPayrollOvertime.js'
import { outsideWorkOvertimeDays } from './outsideWorkPayableOvertime.js'
import { approvedBiometricOvertime } from './biometricOvertimeReview.js'
import { approvedExtraDays } from './extraDayOvertime.js'
import { manualExceptionForDate, manualExceptionDays } from './manualOvertimeException.js'
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
export function applyManualWeeklyOvertime(line, override, movements = [], biometricReviews = [], extraDayReviews = []) {
  const dailyManualMinutes = (line.details || []).reduce((sum, d) => sum + manualReportMinutes(d.row), 0)
  const manualOnly = isChauffeurNormalOvertimeExcluded(line)
  const outsideDays = manualOnly ? [] : outsideWorkOvertimeDays(line.worker || {}, (line.details || []).map((d) => d.date), movements)
  const payableOvertimeDays = (line.details || []).map((detail) => {
    const exception=manualExceptionForDate(extraDayReviews,line.worker,detail.date)
    if(exception)return {date:detail.date,source:'manual_exception',minutes:exception.minutes,manual_exception:exception}
    const outside = outsideDays.find((day) => day.date === detail.date)
    const manual = hasDailyManualOvertime(detail.row)
    const sundaySource=biometricReviews.some(s=>s.sunday_evidence&&String(s.worker.id)===String(line.worker.id)&&s.work_date===detail.date)
    const approved = manualOnly&&!sundaySource ? null : approvedBiometricOvertime(line.worker || {}, detail, biometricReviews)
    return { date: detail.date, source: manual ? 'daily_manual' : approved ? 'approved_biometric' : outside?.minutes ? 'outside_work' : 'none',
      minutes: manual ? manualReportMinutes(detail.row) : approved ? approved.minutes : outside?.minutes || 0,
      ...(approved && !manual ? { biometric_approval: approved } : {}),
      outside_work_minutes: outside?.minutes || 0, movement_ids: outside?.movement_ids || [] }
  })
  const weeklyManualOverrideMinutes = override?.minutes ?? null
  const extraDates=new Set(approvedExtraDays(line.worker,(line.details||[]).map(d=>d.date),extraDayReviews).map(p=>p.date))
  for(const entry of biometricReviews) if(entry.midnight_double_ot && String(entry.worker.id)===String(line.worker.id)) extraDates.add(entry.attendance.attendance_date)
  for(const day of payableOvertimeDays) if(extraDates.has(day.date) && !day.manual_exception) {
    day.superseded_hourly_overtime={source:day.source,minutes:day.minutes}; day.minutes=0; day.source='extra_day_supersedes_hourly'
  }
  const exceptions=manualExceptionDays(payableOvertimeDays)
  const extraDayConflict=(extraDates.size>0 || exceptions.length>0) && Number(weeklyManualOverrideMinutes)>0 || exceptions.some(e=>e.currency!==line.currency)
  const minutes = extraDayConflict ? 0 : weeklyManualOverrideMinutes!=null ? weeklyManualOverrideMinutes+exceptions.reduce((s,e)=>s+e.minutes,0) : payableOvertimeDays.reduce((sum, d) => sum + d.minutes, 0)
  const overtime = calculateWeeklyOvertimePay({ eveningOvertimeMinutes: minutes, overtimeHourlyRate: line.term?.overtime_rate_per_hour,manualExceptionDays:extraDayConflict?[]:exceptions })
  return { ...line, ...overtime, overtimeRate: line.term?.overtime_rate_per_hour ?? null,
    manualOvertimeOnly: true, payableOvertimeSourceVersion: 2, payableOvertimeDays, dailyManualMinutes, weeklyManualOverrideMinutes, weeklyManualOverrideVersion: override?.version || 0, extraDayConflict,
    overtimeAmount: overtime.overtimePay ?? 0,
    finalAmount: Math.round((Number(line.finalAmount) - Number(line.overtimeAmount) + (overtime.overtimePay ?? 0)) * 100) / 100 }
}
