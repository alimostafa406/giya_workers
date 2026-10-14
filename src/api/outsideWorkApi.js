import { getSupabaseClient } from '../lib/supabase'

export async function getOutsideWorkMovements(start, end) {
  const rows = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await getSupabaseClient().from('outside_work_movements')
      .select('id,work_date,team_id,team:teams(id,name),status,foreman_worker_id,foreman_name,start_time,end_time,common_worker_start,common_worker_end,missing_worker_note,entry_state,note,created_by,created_at,updated_at,outside_work_movement_workers(id,worker_id,worker_name,start_time,end_time)')
      .or(`status.eq.draft,and(work_date.gte.${start},work_date.lte.${end})`)
      .order('work_date').order('start_time').order('id').range(offset, offset + 499)
    if (error) throw error
    rows.push(...(data || []))
    if ((data || []).length < 500) return rows
  }
}

export async function getOutsideWorkTeams() {
  const { data, error } = await getSupabaseClient().from('teams')
    .select('id,name,is_active').eq('is_active', true).order('name')
  if (error) throw error
  return data || []
}

export async function saveOutsideWorkMovement(values) {
  const { data, error } = await getSupabaseClient().rpc('admin_save_outside_work_movement', {
    p_movement: {
      id: values.id || null, work_date: values.work_date || null, team_id: values.team_id || null,
      status: values.status, foreman_worker_id: values.foreman_worker_id || null,
      foreman_name: values.foreman_name || null, start_time: values.start_time || null,
      end_time: values.end_time || null, common_worker_start: values.common_worker_start || null,
      common_worker_end: values.common_worker_end || null, note: values.note || null,
      missing_worker_note: values.missing_worker_note || null, entry_state: values.entry_state || {},
      workers: values.workers.map((worker) => ({ worker_id: worker.worker_id,
        start_time: worker.start_time || null, end_time: worker.end_time || null })),
    },
  })
  if (error) throw error
  return data
}

export async function deleteOutsideWorkMovement(id) {
  const { error } = await getSupabaseClient().rpc('admin_delete_outside_work_movement', { p_id: id })
  if (error) throw error
}
