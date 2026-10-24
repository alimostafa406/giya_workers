import { getSupabaseClient } from '../lib/supabase'
export async function getWeeklyOvertimeOverrides(week) {
  const rows = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await getSupabaseClient().from('worker_weekly_overtime_override')
      .select('worker_id,week_start,minutes,version').eq('week_start', week).order('worker_id').range(offset, offset + 499)
    if (error) throw error
    rows.push(...(data || [])); if ((data || []).length < 500) return rows
  }
}
export async function saveWeeklyOvertime({ week, entries }) {
  if (!entries.length || entries.length > 200 || entries.some((e) => e.minutes !== null && (!Number.isInteger(e.minutes) || e.minutes < 0 || e.minutes > 8640))) throw new Error('Invalid weekly duration')
  const { data, error } = await getSupabaseClient().rpc('admin_set_weekly_overtime', { p_week_start: week,
    p_entries: entries.map(({ worker_id, minutes, expected_version }) => ({ worker_id, minutes, expected_version })) })
  if (error) throw error
  return data
}
