import { getSupabaseClient } from '../lib/supabase'

// One period-bounded read shares Double OT evidence between payroll premium
// and hourly ownership. Never materialize review candidates while loading pay.
export async function getPayrollOvertimeContext(start, end) {
  if (!start || !end) return { biometricOvertimeReviews: [], extraDayReviews: [] }
  const { data, error } = await getSupabaseClient().rpc('admin_get_payroll_overtime_context', { p_start: start, p_end: end })
  if (error) throw error
  return { biometricOvertimeReviews: data?.biometricOvertimeReviews || [], extraDayReviews: data?.extraDayReviews || [] }
}
