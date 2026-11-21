import { getSupabaseClient } from '../lib/supabase'
export async function getManualOvertimeExceptions(date,team,worker=null){
 const {data,error}=await getSupabaseClient().rpc('admin_get_manual_overtime_exceptions',{p_date:date,p_team:team,p_worker:worker||null})
 if(error)throw error
 return data
}
export async function saveManualOvertimeException(values){
 const {data,error}=await getSupabaseClient().rpc('admin_save_manual_overtime_exception',values)
 if(error)throw error
 return data
}
