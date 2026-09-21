// The Agent processes attendance every five minutes. Two intervals plus a
// one-minute tolerance distinguish a healthy processing timestamp from delay.
export const ATTENDANCE_PROCESSING_STALE_AFTER_MS = (2 * 300 + 60) * 1000
export const ATTENDANCE_AGENT_OFFLINE_AFTER_MS = 3 * 60 * 1000
// A normal scan is bounded by a 120-second device lock and 25-second HTTP
// requests. Two five-minute verification intervals is long enough to flag a
// crashed/stalled attempt without treating ordinary device work as a failure.
export const FINAL_MORNING_VERIFICATION_STUCK_AFTER_MS = 10 * 60 * 1000

export const isAttendanceAgentOnline = (status, maxAgeMs = ATTENDANCE_AGENT_OFFLINE_AFTER_MS, now = Date.now()) => {
  if (!status?.last_seen_at) return false
  const heartbeat = new Date(status.last_seen_at).getTime()
  return Number.isFinite(heartbeat) && now - heartbeat <= maxAgeMs
}

export const isAttendanceProcessingRecent = (status, maxAgeMs = ATTENDANCE_PROCESSING_STALE_AFTER_MS, now = Date.now()) => {
  if (!status?.last_attendance_sync_at) return false
  const processedAt = new Date(status.last_attendance_sync_at).getTime()
  return Number.isFinite(processedAt) && now - processedAt <= maxAgeMs
}

export const isMorningVerificationStuck = (attempt, maxAgeMs = FINAL_MORNING_VERIFICATION_STUCK_AFTER_MS, now = Date.now()) => {
  if (attempt?.status !== 'running') return false
  const startedAt = new Date(attempt.started_at || attempt.created_at || '').getTime()
  return Number.isFinite(startedAt) && now - startedAt > maxAgeMs
}

export const attendanceAgentHealth = ({ status, verification, now = Date.now() }) => {
  const online = isAttendanceAgentOnline(status, ATTENDANCE_AGENT_OFFLINE_AFTER_MS, now)
  const processingRecent = isAttendanceProcessingRecent(status, ATTENDANCE_PROCESSING_STALE_AFTER_MS, now)
  const attempt = verification?.latestAttempt || null
  const verificationInProgress = attempt?.status === 'running'
  const verificationStuck = isMorningVerificationStuck(attempt, FINAL_MORNING_VERIFICATION_STUCK_AFTER_MS, now)

  if (!online) return { state: 'offline', online, processingRecent, verificationInProgress, verificationStuck }
  if (verificationStuck) return { state: 'warning', online, processingRecent, verificationInProgress, verificationStuck }
  if (verificationInProgress) return { state: 'busy', online, processingRecent, verificationInProgress, verificationStuck }
  if (attempt && ['failed', 'incomplete'].includes(attempt.status)) return { state: 'error', online, processingRecent, verificationInProgress, verificationStuck }
  if (status?.last_error) return { state: 'error', online, processingRecent, verificationInProgress, verificationStuck }
  if (!processingRecent) return { state: 'stale', online, processingRecent, verificationInProgress, verificationStuck }
  return { state: 'healthy', online, processingRecent, verificationInProgress, verificationStuck }
}
