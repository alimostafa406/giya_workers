import { getSupabaseClient } from '../lib/supabase'

const isLocalDashboard = typeof window !== 'undefined'
  && ['localhost', '127.0.0.1'].includes(window.location.hostname)
const helper = import.meta.env.VITE_LOCAL_HIKVISION_HELPER_URL
  || (isLocalDashboard ? 'http://127.0.0.1:8765' : '')

export const recoverWorkerWeekAttendanceRequest = async ({ workerId, weekStartDate }) => {
  if (!helper) throw new Error('Open this action from the office dashboard connected to the local Hikvision helper.')
  const { data: { session } } = await getSupabaseClient().auth.getSession()
  if (!session?.access_token) throw new Error('Administrator authentication is required.')
  const response = await fetch(`${helper}/attendance/recover-worker-week`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ worker_id: workerId, week_start_date: weekStartDate, confirm: true }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Worker week attendance recovery failed.')
  return data
}
