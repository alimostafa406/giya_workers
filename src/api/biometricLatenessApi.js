import { getSupabaseClient } from '../lib/supabase'

export async function getBiometricLatenessReviews(start, end = start) {
  if (!start || !end) return []
  const { data, error } = await getSupabaseClient().rpc('admin_get_biometric_lateness_review', { p_start: start, p_end: end })
  if (error) throw error
  return data || []
}

export async function decideBiometricLateness(date, row, decision, minutes, amount, note) {
  const { data, error } = await getSupabaseClient().rpc('admin_decide_biometric_lateness', { p_date: date, p_entries: [{
    worker_id: row.worker.id, decision, approved_minutes: minutes, deduction_amount: amount, note,
    source_fingerprint: row.evidence?.source_fingerprint, expected_version: row.review?.version || 0,
  }] })
  if (error) throw error
  return data
}
