import { useEffect, useState } from 'react'
import { getAgentControlStatus, runAgentControlAction } from '../../api/agentControlApi'
import { getAttendanceAgentDeviceStatusesRequest, getAttendanceAgentStatusRequest, getMorningVerificationStatusRequest, isAttendanceAgentOnline, isAttendanceProcessingRecent } from '../../api/attendanceAgentApi'
import { useTranslation } from '../../i18n/LanguageContext'
import { attendanceAgentHealth } from '../../utils/attendanceAgentHealth'
import { morningVerificationDiagnostics, morningVerificationReasonKey } from '../../utils/morningVerificationDiagnostics'

const locales = { ar: 'ar-u-nu-latn', en: 'en-GB', fr: 'fr-FR' }

const formatDateTime = (value, language, fallback) => {
  if (!value) return fallback
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime())) return fallback
  return new Intl.DateTimeFormat(locales[language] || locales.en, {
    timeZone: 'Africa/Kinshasa', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(timestamp)
}

function AttendanceAgentStatus() {
  const { language, t } = useTranslation()
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [devices, setDevices] = useState([])
  const [verification, setVerification] = useState(null)
  const [controlStatus, setControlStatus] = useState(null)
  const [controlBusy, setControlBusy] = useState('')
  const [controlMessage, setControlMessage] = useState('')
  const [controlError, setControlError] = useState('')

  const refreshControls = async () => {
    try {
      setControlStatus(await getAgentControlStatus())
      setControlError('')
    } catch {
      // The controller is intentionally local-only; remote deployments only show diagnostics.
      setControlStatus(null)
    }
  }

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
      setError(true)
      setErrorMessage(loadError instanceof Error ? loadError.message : '')
    }
  }

  useEffect(() => {
    load()
    refreshControls()
    const interval = window.setInterval(() => { load(); refreshControls() }, 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const control = async (action) => {
    if (action === 'stop' && !window.confirm(t('agentStatus.control.stopConfirm'))) return
    setControlBusy(action)
    setControlMessage('')
    setControlError('')
    try {
      const result = await runAgentControlAction(action)
      setControlMessage(t('agentStatus.control.success', {
        action: t(`agentStatus.control.actions.${action}`), count: result.process_count,
      }))
      await refreshControls()
      await load()
    } catch (nextError) {
      setControlError(nextError instanceof Error ? nextError.message : t('agentStatus.control.failed'))
    } finally {
      setControlBusy('')
    }
  }

  const online = isAttendanceAgentOnline(status)
  const processingRecent = isAttendanceProcessingRecent(status)
  const verificationDetails = morningVerificationDiagnostics({ verification, devices, status })
  const agentHealth = attendanceAgentHealth({ status, verification })
  const visibleLastError = agentHealth.verificationInProgress && status?.last_error === 'Final morning verification is incomplete.'
    ? null
    : status?.last_error
  const systemState = !status
    ? { label: t('agentStatus.states.notRegistered'), className: 'status-badge--neutral' }
    : ({
      offline: { label: t('agentStatus.states.offline'), className: 'status-badge--warning' },
      stale: { label: t('agentStatus.states.stale'), className: 'status-badge--warning' },
      busy: { label: t('agentStatus.states.busy'), className: 'status-badge--neutral' },
      warning: { label: t('agentStatus.states.warning'), className: 'status-badge--warning' },
      error: { label: t('agentStatus.states.error'), className: 'status-badge--warning' },
      healthy: { label: t('agentStatus.states.healthy'), className: 'status-badge--success' },
    }[agentHealth.state])
  const controlRunning = Boolean(controlStatus?.agent?.running)
  const time = (value) => formatDateTime(value, language, t('agentStatus.notAvailable'))

  return <div className="surface-card mb-5 flex flex-wrap items-center justify-between gap-4 p-4">
    <div>
      <h3 className="font-extrabold">{t('agentStatus.title')}</h3>
      <p className="mt-1 text-sm text-(--muted)">{t('agentStatus.description')}</p>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className={`status-badge ${systemState.className}`}>{systemState.label}</span>
      {status ? <>
        <span className={`status-badge ${status.hikvision_reachable ? 'status-badge--success' : 'status-badge--neutral'}`}>{t('agentStatus.hikvision')}: {status.hikvision_reachable ? t('agentStatus.connected') : t('agentStatus.disconnected')}</span>
        <span className={`status-badge ${status.supabase_reachable ? 'status-badge--success' : 'status-badge--neutral'}`}>{t('agentStatus.supabase')}: {status.supabase_reachable ? t('agentStatus.connected') : t('agentStatus.disconnected')}</span>
      </> : null}
    </div>
    {status ? <div className="w-full grid gap-2 border-t border-slate-100 pt-3 text-xs text-(--muted) sm:grid-cols-2">
      <span>{t('agentStatus.lastAttendanceProcessing')}: <span dir="ltr">{time(status.last_attendance_sync_at)}</span></span>
      <span>{t('agentStatus.lastSystemConnection')}: <span dir="ltr">{time(status.last_seen_at)}</span></span>
      {visibleLastError ? <span className="sm:col-span-2 text-amber-700">{t('agentStatus.lastError')}: {visibleLastError}</span> : null}
    </div> : error ? <p className="w-full text-xs text-amber-700">{t('agentStatus.loadFailed')}{errorMessage ? `: ${errorMessage}` : ''}</p> : null}
    {verification ? <div className="w-full border-t border-slate-100 pt-3 text-xs text-(--muted)">
      <div className="flex flex-wrap justify-between gap-x-5 gap-y-1">
        <span>{t('agentStatus.lastMorningAttempt')}: <span dir="ltr">{time(verificationDetails.latestAttemptAt)}</span></span>
        <span>{t('agentStatus.lastSuccessfulMorningVerification')}: <span dir="ltr">{time(verificationDetails.lastSuccessfulAt)}</span></span>
      </div>
      {agentHealth.verificationInProgress ? <div className={`mt-2 rounded-md border p-2 ${agentHealth.verificationStuck ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-sky-200 bg-sky-50 text-sky-900'}`}>
        <strong>{t('agentStatus.verificationInProgress')}</strong>
        <p className="mt-1">{agentHealth.verificationStuck ? t('agentStatus.verificationStuck') : t('agentStatus.verificationRunningInfo')}</p>
      </div> : verificationDetails.isIncomplete ? <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
        <strong>{t('agentStatus.verificationIncomplete')}</strong>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          {verificationDetails.reasons.map((item, index) => <li key={`${item.code}-${index}`}>{t('agentStatus.reason')}: {t(morningVerificationReasonKey(item), item.params)}</li>)}
        </ul>
      </div> : verificationDetails.isComplete ? <p className="mt-2 text-emerald-700">{t('agentStatus.verificationComplete')}</p> : <p className="mt-2">{t('agentStatus.verificationNotDue')}</p>}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <span>{t('agentStatus.agentHeartbeat')}: {online ? t('agentStatus.healthy') : t('agentStatus.stale')}</span>
        <span>{t('agentStatus.attendanceProcessing')}: {processingRecent ? t('agentStatus.recent') : t('agentStatus.delayed')}</span>
        <span>{t('agentStatus.finalVerificationStep')}: {t(`agentStatus.verificationStates.${verificationDetails.runStatus}`)}</span>
        {verificationDetails.unresolvedWorkers ? <span>{t('agentStatus.unresolvedWorkers', { count: verificationDetails.unresolvedWorkers })}</span> : null}
      </div>
    </div> : null}
    {devices.length ? <div className="w-full border-t border-slate-100 pt-3 text-xs text-(--muted)">{devices.map((device) => <div key={device.device_id} className="flex flex-wrap justify-between gap-2 py-1"><span>{device.device_id}: {device.hikvision_reachable ? t('agentStatus.connected') : t('agentStatus.disconnected')}</span><span>{t('agentStatus.lastDeviceRead')}: <span dir="ltr">{time(device.last_successful_read_at)}</span></span>{device.last_error ? <span className="text-amber-700">{device.last_error}</span> : null}</div>)}</div> : null}
    {controlStatus ? <div className="w-full border-t border-slate-100 pt-3 text-xs text-(--muted)">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-(--text)">{t('agentStatus.control.title')}</strong><p className="mt-1">{t('agentStatus.control.description')}</p></div><span className={`status-badge ${controlRunning ? 'status-badge--success' : 'status-badge--neutral'}`}>{controlRunning ? t('agentStatus.running') : t('agentStatus.stopped')}</span></div>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-primary" disabled={Boolean(controlBusy) || controlRunning} onClick={() => control('start')}>{controlBusy === 'start' ? t('agentStatus.control.working') : t('agentStatus.control.start')}</button><button type="button" className="btn-primary" disabled={Boolean(controlBusy)} onClick={() => control('restart')}>{controlBusy === 'restart' ? t('agentStatus.control.working') : t('agentStatus.control.restart')}</button><button type="button" className="btn-secondary" disabled={Boolean(controlBusy) || !controlRunning} onClick={() => control('stop')}>{controlBusy === 'stop' ? t('agentStatus.control.working') : t('agentStatus.control.stop')}</button></div>
      {controlMessage ? <p className="mt-2 text-emerald-700">{controlMessage}</p> : null}{controlError ? <p className="mt-2 text-amber-700">{t('agentStatus.control.failed')}: {controlError}</p> : null}
    </div> : null}
  </div>
}

export default AttendanceAgentStatus
