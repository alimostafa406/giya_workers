import { getSupabaseClient } from '../lib/supabase'

export const getCurrentWeeklyPayrollPublicationRequest = async () => {
  const { data, error } = await getSupabaseClient().rpc('get_current_weekly_payroll_publication_admin')
  if (error) throw error
  return data || {}
}

export const setCurrentWeeklyPayrollPublicationRequest = async (publish) => {
  const { data, error } = await getSupabaseClient().rpc('set_current_weekly_payroll_viewer_publication', {
    p_publish: Boolean(publish),
  })
  if (error) throw error
  return data
}
