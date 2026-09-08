import { getSupabaseClient } from '../lib/supabase'

const toArray = (value) => Array.isArray(value) ? value : []

// Read-only operational evidence. This RPC is also the source used by the
// monitoring report semantics: a resolved event explains a pending attendance
// write, but it never creates or implies attendance by itself.
export const getCurrentAttendanceEvidenceRequest = async (attendanceDate) => {
  const { data, error } = await getSupabaseClient().rpc('get_company_mapped_biometric_events', {
    p_date_from: attendanceDate,
    p_date_to: attendanceDate,
  })
  if (error) throw error
  return { data: toArray(data) }
}
