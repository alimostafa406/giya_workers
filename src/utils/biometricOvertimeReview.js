import { weeklyPayrollOvertimeForDetail } from './weeklyPayrollOvertime.js'
import { isWeeklyOvertimeEligibleWorker } from './overtimeWorkerScope.js'

export const biometricReviewTitle = 'مراجعة الوقت الإضافي من البصمة'
export const MINIMUM_BIOMETRIC_REVIEW_MINUTES = 30
export function biometricOvertimeMinutes(worker, row, date) {
  if (!isWeeklyOvertimeEligibleWorker(worker, date) || row?.attendance_source !== 'biometric'
    || !row.check_out || !['present','late','half_day'].includes(row.status)
    || (row.manual_override && row.emergency_overtime_mode !== 'manual_overtime_duration')) return 0
  // Remove only the manual-duration input: the real clocks/evidence are unchanged.
  return weeklyPayrollOvertimeForDetail({ date, worker, row: { ...row, manual_override: false, emergency_overtime_mode: null, emergency_overtime_minutes: null } }).eveningOvertimeMinutes
}
function derivedBiometricRows(sources = []) {
  return sources.map((source) => {
    const minutes = biometricOvertimeMinutes(source.worker, source.attendance, source.attendance.attendance_date)
    const review = source.review
    const stale = Boolean(review && (review.source_fingerprint !== source.source_fingerprint || Number(review.minutes) !== minutes))
    return { ...source, minutes, stale, status: review && !stale ? review.decision : 'pending' }
  }).filter((row) => row.minutes > 0)
}
export function biometricReviewRows(sources = []) {
  return derivedBiometricRows(sources).filter((row) => row.minutes >= MINIMUM_BIOMETRIC_REVIEW_MINUTES)
}
export function approvedBiometricOvertime(worker, detail, sources = []) {
  const entry = sources.find((s) => String(s.worker.id) === String(worker.id) && s.attendance.attendance_date === detail.date)
  if (!entry || !detail.row || String(entry.attendance.id) !== String(detail.row.id)
    || ['check_in','check_out','status','attendance_source'].some((key) => String(entry.attendance[key] || '') !== String(detail.row[key] || ''))
    || entry.attendance.biometric_sync_metadata?.check_out_event_timestamp !== detail.row.biometric_sync_metadata?.check_out_event_timestamp) return null
  const reviewed = derivedBiometricRows([entry])[0]
  if (reviewed?.status !== 'approved' || reviewed.minutes !== biometricOvertimeMinutes(worker, detail.row, detail.date)) return null
  return { minutes: reviewed.minutes, version: reviewed.review.version, actor: reviewed.review.actor,
    decided_at: reviewed.review.decided_at, source_fingerprint: entry.source_fingerprint }
}
export function unresolvedBiometricOvertime(data, dates) {
  return biometricReviewRows(data.biometricOvertimeReviews || []).filter((entry) => {
    if (!dates.includes(entry.attendance.attendance_date)) return false
    const override = (data.weeklyOvertimeOverrides || []).find((o) => String(o.worker_id) === String(entry.worker.id))
    if (override?.minutes != null) return false
    const row = (data.attendance || []).find((a) => String(a.worker_id) === String(entry.worker.id) && a.attendance_date === entry.attendance.attendance_date)
    if (row?.manual_override && row.emergency_overtime_mode === 'manual_overtime_duration' && row.emergency_overtime_minutes != null) return false
    return entry.status === 'pending' || (entry.status === 'approved' && !approvedBiometricOvertime(entry.worker, { date: entry.attendance.attendance_date, row }, data.biometricOvertimeReviews))
  })
}
export function assertBiometricReviewsResolved(data, dates) {
  const pending = unresolvedBiometricOvertime(data, dates)
  if (pending.length) throw new Error(`توجد مراجعات إضافي بصمة غير محسومة: ${pending.length}. راجعها قبل اعتماد الرواتب.`)
}
