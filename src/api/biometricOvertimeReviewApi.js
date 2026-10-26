import { getSupabaseClient } from '../lib/supabase'

export async function getBiometricOvertimeReviews(start, end = start) {
  if (!start || !end) return []
  const { data, error } = await getSupabaseClient().rpc('admin_get_biometric_overtime_review', { p_start: start, p_end: end })
  if (error) throw error
  return data || []
}
export async function decideBiometricOvertime(date, rows, decision) {
  const { data, error } = await getSupabaseClient().rpc('admin_decide_biometric_overtime', { p_date: date,
    p_entries: rows.map((row) => ({ worker_id: row.worker.id, minutes: row.minutes, decision,
      source_fingerprint: row.source_fingerprint, expected_version: row.review?.version || 0 })) })
  if (error) throw error
  return data
}
