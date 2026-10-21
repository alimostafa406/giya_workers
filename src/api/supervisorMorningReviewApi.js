import { getSupabaseClient } from '../lib/supabase'

export const getMorningReportStatusRequest = async (date) => {
  const { data, error } = await getSupabaseClient().rpc('admin_morning_report_status', { p_date: date })
  if (error) throw error
  return data
}

export const getHistoricalSupervisorReviewRequest = async (date) => {
  const { data, error } = await getSupabaseClient().rpc('admin_get_final_supervisor_review', { p_date: date, p_finalize: false })
  if (error) throw error
  return data
}

export const finalizeSupervisorReviewRequest = async (date) => {
  const { data, error } = await getSupabaseClient().rpc('admin_get_final_supervisor_review', { p_date: date, p_finalize: true })
  if (error) throw error
  return data
}

export const saveSupervisorMorningReviewRequest = async ({ date, workerIds, results }) => {
  const { data, error } = await getSupabaseClient().rpc('admin_save_supervisor_morning_review', {
    p_date: date,
    p_worker_ids: workerIds,
    p_results: results,
  })
  if (error) throw error
  return data
}

const supervisorDraftRequest = async (date, action, context = {}, results = null) => {
  const { data, error } = await getSupabaseClient().rpc('admin_supervisor_review_draft', {
    p_date: date, p_action: action, p_snapshot_token: context.snapshot_token ?? null,
    p_revision: context.revision ?? null, p_official_token: context.official_token ?? null,
    p_results: results,
  })
  if (error) throw error
  return data
}
export const getSupervisorDraftRequest = (date) => supervisorDraftRequest(date, 'load')
export const saveSupervisorDraftRequest = ({ date, context, results }) => supervisorDraftRequest(date, 'save', context, results)
export const submitSupervisorDraftRequest = ({ date, context }) => supervisorDraftRequest(date, 'submit', context)
