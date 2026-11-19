import { getSupabaseClient } from '../lib/supabase'
export async function getSundayPayroll(date) {
  const { data, error } = await getSupabaseClient().rpc('admin_get_sunday_payroll', { p_date: date })
  if (error) throw error
  return data
}
export async function confirmSundayPayroll(row, date) {
  const { data, error } = await getSupabaseClient().rpc('admin_confirm_sunday_payroll', {
    p_worker: row.worker.id, p_date: date, p_expected_updated_at: row.attendance.updated_at,
  })
  if (error) throw error
  return data
}
