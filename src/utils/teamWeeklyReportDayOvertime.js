import { formatBiometricOvertimeDuration } from './biometricOvertimeReview.js'
import { isChauffeurNormalOvertimeExcluded } from './weeklyPayrollOvertime.js'

// Presentation only: consume the canonical date ledger, never calculate OT
// from clocks or allocate an undated weekly override to individual days.
export function teamReportDayOvertime(line, date) {
  const day = line.payableOvertimeDays?.find(day => day.date === date)
  if (line.weeklyManualOverrideMinutes != null && !day?.manual_exception) return 0
  if (isChauffeurNormalOvertimeExcluded(line) && !['daily_manual','manual_exception'].includes(day?.source)) return 0
  return ['daily_manual', 'approved_biometric', 'outside_work','manual_exception'].includes(day?.source)
    && Number.isInteger(day.minutes) && day.minutes > 0 ? day.minutes : 0
}

export function formatTeamReportDayOvertime(minutes) {
  if (!Number.isInteger(minutes) || minutes <= 0) return ''
  return formatBiometricOvertimeDuration(minutes).replace(/h00$/, 'h')
}

// Payroll-only presentation: use the canonical localized attendance status,
// never replace present with an operational O marker. All payroll print paths
// consume this same date-specific OT formatter without recalculating totals.
export function payrollDayPresentation(line, date, statusText) {
  return { status: statusText, duration: formatTeamReportDayOvertime(teamReportDayOvertime(line, date)) }
}

export function isOutsideWorkReportDay(detail, day) {
  return detail?.row?.attendance_source === 'outside_work'
    || detail?.row?.biometric_sync_metadata?.supervisor_morning_review?.choice === 'O'
    || day?.source === 'outside_work'
    || (day?.outside_work_minutes > 0 && day?.movement_ids?.length > 0)
}
