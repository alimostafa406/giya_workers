import { getSupabaseClient } from '../lib/supabase'

const toArray = (value) => (Array.isArray(value) ? value : [])

export async function getEarlyMorningReviewsRequest({ status = 'needs_review' } = {}) {
  const client = getSupabaseClient()
  let reviewQuery = client
    .from('biometric_early_morning_review')
    .select('*')
    .order('event_timestamp', { ascending: false })
  if (status) reviewQuery = reviewQuery.eq('review_status', status)
  const { data: reviews, error: reviewError } = await reviewQuery
  if (reviewError) throw reviewError

  const rows = toArray(reviews)
  const workerIds = [...new Set(rows.map((row) => row.worker_id).filter(Boolean))]
  if (!workerIds.length) return { reviews: rows, workers: [], attendance: [] }

  const dates = [...new Set(rows.flatMap((row) => [row.previous_work_date, row.current_work_date]).filter(Boolean))]
  const [workersResult, attendanceResult] = await Promise.all([
    client.from('workers').select('id,full_name,employee_code,team_id,is_active').in('id', workerIds),
    client
      .from('attendance')
      .select('id,worker_id,attendance_date,status,check_in,check_out,attendance_source,manual_override,review_approved_check_out_at')
      .in('worker_id', workerIds)
      .in('attendance_date', dates),
  ])
  if (workersResult.error) throw workersResult.error
  if (attendanceResult.error) throw attendanceResult.error
  return { reviews: rows, workers: toArray(workersResult.data), attendance: toArray(attendanceResult.data) }
}

export async function resolveEarlyMorningReviewRequest(reviewId, decision) {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc('resolve_early_morning_biometric_review', {
    p_review_id: reviewId,
    p_decision: decision,
  })
  if (error) throw error
  return data
}
