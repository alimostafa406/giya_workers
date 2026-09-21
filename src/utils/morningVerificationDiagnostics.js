import { kinshasaClock } from './attendanceOperationalGate.js'

export const FINAL_MORNING_VERIFICATION_START_MINUTES = (9 * 60) + 15

const asArray = (value) => Array.isArray(value) ? value : []
const nonNegativeNumber = (value) => Math.max(0, Number(value) || 0)
const reason = (code, params = {}) => ({ code, params })

export const morningVerificationReasonKey = ({ code } = {}) => `agentStatus.reasons.${code || 'unknown'}`

const queryFailureReasons = (failures) => failures.flatMap((failure) => {
  if (failure?.reason !== 'device_query_incomplete') return []
  const incompleteQueries = asArray(failure.queries).filter((query) => query?.state !== 'complete')
  if (!incompleteQueries.length) return [reason('device_read_failed')]
  return incompleteQueries.map((query) => reason('device_read_failed', {
    deviceId: query?.device_id ? ` (${query.device_id})` : '',
    error: query?.error ? `: ${query.error}` : '',
  }))
})

const reasonSummary = (run) => {
  const summary = run?.device_failure_summary || {}
  const failures = asArray(summary.failures)
  const reasons = [
    ...queryFailureReasons(failures),
    ...failures.filter((failure) => failure?.reason === 'no_safe_confirmed_mapping').map(() => reason('no_safe_confirmed_mapping')),
    ...failures.filter((failure) => failure?.reason === 'attendance_apply_failed').map(() => reason('attendance_apply_failed')),
    ...failures.filter((failure) => failure?.reason === 'unknown_biometric_participation').map(() => reason('unknown_biometric_participation')),
    ...failures.filter((failure) => failure?.reason === 'verification_state_changed').map(() => reason('verification_state_changed')),
    ...failures.filter((failure) => failure?.reason === 'malformed_child_row').map(() => reason('malformed_child_row')),
  ]

  if (summary.error) reasons.push(reason('verification_error', { error: String(summary.error) }))
  const unresolved = nonNegativeNumber(run?.unresolved_worker_count)
  if (!reasons.length && unresolved) reasons.push(reason('unresolved_workers', { count: unresolved }))
  if (!reasons.length && run?.status === 'incomplete') reasons.push(reason('verification_incomplete'))
  return reasons.filter((item, index, values) => values.findIndex((candidate) => candidate.code === item.code && JSON.stringify(candidate.params) === JSON.stringify(item.params)) === index)
}

export const morningVerificationDiagnostics = ({ verification, devices = [], status, now = new Date() }) => {
  const clock = kinshasaClock(now)
  const afterScheduledStart = ((clock.hour * 60) + clock.minute) >= FINAL_MORNING_VERIFICATION_START_MINUTES
  const latestAttempt = verification?.latestAttempt || null
  const lastSuccessfulAttempt = verification?.lastSuccessfulAttempt || null
  const runStatus = latestAttempt?.status || 'not_started'
  const isComplete = runStatus === 'complete'
  const isInProgress = runStatus === 'running'
  const reasons = isComplete
    ? []
    : latestAttempt
      ? reasonSummary(latestAttempt)
      : afterScheduledStart
        ? [reason('verification_not_run')]
        : [reason('verification_not_due')]

  if (!isComplete && isInProgress) reasons.unshift(reason('verification_running'))
  if (!isComplete && latestAttempt?.status === 'failed' && !reasons.length) reasons.push(reason('verification_failed'))
  if (!isComplete && latestAttempt?.status === 'pending' && !reasons.length) reasons.push(reason('verification_pending'))

  const deviceSteps = devices.map((device) => ({
    id: device.device_id,
    complete: Boolean(device.hikvision_reachable && device.last_successful_read_at),
    lastSuccessfulReadAt: device.last_successful_read_at || null,
    error: device.last_error || null,
  }))

  return {
    isIncomplete: !isComplete && !isInProgress && (Boolean(latestAttempt) || afterScheduledStart),
    isInProgress,
    isComplete,
    isAwaitingSchedule: !latestAttempt && !afterScheduledStart,
    runStatus,
    reasons,
    latestAttemptAt: latestAttempt?.started_at || latestAttempt?.created_at || null,
    lastSuccessfulAt: lastSuccessfulAttempt?.completed_at || lastSuccessfulAttempt?.updated_at || null,
    unresolvedWorkers: nonNegativeNumber(latestAttempt?.unresolved_worker_count),
    deviceSteps,
    steps: {
      agentOnline: Boolean(status?.last_seen_at),
      attendanceProcessingRecent: Boolean(status?.last_attendance_sync_at),
      finalVerification: isComplete ? 'complete' : runStatus,
    },
  }
}
