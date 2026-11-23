import { getSupabaseClient } from '../lib/supabase'
import { getPayrollOvertimeContext } from './payrollOvertimeContextApi'
import { getBiometricOvertimeReviews } from './biometricOvertimeReviewApi'
export async function getSundayPayroll(date) {
  const [{ data, error }, context, movements, biometricOvertimeReviews] = await Promise.all([
    getSupabaseClient().rpc('admin_get_sunday_payroll', { p_date: date }),
    getPayrollOvertimeContext(date,date),
    getSupabaseClient().from('outside_work_movements').select('*,outside_work_movement_workers(*)').eq('work_date',date).eq('status','final'),
    getBiometricOvertimeReviews(date),
  ])
  if (error) throw error
  if (movements.error) throw movements.error
  return {...data,...context,biometricOvertimeReviews,outsideWorkMovements:movements.data||[]}
}
export async function confirmSundayPayroll(row, date) {
  const { data, error } = await getSupabaseClient().rpc('admin_confirm_sunday_payroll', {
    p_worker: row.worker.id, p_date: date, p_expected_updated_at: row.attendance?.updated_at || null,
  })
  if (error) throw error
  return data
}
export async function getWorkerSundaySettings(workerId){
 const {data,error}=await getSupabaseClient().rpc('admin_get_worker_sunday_settings',{p_worker:workerId})
 if(error)throw error
 return data
}
export async function saveWorkerSundaySettings(workerId,settings,version){
 const {data,error}=await getSupabaseClient().rpc('admin_save_worker_sunday_settings',{p_worker:workerId,p_settings:settings,p_expected_version:version})
 if(error)throw error
 return data
}
