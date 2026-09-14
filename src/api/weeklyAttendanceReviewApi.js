const isLocalDashboard = typeof window !== 'undefined'
  && ['localhost', '127.0.0.1'].includes(window.location.hostname)
const helper = import.meta.env.VITE_LOCAL_HIKVISION_HELPER_URL
  || (isLocalDashboard ? 'http://127.0.0.1:8765' : '')

export const reviewWeeklyAttendanceRequest = async ({ dateFrom, dateTo }) => {
  if (!helper) throw new Error('Open this action from the office dashboard connected to the local Hikvision helper.')
  const response = await fetch(`${helper}/attendance/review-week`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ date_from: dateFrom, date_to: dateTo, confirm: true }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || data.error || 'Weekly biometric review failed.')
  }
  return data
}
