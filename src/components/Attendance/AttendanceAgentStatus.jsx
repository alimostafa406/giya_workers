import { useEffect, useState } from 'react'
import { getAttendanceAgentDeviceStatusesRequest, getAttendanceAgentStatusRequest, getMorningVerificationStatusRequest, isAttendanceAgentOnline, isAttendanceProcessingRecent } from '../../api/attendanceAgentApi'
import { attendanceAgentHealth } from '../../utils/attendanceAgentHealth'
import { morningVerificationDiagnostics } from '../../utils/morningVerificationDiagnostics'

const formatDateTime = (value) => {
  if (!value) return '—'
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime())) return '—'

  const date = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(timestamp)
  const time = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(timestamp)
  return `${date} ${time}`
}

function AttendanceAgentStatus() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [devices, setDevices] = useState([])
  const [verification, setVerification] = useState(null)

  const load = async () => {
    try {
      const [nextStatus, nextVerification] = await Promise.all([
        getAttendanceAgentStatusRequest(),
        getMorningVerificationStatusRequest(),
      ])
      setStatus(nextStatus)
      setVerification(nextVerification)
      setDevices(await getAttendanceAgentDeviceStatusesRequest(nextStatus?.agent_id))
      setError(false)
      setErrorMessage(null)
    } catch (loadError) {
      // The reviewed migration may not have been applied yet; the manual helper
      // controls remain available independently during transition.
      setError(true)
      setErrorMessage(loadError instanceof Error ? loadError.message : 'تعذر قراءة حالة التحقق من قاعدة البيانات أو RPC.')
    }
  }

  useEffect(() => {
    load()
    const interval = window.setInterval(load, 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const online = isAttendanceAgentOnline(status)
  const processingRecent = isAttendanceProcessingRecent(status)
  const verificationDetails = morningVerificationDiagnostics({ verification, devices, status })
  const agentHealth = attendanceAgentHealth({ status, verification })
  const visibleLastError = agentHealth.verificationInProgress && status?.last_error === 'Final morning verification is incomplete.'
    ? null
    : status?.last_error
  const systemState = !status
    ? { label: 'غير مسجل بعد', className: 'status-badge--neutral' }
    : ({
      offline: { label: 'وكيل الحضور غير متصل / يحتاج انتباه', className: 'status-badge--warning' },
      stale: { label: 'الوكيل متصل، لكن معالجة الحضور متأخرة', className: 'status-badge--warning' },
      busy: { label: 'الوكيل متصل — التحقق الصباحي قيد التنفيذ', className: 'status-badge--neutral' },
      warning: { label: 'الوكيل متصل، لكن التحقق الصباحي عالق', className: 'status-badge--warning' },
      error: { label: 'الوكيل متصل، لكن توجد مشكلة تحتاج انتباه', className: 'status-badge--warning' },
      healthy: { label: 'يعمل بشكل طبيعي', className: 'status-badge--success' },
    }[agentHealth.state])

  return <div className="surface-card mb-5 flex flex-wrap items-center justify-between gap-4 p-4">
    <div>
      <h3 className="font-extrabold">حالة نظام الحضور</h3>
      <p className="mt-1 text-sm text-(--muted)">تُفصل آخر معالجة حضور ناجحة عن نبض اتصال الوكيل بالنظام.</p>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className={`status-badge ${systemState.className}`}>{systemState.label}</span>
      {status ? <>
        <span className={`status-badge ${status.hikvision_reachable ? 'status-badge--success' : 'status-badge--neutral'}`}>Hikvision: {status.hikvision_reachable ? 'متصل' : 'غير متصل'}</span>
        <span className={`status-badge ${status.supabase_reachable ? 'status-badge--success' : 'status-badge--neutral'}`}>Supabase: {status.supabase_reachable ? 'متصل' : 'غير متصل'}</span>
      </> : null}
    </div>
      {status ? <div className="w-full grid gap-2 border-t border-slate-100 pt-3 text-xs text-(--muted) sm:grid-cols-2">
      <span>آخر معالجة للحضور: {formatDateTime(status.last_attendance_sync_at)}</span>
      <span>آخر اتصال بالنظام: {formatDateTime(status.last_seen_at)}</span>
      {visibleLastError ? <span className="sm:col-span-2 text-amber-700">آخر خطأ: {visibleLastError}</span> : null}
    </div> : error ? <p className="w-full text-xs text-amber-700">تعذر تحميل حالة التحقق: {errorMessage || 'خطأ في قاعدة البيانات أو RPC.'}</p> : null}
    {verification ? <div className="w-full border-t border-slate-100 pt-3 text-xs text-(--muted)">
      <div className="flex flex-wrap justify-between gap-x-5 gap-y-1">
        <span>آخر محاولة للتحقق الصباحي: <span dir="ltr">{formatDateTime(verificationDetails.latestAttemptAt)}</span></span>
        <span>آخر تحقق صباحي ناجح: <span dir="ltr">{formatDateTime(verificationDetails.lastSuccessfulAt)}</span></span>
      </div>
      {agentHealth.verificationInProgress ? <div className={`mt-2 rounded-md border p-2 ${agentHealth.verificationStuck ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-sky-200 bg-sky-50 text-sky-900'}`}>
        <strong>التحقق الصباحي النهائي قيد التنفيذ.</strong>
        {agentHealth.verificationStuck ? <p className="mt-1">تنبيه: استمرت المحاولة أكثر من 10 دقائق؛ تحقق من قراءة الأجهزة وسجل الوكيل.</p> : <p className="mt-1">هذه حالة معلوماتية؛ يستمر الوكيل في نشر نبض الاتصال أثناء التحقق.</p>}
      </div> : verificationDetails.isIncomplete ? <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
        <strong>تنبيه: التحقق الصباحي النهائي لم يكتمل.</strong>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          {verificationDetails.reasons.map((reason) => <li key={reason}>السبب: {reason}</li>)}
        </ul>
      </div> : verificationDetails.isComplete ? <p className="mt-2 text-emerald-700">حالة التحقق الصباحي النهائي: مكتمل.</p> : <p className="mt-2">حالة التحقق الصباحي النهائي: لم يحن موعده بعد.</p>}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <span>نبض الوكيل: {online ? 'سليم' : 'متأخر'}</span>
        <span>معالجة الحضور: {processingRecent ? 'حديثة' : 'متأخرة'}</span>
        <span>خطوة التحقق النهائي: {verificationDetails.runStatus === 'complete' ? 'مكتملة' : verificationDetails.runStatus === 'running' ? 'قيد التنفيذ' : verificationDetails.runStatus === 'failed' ? 'فشلت' : verificationDetails.runStatus === 'incomplete' ? 'غير مكتملة' : 'لم تبدأ'}</span>
        {verificationDetails.unresolvedWorkers ? <span>عمال بلا تحقق مكتمل: {verificationDetails.unresolvedWorkers}</span> : null}
      </div>
    </div> : null}
    {devices.length ? <div className="w-full border-t border-slate-100 pt-3 text-xs text-(--muted)">{devices.map((device) => <div key={device.device_id} className="flex flex-wrap justify-between gap-2 py-1"><span>{device.device_id}: {device.hikvision_reachable ? 'متصل' : 'غير متصل'}</span><span>آخر قراءة: {formatDateTime(device.last_successful_read_at)}</span>{device.last_error ? <span className="text-amber-700">{device.last_error}</span> : null}</div>)}</div> : null}
  </div>
}

export default AttendanceAgentStatus
