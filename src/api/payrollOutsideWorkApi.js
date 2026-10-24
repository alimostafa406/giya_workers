import { getSupabaseClient } from '../lib/supabase'

// Read only the selected payroll period, not the outside-work editor's drafts.
export async function getPayrollOutsideWork(start, end) {
  if (!start || !end) return []
  const rows = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await getSupabaseClient().from('outside_work_movements')
      .select('id,work_date,status,foreman_worker_id,start_time,end_time,common_worker_start,common_worker_end,outside_work_movement_workers(worker_id,start_time,end_time)')
      .eq('status', 'final').gte('work_date', start).lte('work_date', end).order('id').range(offset, offset + 499)
    if (error) throw error
    rows.push(...(data || []))
    if ((data || []).length < 500) return rows
  }
}
