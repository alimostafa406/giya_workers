import { getSupabaseClient } from '../lib/supabase'
import { getPayrollOvertimeContext } from './payrollOvertimeContextApi'
export async function getSundayPayroll(date) {
  const [{ data, error }, context, movements] = await Promise.all([
    getSupabaseClient().rpc('admin_get_sunday_payroll', { p_date: date }),
    getPayrollOvertimeContext(date,date),
    getSupabaseClient().from('outside_work_movements').select('*,outside_work_movement_workers(*)').eq('work_date',date).eq('status','final'),
  ])
  if (error) throw error
  if (movements.error) throw movements.error
  return {...data,...context,outsideWorkMovements:movements.data||[]}
}
export async function confirmSundayPayroll(row, date) {
  const { data, error } = await getSupabaseClient().rpc('admin_confirm_sunday_payroll', {
    p_worker: row.worker.id, p_date: date, p_expected_updated_at: row.attendance?.updated_at || null,
  })
  if (error) throw error
  return data
}
