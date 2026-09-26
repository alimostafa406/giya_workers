import { getSupabaseClient } from '../lib/supabase'

export const getOvertimeReportSettings = async () => {
  const { data, error } = await getSupabaseClient().rpc('get_overtime_report_settings')
  if (error) throw error
  return data
}
export const saveOvertimeReportSettings = async (teamIds) => {
  const { data, error } = await getSupabaseClient().rpc('save_overtime_report_settings', { p_team_ids: teamIds })
  if (error) throw error
  window.dispatchEvent(new Event('overtime-report-settings-changed'))
  return data
}
