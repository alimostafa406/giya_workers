import { useEffect, useMemo, useRef, useState } from 'react'
import { getBiometricMappingWorkspaceRequest, saveBiometricMappingRequest, setBiometricMappingReviewStateRequest, setDeviceIdentityIgnoredRequest, unlinkBiometricMappingRequest } from '../api/biometricMappingApi'
import { normalizePersonName, replaceHikvisionDeviceUsers } from '../data/hikvisionRawData'
import { useTranslation } from '../i18n/LanguageContext'
import TodayPunchesPanel from '../components/Biometric/TodayPunchesPanel'

const isLocalDashboard = typeof window !== 'undefined' && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
const helper = import.meta.env.VITE_LOCAL_HIKVISION_HELPER_URL || (isLocalDashboard ? 'http://127.0.0.1:8765' : '')
const HELPER_LIGHTWEIGHT_TIMEOUT_MS = 5000
const RECENT_IDENTITIES_KEY = 'biometric_recent_device_identities'
const editDistance = (left, right) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0]
    previous[0] = row
    for (let column = 1; column <= right.length; column += 1) {
      const saved = previous[column]
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + (left[row - 1] === right[column - 1] ? 0 : 1))
      diagonal = saved
    }
  }
  return previous[right.length]
}
const rankWorkerName = (deviceName, workerName) => {
  const device = normalizePersonName(deviceName)
  const worker = normalizePersonName(workerName)
  if (!device || !worker) return 9
  if (device === worker) return 0
  if (worker.startsWith(device) || device.startsWith(worker)) return 1
  if (Math.min(device.length, worker.length) >= 4 && editDistance(device, worker) <= Math.max(1, Math.floor(Math.max(device.length, worker.length) * .2))) return 2
  const deviceTokens = device.split(' ')
  const workerTokens = worker.split(' ')
  if (deviceTokens.some((token) => workerTokens.some((candidate) => token.startsWith(candidate) || candidate.startsWith(token)))) return 2
  if (device.includes(worker) || worker.includes(device)) return 3
  return 9
}
const readRecent = () => { try { const stored = JSON.parse(sessionStorage.getItem(RECENT_IDENTITIES_KEY) || '{}'); return stored && typeof stored === 'object' ? stored : {} } catch { return {} } }
const timeLabel = (value) => value ? new Date(value).toLocaleString() : '—'

