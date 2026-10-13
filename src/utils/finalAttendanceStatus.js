import policy from '../../attendance_final_status_policy.json' with { type: 'json' }

export const isFinalAttendanceRuleDate = (date) => Boolean(date && String(date) >= policy.effective_date)

// A supervisor decision is already canonical; biometric evidence is never
// allowed to replace it. Legacy dates retain their stored half-day semantics.
export const finalAttendanceStatus = (row = null, date = row?.attendance_date || row?.date, businessDate = '') => {
  const status = row?.status || null
  if (!isFinalAttendanceRuleDate(date)) return status
  if (row?.manual_override === true || (row?.attendance_source && row.attendance_source !== 'biometric')) return status
  if (status === 'present' || status === 'absent') return status
  if ((status === 'half_day' || status === 'late' || status === 'in_progress' || status === 'pending')
    && (row?.check_in || row?.check_out)) return 'present'
  if (!status && businessDate && date < businessDate) return 'absent'
  return status === 'half_day' || status === 'late' ? null : status
}
