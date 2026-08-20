import { getSupabaseClient } from '../lib/supabase'

// The Agent processes attendance every five minutes.  Two intervals plus a
// one-minute tolerance distinguish a healthy heartbeat from delayed work.
export const ATTENDANCE_PROCESSING_STALE_AFTER_MS = (2 * 300 + 60) * 1000

export const getAttendanceAgentStatusRequest = async () => {
  const { data, error } = await getSupabaseClient()
    .from('attendance_agent_status')
    .select('agent_id,machine_name,last_seen_at,hikvision_reachable,supabase_reachable,last_user_sync_at,last_attendance_sync_at,last_error')
    .order('last_seen_at', { ascending: false })
    .limit(1)

  if (error) throw error
  return data?.[0] || null
}

export const getAttendanceAgentDeviceStatusesRequest = async (agentId) => {
  if (!agentId) return []
  const { data, error } = await getSupabaseClient()
    .from('attendance_agent_device_status')
    .select('device_id,hikvision_reachable,last_seen_at,last_successful_read_at,last_error')
    .eq('agent_id', agentId)
    .order('device_id')
  if (error) throw error
  return data || []
}

export const isAttendanceAgentOnline = (status, maxAgeMs = 3 * 60 * 1000) => {
  if (!status?.last_seen_at) return false
  const heartbeat = new Date(status.last_seen_at).getTime()
  return Number.isFinite(heartbeat) && Date.now() - heartbeat <= maxAgeMs
}

export const isAttendanceProcessingRecent = (status, maxAgeMs = ATTENDANCE_PROCESSING_STALE_AFTER_MS) => {
  if (!status?.last_attendance_sync_at) return false
  const processedAt = new Date(status.last_attendance_sync_at).getTime()
  return Number.isFinite(processedAt) && Date.now() - processedAt <= maxAgeMs
}