export default function BiometricMapping() {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [deviceQuery, setDeviceQuery] = useState('')
  const [workerQuery, setWorkerQuery] = useState('')
  const [deviceFilter, setDeviceFilter] = useState('all')
  const [showOld, setShowOld] = useState(false)
  const [selectedDeviceIdentity, setSelectedDeviceIdentity] = useState(null)
  const [selectedWorker, setSelectedWorker] = useState(null)
  const [recentlyAdded, setRecentlyAdded] = useState(readRecent)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [syncing, setSyncing] = useState(false)
  const syncBeforeRef = useRef(new Set())
  const [todayActivity, setTodayActivity] = useState(null)
  const [todayLoading, setTodayLoading] = useState(false)
  const [todayActivityError, setTodayActivityError] = useState(false)
  const [inventoryRefreshError, setInventoryRefreshError] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const workspace = (await getBiometricMappingWorkspaceRequest()).data
      setData(workspace)
      setInventoryRefreshError(Boolean(workspace.identityPresenceError))
      return !workspace.identityPresenceError
    } catch {
      setInventoryRefreshError(true)
      return false
    }
  }
  const loadTodayActivity = async () => {
    if (!helper) return
    setTodayLoading(true)
    setTodayActivityError(false)
    try {
      const response = await fetch(`${helper}/today-events`)
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.status !== 'ok' || !Array.isArray(result.identities)) throw new Error('today_events_unavailable')
      setTodayActivity(result)
    } catch {
      setTodayActivity(null)
      setTodayActivityError(true)
    } finally {
      setTodayLoading(false)
    }
  }
  useEffect(() => { load(); loadTodayActivity() }, [])

  const allDeviceUsers = useMemo(() => (data?.deviceUsers || []).map((user) => ({ ...user, isNewThisSession: Boolean(recentlyAdded[user.employeeNo]) })), [data, recentlyAdded])
  // A worker can have only one active biometric identity. Keep this eligibility
  // rule aligned with saveBiometricMappingRequest, which rejects a second active
  // mapping even when a user reaches the API outside this screen.
  const activeMappedWorkerIds = useMemo(() => new Set(
    (data?.mappings || [])
      .filter((mapping) => mapping?.is_active !== false && mapping?.worker_id)
      .map((mapping) => String(mapping.worker_id)),
  ), [data])
  const availableWorkers = useMemo(() => (data?.workers || [])
    .filter((worker) => worker.is_active !== false)
    .filter((worker) => !activeMappedWorkerIds.has(String(worker.id))), [activeMappedWorkerIds, data])
  const deviceUsers = useMemo(() => allDeviceUsers
    .filter((user) => user.isCurrentlyReturned !== false)
    .filter((user) => user.mapping?.is_active === false || user.mapping?.mapping_review_state !== 'confirmed')
    .filter((user) => !user.ignored)
    .filter((user) => showOld || (user.firstSeenAt && new Date(user.firstSeenAt).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000))
    .filter((user) => deviceFilter === 'all' || (user.devices || []).includes(deviceFilter))
    .filter((user) => `${user.name || ''} ${user.employeeNo || ''}`.toLowerCase().includes(deviceQuery.trim().toLowerCase()))
    .sort((a, b) => new Date(b.firstSeenAt || 0) - new Date(a.firstSeenAt || 0) || String(a.name || '').localeCompare(String(b.name || ''))), [allDeviceUsers, deviceFilter, deviceQuery, showOld])
  const workers = useMemo(() => availableWorkers
    .filter((worker) => `${worker.full_name || ''} ${worker.employee_code || ''}`.toLowerCase().includes(workerQuery.trim().toLowerCase()))
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''))), [availableWorkers, workerQuery])
  const selectedDevice = allDeviceUsers.find((user) => user.employeeNo === selectedDeviceIdentity) || null
  const similarWorkers = useMemo(() => {
    if (!selectedDevice) return []
    return availableWorkers
      .map((worker) => ({ worker, score: rankWorkerName(selectedDevice.name, worker.full_name) }))
      .filter((candidate) => candidate.score < 9)
      .sort((left, right) => left.score - right.score || String(left.worker.full_name || '').localeCompare(String(right.worker.full_name || '')))
      .slice(0, 10)
  }, [availableWorkers, selectedDevice])
  const deviceSource = (user) => (user?.devices || []).map((device) => device === 'office-main' ? t('biometric.officeMain') : device === 'office-secondary' ? t('biometric.officeSecondary') : device).join(' / ') || '—'
  const deviceStatus = (user) => user?.mapping?.mapping_review_state === 'confirmed' ? t('biometric.linked') : user?.mapping?.mapping_review_state === 'needs_review' ? t('biometric.needsConfirmation') : t('biometric.unlinked')
  const clearSelections = () => { setSelectedDeviceIdentity(null); setSelectedWorker(null) }
  const selectDevice = (user) => { setSelectedDeviceIdentity(user.employeeNo); setSelectedWorker(null); setMessage('') }
  const selectWorker = (worker) => { setSelectedWorker(worker); setMessage('') }
  const link = async () => {
    if (!selectedDevice || !selectedWorker?.id) return
    try {
      await saveBiometricMappingRequest({ deviceUser: selectedDevice, workerId: selectedWorker.id, reviewState: selectedDevice.sourceMatchCategory === 'unique_exact' ? 'confirmed' : 'needs_review' })
      await load()
      setMessage(t('biometric.mappingSaved'))
      clearSelections()
    } catch { setError(t('common.updateFailed')) }
  }
  const syncUsers = async () => {
    if (!helper) return
    setError('')
    setMessage('')
    syncBeforeRef.current = new Set(allDeviceUsers.filter((user) => user.isCurrentlyReturned !== false).map((user) => String(user.employeeNo)))
    try {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), HELPER_LIGHTWEIGHT_TIMEOUT_MS)
      const response = await fetch(`${helper}/sync-users/start`, { method: 'POST', signal: controller.signal })
      window.clearTimeout(timeout)
      const result = await response.json().catch(() => null)
      if (!response.ok || !['running', 'success'].includes(result?.status)) throw new Error('sync_start_failed')
      setSyncing(true)
    } catch { setError(t('biometric.syncFailed')) }
  }

  useEffect(() => {
    if (!syncing || !helper) return undefined
    let cancelled = false
    let timer = null
    const poll = async () => {
      try {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), HELPER_LIGHTWEIGHT_TIMEOUT_MS)
        const response = await fetch(`${helper}/sync-users/status`, { signal: controller.signal })
        window.clearTimeout(timeout)
        const job = await response.json().catch(() => null)
        if (!response.ok || !job?.status) throw new Error('sync_status_failed')
        if (job.status === 'running') { timer = window.setTimeout(poll, 1500); return }
        setSyncing(false)
        if (job.status !== 'success' || !Array.isArray(job.result?.users)) { setError(t('biometric.syncFailed')); return }
        const syncedAt = job.finished_at || new Date().toISOString()
        const detected = Object.fromEntries(job.result.users.filter((user) => user?._local_sync?.is_currently_returned !== false).map((user) => String(user.employeeNo || user.employeeNoString || '').trim()).filter((employeeNo) => employeeNo && !syncBeforeRef.current.has(employeeNo)).map((employeeNo) => [employeeNo, syncedAt]))
        const nextRecent = { ...recentlyAdded, ...detected }
        sessionStorage.setItem(RECENT_IDENTITIES_KEY, JSON.stringify(nextRecent))
        setRecentlyAdded(nextRecent); setLastSyncAt(syncedAt); replaceHikvisionDeviceUsers(job.result.users)
        await load()
        if (!cancelled) setMessage(t('biometric.syncSucceeded'))
        void loadTodayActivity()
      } catch {
        if (!cancelled) { setSyncing(false); setError(t('biometric.syncFailed')) }
      }
    }
    poll()
    return () => { cancelled = true; if (timer) window.clearTimeout(timer) }
  }, [syncing])

  return <section>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-extrabold">{t('biometricMapping.title')}</h2><p className="text-sm text-(--muted)">{t('biometricMapping.subtitle')}</p></div><div className="text-end"><button type="button" className="btn-primary" disabled={!helper || syncing} onClick={syncUsers}>{syncing ? t('biometric.syncing') : t('biometric.syncUsers')}</button>{lastSyncAt ? <p className="mt-1 text-xs text-(--muted)">{t('biometric.lastSync')}: {timeLabel(lastSyncAt)}</p> : null}</div></div>
    {error ? <p className="alert alert--error mb-3">{error}</p> : null}{message ? <p className="mb-3 rounded bg-green-50 p-3 text-green-700">{message}</p> : null}{inventoryRefreshError ? <p className="alert alert--error mb-3">{t('biometric.inventoryRefreshFailed')}</p> : null}
    <TodayPunchesPanel t={t} activity={todayActivity} loading={todayLoading} error={todayActivityError} onRefresh={loadTodayActivity} />
    <section className="surface-card mb-4 border-2 border-blue-200 p-4"><div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr]"><div className={selectedDevice ? 'rounded-xl bg-blue-50 p-3' : 'rounded-xl bg-slate-50 p-3'}><p className="text-sm text-(--muted)">{t('biometric.selectedDeviceIdentity')}</p>{selectedDevice ? <><p className="mt-1 font-extrabold">{selectedDevice.name}</p><p dir="ltr">{selectedDevice.employeeNo}</p><p className="text-xs text-(--muted)">{deviceSource(selectedDevice)} · {deviceStatus(selectedDevice)}</p></> : <p className="mt-1 text-sm text-(--muted)">{t('biometricMapping.selectIdentity')}</p>}</div><p className="self-center text-center text-3xl" dir="ltr">→</p><div className={selectedWorker ? 'rounded-xl bg-blue-50 p-3' : 'rounded-xl bg-slate-50 p-3'}><p className="text-sm text-(--muted)">{t('biometric.selectedWorker')}</p>{selectedWorker ? <><p className="mt-1 font-extrabold">{selectedWorker.full_name}</p><p dir="ltr">{selectedWorker.employee_code || '—'}</p></> : <p className="mt-1 text-sm text-(--muted)">{t('biometric.chooseWorkerFirst')}</p>}</div></div><div className="mt-3 flex flex-wrap gap-2 border-t border-(--border) pt-3"><button type="button" className="btn-secondary" onClick={clearSelections}>{t('biometric.clearSelection')}</button><button type="button" className="btn-primary px-8" disabled={!selectedDevice || !selectedWorker?.id} onClick={link}>{t('biometric.link')}</button></div></section>
    {selectedDevice ? <section className="surface-card mb-4 p-4"><h3 className="font-extrabold">{t('biometric.similarNames')}</h3><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{similarWorkers.map(({ worker }) => <button type="button" key={worker.id} onClick={() => selectWorker(worker)} className={String(selectedWorker?.id) === String(worker.id) ? 'btn-primary text-start' : 'btn-secondary text-start'}><b>{worker.full_name}</b><span className="block text-xs" dir="ltr">{worker.employee_code || '—'}</span><span className="block text-xs">{worker.team?.name || worker.team_name || '—'}</span></button>)}</div>{!similarWorkers.length ? <p className="mt-3 text-sm text-(--muted)">{t('biometricMapping.noSimilarNames')}</p> : null}</section> : null}
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="surface-card overflow-hidden"><div className="border-b border-(--border) p-4"><div className="flex items-center justify-between gap-2"><h3 className="font-extrabold">{showOld ? t('biometric.allUnmapped') : t('biometric.newUnmapped')}</h3><button type="button" className="btn-secondary" onClick={() => setShowOld((value) => !value)}>{showOld ? t('biometric.showRecentUnmapped') : t('biometric.showAllUnmapped')}</button></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><input className="input-base" value={deviceQuery} onChange={(event) => setDeviceQuery(event.target.value)} placeholder={t('biometric.searchDevice')} /><select className="input-base" value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}><option value="all">{t('biometric.allDevices')}</option><option value="office-main">{t('biometric.officeMain')}</option><option value="office-secondary">{t('biometric.officeSecondary')}</option></select></div></div><div className="max-h-[34rem] divide-y divide-(--border) overflow-y-auto">{deviceUsers.map((user) => <button type="button" key={user.employeeNo} onClick={() => selectDevice(user)} className={selectedDeviceIdentity === user.employeeNo ? 'block w-full bg-blue-100 p-4 text-start ring-2 ring-inset ring-blue-600' : 'block w-full p-4 text-start hover:bg-slate-50'}><div className="flex items-center justify-between gap-2"><b>{user.name}</b><span dir="ltr">{user.employeeNo}</span></div><p className="mt-1 text-xs text-(--muted)">{deviceSource(user)} · {t('biometric.firstSeen')}: {timeLabel(user.firstSeenAt)}</p></button>)}{!deviceUsers.length ? <p className="p-5 text-sm text-(--muted)">{t('biometric.empty')}</p> : null}</div></section>
      <section className="surface-card overflow-hidden"><div className="border-b border-(--border) p-4"><h3 className="font-extrabold">{t('biometric.systemWorkers')}</h3><input className="input-base mt-3" value={workerQuery} onChange={(event) => setWorkerQuery(event.target.value)} placeholder={t('biometric.searchWorker')} /></div><div className="max-h-[34rem] divide-y divide-(--border) overflow-y-auto">{workers.map((worker) => <button type="button" key={worker.id} onClick={() => selectWorker(worker)} className={String(selectedWorker?.id) === String(worker.id) ? 'block w-full bg-blue-100 p-4 text-start ring-2 ring-inset ring-blue-600' : 'block w-full p-4 text-start hover:bg-slate-50'}><b>{worker.full_name}</b><p className="mt-1 text-xs text-(--muted)"><span dir="ltr">{worker.employee_code || '—'}</span> · {worker.team?.name || worker.team_name || '—'}</p></button>)}{!workers.length ? <p className="p-5 text-sm text-(--muted)">{t('common.noResults')}</p> : null}</div></section>
    </div>
  </section>
}
