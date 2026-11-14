import {getSupabaseClient} from '../lib/supabase'
export async function getExtraDayEndReviews(date,team,end='00:00',tolerance=30) {
  if (!date || !team || !end || tolerance === '') return []
  const {data,error}=await getSupabaseClient().rpc('admin_get_extra_day_end_reviews',{
    p_date:date,p_team:team,p_end:end,p_tolerance:Number(tolerance),
  })
  if(error) throw error
  return data||[]
}
export async function getExtraDaySessionReviews(date,team,start,end,tolerance) {
  if (!date || !team || !start || !end || tolerance === '') return []
  const {data,error}=await getSupabaseClient().rpc('admin_get_extra_day_session_reviews',{
    p_date:date,p_team:team,p_start:start,p_end:end,p_tolerance:Number(tolerance),
  })
  if(error) throw error
  return data||[]
}
export async function getDailyExtraDayReviews(date,team) {
  if (!date || !team) return []
  const {data,error}=await getSupabaseClient().rpc('admin_get_daily_extra_day_reviews',{p_date:date,p_team:team})
  if(error) throw error
  return data||[]
}
export async function getExtraDayReviews(start,end=start) {
  if (!start || !end) return []
  const {data,error}=await getSupabaseClient().rpc('admin_get_extra_day_reviews',{p_start:start,p_end:end})
  if(error) throw error
  return data||[]
}
export async function getExtraDayRules() {
  const {data,error}=await getSupabaseClient().from('extra_day_overtime_rule').select('*').order('start_date',{ascending:false})
  if(error) throw error
  return data||[]
}
export async function getExtraDayTeams() {
  const {data,error}=await getSupabaseClient().from('teams').select('id,name').order('name')
  if(error) throw error
  return data||[]
}
export async function saveExtraDayRule(rule,id=null,version=0) {
  const {data,error}=await getSupabaseClient().rpc('admin_save_extra_day_rule',{p_rule:rule,p_id:id,p_version:version})
  if(error) throw error
  return data
}
export async function decideExtraDays(rows,decision) {
  const {data,error}=await getSupabaseClient().rpc('admin_decide_extra_day',{p_entries:rows.map(r=>({rule_id:r.rule_id,worker_id:r.worker_id,work_date:r.work_date,
    expected_version:r.review.version,source_fingerprint:r.source.fingerprint,decision}))})
  if(error) throw error
  return data
}
