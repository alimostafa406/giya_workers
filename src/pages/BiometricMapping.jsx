import { useEffect, useMemo, useState } from 'react'
import { getBiometricMappingWorkspaceRequest, saveBiometricMappingRequest, setBiometricMappingReviewStateRequest, setDeviceIdentityIgnoredRequest, unlinkBiometricMappingRequest } from '../api/biometricMappingApi'
import { normalizePersonName, replaceHikvisionDeviceUsers } from '../data/hikvisionRawData'
import { useTranslation } from '../i18n/LanguageContext'
import TodayPunchesPanel from '../components/Biometric/TodayPunchesPanel'

const isLocalDashboard = typeof window !== 'undefined' && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
const helper = import.meta.env.VITE_LOCAL_HIKVISION_HELPER_URL || (isLocalDashboard ? 'http://127.0.0.1:8765' : '')
const RECENT_IDENTITIES_KEY = 'biometric_recent_device_identities'
const rankWorkerName = (deviceName, workerName) => {
  const device = normalizePersonName(deviceName)
  const worker = normalizePersonName(workerName)
  if (!device || !worker) return 9
  if (device === worker) return 0
  if (worker.startsWith(device) || device.startsWith(worker)) return 1
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
  const [todayActivity, setTodayActivity] = useState(null)
  const [todayLoading, setTodayLoading] = useState(false)
  const [todayActivityError, setTodayActivityError] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => { try { setData((await getBiometricMappingWorkspaceRequest()).data); setError('') } catch { setError(t('common.updateFailed')) } }
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
    .filter((user) => user.isCurrentlyReturned === false ? showOld : (!user.mapping || user.mapping?.mapping_review_state === 'needs_review') && !user.ignored)
    .filter((user) => deviceFilter === 'all' || (user.devices || []).includes(deviceFilter))
    .filter((user) => `${user.name || ''} ${user.employeeNo || ''}`.toLowerCase().includes(deviceQuery.trim().toLowerCase()))
    .sort((a, b) => Number(b.isNewThisSession) - Number(a.isNewThisSession) || String(a.name || '').localeCompare(String(b.name || ''))), [allDeviceUsers, deviceFilter, deviceQuery, showOld])
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
    setSyncing(true)
    try {
      const before = new Set(allDeviceUsers.filter((user) => user.isCurrentlyReturned !== false).map((user) => String(user.employeeNo)))
      const response = await fetch(`${helper}/sync-users`, { method: 'POST' })
      const result = await response.json()
      if (!response.ok || result.status !== 'ok' || !Array.isArray(result.users)) throw new Error('sync failed')
      const syncedAt = new Date().toISOString()
      const detected = Object.fromEntries(result.users.filter((user) => user?._local_sync?.is_currently_returned !== false).map((user) => String(user.employeeNo || user.employeeNoString || '').trim()).filter((employeeNo) => employeeNo && !before.has(employeeNo)).map((employeeNo) => [employeeNo, syncedAt]))
      const nextRecent = { ...recentlyAdded, ...detected }
      sessionStorage.setItem(RECENT_IDENTITIES_KEY, JSON.stringify(nextRecent))
      setRecentlyAdded(nextRecent); setLastSyncAt(syncedAt); replaceHikvisionDeviceUsers(result.users); await Promise.all([load(), loadTodayActivity()]); setMessage(t('biometric.syncSucceeded'))
    } catch { setError(t('common.updateFailed')) } finally { setSyncing(false) }
  }

  return <section>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-extrabold">{t('biometricMapping.title')}</h2><p className="text-sm text-(--muted)">{t('biometricMapping.subtitle')}</p></div><div className="text-end"><button type="button" className="btn-primary" disabled={!helper || syncing} onClick={syncUsers}>{syncing ? t('biometric.syncing') : t('biometric.syncUsers')}</button>{lastSyncAt ? <p className="mt-1 text-xs text-(--muted)">{t('biometric.lastSync')}: {timeLabel(lastSyncAt)}</p> : null}</div></div>
    {error ? <p className="alert alert--error mb-3">{error}</p> : null}{message ? <p className="mb-3 rounded bg-green-50 p-3 text-green-700">{message}</p> : null}
    <TodayPunchesPanel t={t} activity={todayActivity} loading={todayLoading} error={todayActivityError} onRefresh={loadTodayActivity} />
    <section className="surface-card mb-4 border-2 border-blue-200 p-4"><div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr]"><div className={selectedDevice ? 'rounded-xl bg-blue-50 p-3' : 'rounded-xl bg-slate-50 p-3'}><p className="text-sm text-(--muted)">{t('biometric.selectedDeviceIdentity')}</p>{selectedDevice ? <><p className="mt-1 font-extrabold">{selectedDevice.name}</p><p dir="ltr">{selectedDevice.employeeNo}</p><p className="text-xs text-(--muted)">{deviceSource(selectedDevice)} · {deviceStatus(selectedDevice)}</p></> : <p className="mt-1 text-sm text-(--muted)">{t('biometricMapping.selectIdentity')}</p>}</div><p className="self-center text-center text-3xl" dir="ltr">→</p><div className={selectedWorker ? 'rounded-xl bg-blue-50 p-3' : 'rounded-xl bg-slate-50 p-3'}><p className="text-sm text-(--muted)">{t('biometric.selectedWorker')}</p>{selectedWorker ? <><p className="mt-1 font-extrabold">{selectedWorker.full_name}</p><p dir="ltr">{selectedWorker.employee_code || '—'}</p></> : <p className="mt-1 text-sm text-(--muted)">{t('biometric.chooseWorkerFirst')}</p>}</div></div><div className="mt-3 flex flex-wrap gap-2 border-t border-(--border) pt-3"><button type="button" className="btn-secondary" onClick={clearSelections}>{t('biometric.clearSelection')}</button><button type="button" className="btn-primary px-8" disabled={!selectedDevice || !selectedWorker?.id} onClick={link}>{t('biometric.link')}</button></div></section>
    {selectedDevice ? <section className="surface-card mb-4 p-4"><h3 className="font-extrabold">{t('biometric.similarNames')}</h3><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{similarWorkers.map(({ worker }) => <button type="button" key={worker.id} onClick={() => selectWorker(worker)} className={String(selectedWorker?.id) === String(worker.id) ? 'btn-primary text-start' : 'btn-secondary text-start'}><b>{worker.full_name}</b><span className="block text-xs" dir="ltr">{worker.employee_code || '—'}</span><span className="block text-xs">{worker.team?.name || worker.team_name || '—'}</span></button>)}</div>{!similarWorkers.length ? <p className="mt-3 text-sm text-(--muted)">{t('biometricMapping.noSimilarNames')}</p> : null}</section> : null}
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="surface-card overflow-hidden"><div className="border-b border-(--border) p-4"><h3 className="font-extrabold">{t('biometric.deviceUsers')}</h3><div className="mt-3 grid gap-2 sm:grid-cols-2"><input className="input-base" value={deviceQuery} onChange={(event) => setDeviceQuery(event.target.value)} placeholder={t('biometric.searchDevice')} /><select className="input-base" value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}><option value="all">{t('biometric.allDevices')}</option><option value="office-main">{t('biometric.officeMain')}</option><option value="office-secondary">{t('biometric.officeSecondary')}</option></select></div><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={showOld} onChange={(event) => setShowOld(event.target.checked)} />{t('biometric.showOldRecords')}</label></div><div className="max-h-[34rem] divide-y divide-(--border) overflow-y-auto">{deviceUsers.map((user) => <button type="button" key={user.employeeNo} onClick={() => selectDevice(user)} className={selectedDeviceIdentity === user.employeeNo ? 'block w-full bg-blue-100 p-4 text-start ring-2 ring-inset ring-blue-600' : 'block w-full p-4 text-start hover:bg-slate-50'}><div className="flex items-center justify-between gap-2"><b>{user.name}</b><span dir="ltr">{user.employeeNo}</span></div><p className="mt-1 text-xs text-(--muted)">{deviceSource(user)} · {deviceStatus(user)}</p>{user.isNewThisSession ? <span className="mt-2 inline-block rounded bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">{t('biometric.new')}</span> : null}</button>)}{!deviceUsers.length ? <p className="p-5 text-sm text-(--muted)">{t('biometric.empty')}</p> : null}</div></section>
      <section className="surface-card overflow-hidden"><div className="border-b border-(--border) p-4"><h3 className="font-extrabold">{t('biometric.systemWorkers')}</h3><input className="input-base mt-3" value={workerQuery} onChange={(event) => setWorkerQuery(event.target.value)} placeholder={t('biometric.searchWorker')} /></div><div className="max-h-[34rem] divide-y divide-(--border) overflow-y-auto">{workers.map((worker) => <button type="button" key={worker.id} onClick={() => selectWorker(worker)} className={String(selectedWorker?.id) === String(worker.id) ? 'block w-full bg-blue-100 p-4 text-start ring-2 ring-inset ring-blue-600' : 'block w-full p-4 text-start hover:bg-slate-50'}><b>{worker.full_name}</b><p className="mt-1 text-xs text-(--muted)"><span dir="ltr">{worker.employee_code || '—'}</span> · {worker.team?.name || worker.team_name || '—'}</p></button>)}{!workers.length ? <p className="p-5 text-sm text-(--muted)">{t('common.noResults')}</p> : null}</div></section>
    </div>
  </section>
}
