import { getSupabaseClient } from '../lib/supabase'

export const saveSupervisorMorningReviewRequest = async ({ date, workerIds, results }) => {
  const { data, error } = await getSupabaseClient().rpc('admin_save_supervisor_morning_review', {
    p_date: date,
    p_worker_ids: workerIds,
    p_results: results,
  })
  if (error) throw error
  return data
}
