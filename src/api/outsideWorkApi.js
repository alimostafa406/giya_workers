import { getSupabaseClient } from '../lib/supabase'

export async function getOutsideWorkMovements(start, end) {
  const { data, error } = await getSupabaseClient().from('outside_work_movements')
    .select('id,work_date,foreman_worker_id,foreman_name,start_time,end_time,note,created_by,created_at,outside_work_movement_workers(id,worker_id,worker_name,start_time,end_time)')
    .gte('work_date', start).lte('work_date', end)
    .order('work_date').order('start_time')
  if (error) throw error
  return data || []
}

export async function saveOutsideWorkMovement(values) {
  const { data, error } = await getSupabaseClient().rpc('admin_save_outside_work_movement', {
    p_id: values.id || null,
    p_date: values.work_date,
    p_foreman_worker_id: values.foreman_worker_id || null,
    p_foreman_name: values.foreman_name,
    p_start_time: values.start_time,
    p_end_time: values.end_time,
    p_note: values.note || null,
    p_workers: values.workers,
  })
  if (error) throw error
  return data
}

export async function deleteOutsideWorkMovement(id) {
  const { error } = await getSupabaseClient().rpc('admin_delete_outside_work_movement', { p_id: id })
  if (error) throw error
}
