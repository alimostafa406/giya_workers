import { kinshasaClock } from './attendanceOperationalGate.js'

export const FINAL_MORNING_VERIFICATION_START_MINUTES = (9 * 60) + 15

const asArray = (value) => Array.isArray(value) ? value : []
const nonNegativeNumber = (value) => Math.max(0, Number(value) || 0)

const queryFailureReasons = (failures) => failures.flatMap((failure) => {
  if (failure?.reason !== 'device_query_incomplete') return []
  const incompleteQueries = asArray(failure.queries).filter((query) => query?.state !== 'complete')
  if (!incompleteQueries.length) return ['تعذر إكمال قراءة جهاز واحد أو أكثر.']
  return incompleteQueries.map((query) => {
    const suffix = query?.error ? `: ${query.error}` : ''
    return `لم تكتمل قراءة الجهاز ${query?.device_id || 'غير المعروف'}${suffix}`
  })
})

const reasonSummary = (run) => {
  const summary = run?.device_failure_summary || {}
  const failures = asArray(summary.failures)
  const reasons = [
    ...queryFailureReasons(failures),
    ...failures.filter((failure) => failure?.reason === 'no_safe_confirmed_mapping').map(() => 'يوجد عامل بلا ربط بصمة مؤكد وآمن.'),
    ...failures.filter((failure) => failure?.reason === 'attendance_apply_failed').map(() => 'تعذر تطبيق دليل البصمة على سجل الحضور.'),
    ...failures.filter((failure) => failure?.reason === 'unknown_biometric_participation').map(() => 'توجد بصمات أو مشاركة بيومترية غير مرتبطة بعامل معروف.'),
    ...failures.filter((failure) => failure?.reason === 'verification_state_changed').map(() => 'تغيرت حالة الحضور أو قائمة العمال أثناء التحقق؛ يلزم تشغيل محاولة جديدة.'),
    ...failures.filter((failure) => failure?.reason === 'malformed_child_row').map(() => 'بيانات دليل التحقق غير مكتملة أو غير صالحة.'),
  ]

  if (summary.error) reasons.push(`حدث خطأ أثناء التحقق: ${summary.error}`)
  const unresolved = nonNegativeNumber(run?.unresolved_worker_count)
  if (!reasons.length && unresolved) reasons.push(`تبقى ${unresolved} عامل/عمال دون تحقق نهائي مكتمل.`)
  if (!reasons.length && run?.status === 'incomplete') reasons.push('أكمل الوكيل المحاولة بحالة غير مكتملة، لكن السجل لا يحتوي سببًا أكثر تفصيلًا.')
  return [...new Set(reasons)]
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
        ? ['لم تُنفذ خطوة التحقق الصباحي النهائي بعد اليوم.']
        : ['لم يحن موعد التحقق الصباحي النهائي بعد.']

  if (!isComplete && isInProgress) reasons.unshift('التحقق الصباحي النهائي قيد التنفيذ.')
  if (!isComplete && latestAttempt?.status === 'failed' && !reasons.length) reasons.push('فشلت خطوة التحقق الصباحي النهائي.')
  if (!isComplete && latestAttempt?.status === 'pending' && !reasons.length) reasons.push('خطوة التحقق الصباحي النهائي لم تبدأ بعد.')

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
