import { useEffect, useMemo, useState } from 'react'
import { createWorkerAndConfirmBiometricMappingRequest, getBiometricMappingWorkspaceRequest, getRecentUnmappedBiometricIdentitiesRequest, saveBiometricMappingRequest, setBiometricMappingReviewStateRequest, setDeviceIdentityIgnoredRequest, unlinkBiometricMappingRequest } from '../api/biometricMappingApi'
import { normalizePersonName, replaceHikvisionDeviceUsers } from '../data/hikvisionRawData'
import { useTranslation } from '../i18n/LanguageContext'
import CreateWorkerFromDeviceModal from '../components/Biometric/CreateWorkerFromDeviceModal'
import { completeCriticalBiometricMappingSave, completeCriticalBiometricWorkerCreation } from '../utils/biometricMappingSaveFlow'
import { getNextNumericEmployeeCode, isDuplicateEmployeeCodeError } from '../utils/employeeCodeSuggestion'
import { buildRecentIdentityUsers, recentUnmappedIdentityUsers } from '../utils/recentUnmappedIdentities'

const isLocalDashboard = typeof window !== 'undefined' && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
const helper = import.meta.env.VITE_LOCAL_HIKVISION_HELPER_URL || (isLocalDashboard ? 'http://127.0.0.1:8765' : '')
const HELPER_LIGHTWEIGHT_TIMEOUT_MS = 5000
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
const timeLabel = (value) => value ? new Date(value).toLocaleString() : '—'

export default function BiometricMapping() {
  const { t, language } = useTranslation()
  const [data, setData] = useState(null)
  const [deviceQuery, setDeviceQuery] = useState('')
  const [workerQuery, setWorkerQuery] = useState('')
  const [deviceFilter, setDeviceFilter] = useState('all')
  const [selectedDeviceIdentity, setSelectedDeviceIdentity] = useState(null)
  const [selectedWorker, setSelectedWorker] = useState(null)
  const [lastSyncAt, setLastSyncAt] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncTarget, setSyncTarget] = useState('all')
  const [recentActivity, setRecentActivity] = useState(null)
  const [recentActivityLoading, setRecentActivityLoading] = useState(false)
  const [recentActivityError, setRecentActivityError] = useState(false)
  const [inventoryRefreshError, setInventoryRefreshError] = useState(false)
  const [createWorkerOpen, setCreateWorkerOpen] = useState(false)
  const [creatingWorker, setCreatingWorker] = useState(false)
  const [linkingWorker, setLinkingWorker] = useState(false)
  const [suggestedEmployeeCode, setSuggestedEmployeeCode] = useState('')
  const [committedEmployeeCodes, setCommittedEmployeeCodes] = useState([])
  const [optimisticallyMappedEmployeeNos, setOptimisticallyMappedEmployeeNos] = useState(() => new Set())
  const [postSaveWarning, setPostSaveWarning] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const workspace = (await getBiometricMappingWorkspaceRequest()).data
      setData(workspace)
      setInventoryRefreshError(Boolean(workspace.identityPresenceError))
      return true
    } catch {
      setInventoryRefreshError(true)
      return false
    }
  }
  const loadRecentActivity = async () => {
    setRecentActivityLoading(true)
    setRecentActivityError(false)
    try {
      const result = await getRecentUnmappedBiometricIdentitiesRequest({ days: 7 })
      if (result.unavailable) {
        setRecentActivity(null)
        setRecentActivityError(true)
        return false
      }
      const end = new Date(`${result.endDate}T12:00:00Z`)
      end.setUTCDate(end.getUTCDate() - (result.days - 1))
      setRecentActivity({
        start_date: end.toISOString().slice(0, 10),
        end_date: result.endDate,
        identities: result.data.map((identity) => ({
          employeeNo: identity.device_employee_no,
          deviceId: identity.devices_seen?.[0] || '',
          name: identity.device_name,
          latest_event_at: identity.latest_event_at,
          recent_event_count: identity.recent_event_count,
          devices_seen: identity.devices_seen,
        })),
      })
      return true
    } catch {
      setRecentActivity(null)
      setRecentActivityError(true)
      return false
    } finally {
      setRecentActivityLoading(false)
    }
  }
  useEffect(() => { load(); loadRecentActivity() }, [])

  const recentActivityUsers = useMemo(() => buildRecentIdentityUsers({
    activityIdentities: recentActivity?.identities,
    inventoryUsers: data?.deviceUsers,
    mappings: data?.mappings,
    workers: data?.workers,
    ignoredIdentities: data?.ignoredIdentities,
  }), [data, recentActivity])
  const availableWorkers = useMemo(() => (data?.workers || [])
    .filter((worker) => worker.is_active !== false), [data])
  const recentUnmappedUsers = useMemo(() => (data
    ? recentUnmappedIdentityUsers(recentActivityUsers)
      .filter((user) => !optimisticallyMappedEmployeeNos.has(user.identityKey))
    : []), [data, optimisticallyMappedEmployeeNos, recentActivityUsers])
  const deviceUsers = useMemo(() => recentUnmappedUsers
    .filter((user) => deviceFilter === 'all' || (user.devices || []).includes(deviceFilter))
    .filter((user) => `${user.name || ''} ${user.employeeNo || ''}`.toLowerCase().includes(deviceQuery.trim().toLowerCase())), [deviceFilter, deviceQuery, recentUnmappedUsers])
  const workers = useMemo(() => availableWorkers
    .filter((worker) => `${worker.full_name || ''} ${worker.employee_code || ''}`.toLowerCase().includes(workerQuery.trim().toLowerCase()))
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''))), [availableWorkers, workerQuery])
  const selectedDevice = recentActivityUsers.find((user) => user.identityKey === selectedDeviceIdentity) || null
  const selectedWorkerMappings = (data?.mappings || []).filter((mapping) => (
    mapping?.is_active === true && String(mapping.worker_id) === String(selectedWorker?.id || '')
  ))
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
  const selectDevice = (user) => { setSelectedDeviceIdentity(user.identityKey); setSelectedWorker(null); setMessage('') }
  const selectWorker = (worker) => { setSelectedWorker(worker); setMessage('') }
  const openCreateWorker = () => {
    setError('')
    let nextCode = ''
    try {
      if (Array.isArray(data?.workers)) {
        nextCode = getNextNumericEmployeeCode([
          ...data.workers,
          ...committedEmployeeCodes.map((employee_code) => ({ employee_code })),
        ])
      }
    } catch {
      // A suggestion is optional. Keep the field editable when calculation fails.
    }
    setSuggestedEmployeeCode(nextCode)
    setCreateWorkerOpen(true)
  }
  const refreshTodayAttendanceAfterMapping = async () => {
    if (!helper || !recentActivity?.end_date) return false
    try {
      const response = await fetch(`${helper}/attendance/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: recentActivity.end_date, confirm: true }),
      })
      return response.ok
    } catch {
      return false
    }
  }
  const link = async () => {
    if (!selectedDevice || selectedDevice.hasActiveMapping || !selectedWorker?.id || linkingWorker) return
    const deviceUser = selectedDevice
    const workerId = selectedWorker.id
    setLinkingWorker(true)
    setError('')
    setPostSaveWarning('')
    try {
      // Selecting a specific existing worker and pressing Link is the admin's
      // explicit confirmation of this additional device identity.
      await completeCriticalBiometricMappingSave({
        saveMapping: () => saveBiometricMappingRequest({ deviceUser, workerId, reviewState: 'confirmed' }),
        onMapped: () => {
          setOptimisticallyMappedEmployeeNos((previous) => new Set(previous).add(deviceUser.identityKey))
          setLinkingWorker(false)
          clearSelections()
          setMessage(t('biometric.mappingSaved'))
        },
        runPostSave: async () => {
          const [attendanceRefreshed, workspaceRefreshed, activityRefreshed] = await Promise.all([
            refreshTodayAttendanceAfterMapping(),
            load(),
            loadRecentActivity(),
          ])
          if (!attendanceRefreshed || !workspaceRefreshed || !activityRefreshed) {
            throw new Error('post_save_refresh_failed')
          }
        },
        onPostSaveError: () => setPostSaveWarning(activityLabels.mappingPostSaveWarning),
      })
    } catch (linkError) {
      setError(linkError?.message || t('common.updateFailed'))
    } finally {
      setLinkingWorker(false)
    }
  }
  const createWorkerFromDevice = async ({ fullName, employeeCode, teamId }) => {
    if (!selectedDevice || creatingWorker) return
    if (selectedDevice.hasActiveMapping) {
      setError(activityLabels.activeMappingCannotCreate)
      setCreateWorkerOpen(false)
      return
    }
    const deviceUser = selectedDevice
    setCreatingWorker(true)
    setError('')
    setPostSaveWarning('')
    try {
      await completeCriticalBiometricWorkerCreation({
        createWorker: () => createWorkerAndConfirmBiometricMappingRequest({ deviceUser, fullName, employeeCode, teamId }),
        onCreated: () => {
          setCommittedEmployeeCodes((previous) => [...previous, String(employeeCode || '').trim()])
          setOptimisticallyMappedEmployeeNos((previous) => new Set(previous).add(deviceUser.identityKey))
          setCreatingWorker(false)
          clearSelections()
          setCreateWorkerOpen(false)
          setMessage(t('biometric.workerCreatedAndMapped'))
        },
        runPostSave: async () => {
          const [attendanceRefreshed, workspaceRefreshed, activityRefreshed] = await Promise.all([
            refreshTodayAttendanceAfterMapping(),
            load(),
            loadRecentActivity(),
          ])
          if (!attendanceRefreshed || !workspaceRefreshed || !activityRefreshed) {
            throw new Error('post_save_refresh_failed')
          }
        },
        onPostSaveError: () => setPostSaveWarning(activityLabels.postSaveWarning),
      })
    } catch (createError) {
      if (isDuplicateEmployeeCodeError(createError)) {
        setError(activityLabels.duplicateEmployeeCode)
        void load()
      } else {
        setError(createError?.message || t('common.updateFailed'))
      }
    } finally {
      setCreatingWorker(false)
    }
  }
  const syncUsers = async (targetDeviceId) => {
    if (!helper) return
    setError('')
    setMessage('')
    try {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), HELPER_LIGHTWEIGHT_TIMEOUT_MS)
      const response = await fetch(`${helper}/sync-users/start`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: targetDeviceId }),
      })
      window.clearTimeout(timeout)
      const result = await response.json().catch(() => null)
      if (!response.ok || !['running', 'success'].includes(result?.status)) throw new Error('sync_start_failed')
      setSyncTarget(result?.target_device_id || targetDeviceId)
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
        setLastSyncAt(syncedAt); replaceHikvisionDeviceUsers(job.result.users)
        await load()
        if (!cancelled) {
          if (job.target_device_id && job.target_device_id !== 'all') setDeviceFilter(job.target_device_id)
          setMessage(t('biometric.syncSucceeded'))
        }
        void loadRecentActivity()
      } catch {
        if (!cancelled) { setSyncing(false); setError(t('biometric.syncFailed')) }
      }
    }
    poll()
    return () => { cancelled = true; if (timer) window.clearTimeout(timer) }
  }, [syncing, syncTarget])

  const syncLabel = syncing
    ? (syncTarget === 'office-main' ? t('biometric.syncingOfficeMain') : syncTarget === 'office-secondary' ? t('biometric.syncingOfficeSecondary') : t('biometric.syncingAllDevices'))
    : null
  const activityLabelsByLanguage = {
    ar: {
      title: 'بصمات غير مربوطة خلال آخر 7 أيام',
      window: 'نافذة الأحداث الفعلية',
      latest: 'آخر بصمة',
      events: 'عدد الأحداث الحديثة',
      unavailable: 'تعذر قراءة نشاط البصمة الفعلي لآخر 7 أيام.',
      empty: 'لا توجد هويات غير مربوطة لها بصمات فعلية خلال آخر 7 أيام.',
      postSaveWarning: 'تم إنشاء العامل وربطه بنجاح، لكن تعذر إكمال تحديث الحضور أو القوائم الثانوية. يمكن إعادة المحاولة من شاشة الحضور.',
      mappingPostSaveWarning: 'تم حفظ الربط بنجاح، لكن تعذر إكمال تحديث الحضور أو إحدى القوائم الثانوية. يمكن إعادة المحاولة من شاشة الحضور.',
      duplicateEmployeeCode: 'كود الموظف مستخدم بالفعل. اختر كودًا آخر، أو أغلق النموذج وافتحه مجددًا للحصول على أحدث اقتراح.',
      activeMappingCannotCreate: 'هذه الهوية مرتبطة بعامل بالفعل، ولا يمكن إنشاء عامل جديد لها. راجع الربط الحالي أولًا.',
      existingIdentities: 'الهويات المرتبطة حاليًا',
    },
    en: {
      title: 'Unmapped punches in the last 7 days',
      window: 'Real-event window',
      latest: 'Latest punch',
      events: 'Recent events',
      unavailable: 'Unable to read real biometric activity for the last 7 days.',
      empty: 'No unmapped identities generated a real punch in the last 7 days.',
      postSaveWarning: 'The worker was created and mapped, but a secondary attendance or list refresh could not finish. It can be retried from Attendance.',
      mappingPostSaveWarning: 'The mapping was saved, but a secondary attendance or list refresh could not finish. It can be retried from Attendance.',
      duplicateEmployeeCode: 'This employee code is already in use. Choose another code, or reopen the form to get the latest suggestion.',
      activeMappingCannotCreate: 'This identity already has an active worker mapping. Review the existing mapping before creating a worker.',
      existingIdentities: 'Currently linked identities',
    },
    fr: {
      title: 'Pointages non liés des 7 derniers jours',
      window: 'Fenêtre des événements réels',
      latest: 'Dernier pointage',
      events: 'Événements récents',
      unavailable: 'Impossible de lire l’activité biométrique réelle des 7 derniers jours.',
      empty: 'Aucune identité non liée n’a produit de pointage réel ces 7 derniers jours.',
      postSaveWarning: 'Le travailleur a été créé et lié, mais une actualisation secondaire n’a pas abouti. Elle peut être relancée depuis Présence.',
      mappingPostSaveWarning: 'La liaison a été enregistrée, mais une actualisation secondaire n’a pas abouti. Elle peut être relancée depuis Présence.',
      duplicateEmployeeCode: 'Ce code employé est déjà utilisé. Choisissez-en un autre ou rouvrez le formulaire pour obtenir la dernière suggestion.',
      activeMappingCannotCreate: 'Cette identité possède déjà une liaison active. Vérifiez la liaison existante avant de créer un travailleur.',
      existingIdentities: 'Identités actuellement liées',
    },
  }
  const activityLabels = activityLabelsByLanguage[language] || activityLabelsByLanguage.en

  return <section>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-extrabold">{t('biometricMapping.title')}</h2><p className="text-sm text-(--muted)">{t('biometricMapping.subtitle')}</p></div><div className="text-end"><div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn-primary" disabled={!helper || syncing} onClick={() => syncUsers('office-main')}>{syncing && syncTarget === 'office-main' ? syncLabel : t('biometric.syncOfficeMain')}</button><button type="button" className="btn-secondary" disabled={!helper || syncing} onClick={() => syncUsers('office-secondary')}>{syncing && syncTarget === 'office-secondary' ? syncLabel : t('biometric.syncOfficeSecondary')}</button><button type="button" className="btn-secondary" disabled={!helper || syncing} onClick={() => syncUsers('all')}>{syncing && syncTarget === 'all' ? syncLabel : t('biometric.syncAllDevices')}</button></div>{lastSyncAt ? <p className="mt-1 text-xs text-(--muted)">{t('biometric.lastSync')}: {timeLabel(lastSyncAt)}</p> : null}</div></div>
    {error ? <p className="alert alert--error mb-3">{error}</p> : null}{message ? <p className="mb-3 rounded bg-green-50 p-3 text-green-700">{message}</p> : null}{postSaveWarning ? <p className="alert alert--warning mb-3">{postSaveWarning}</p> : null}{inventoryRefreshError ? <p className="alert alert--error mb-3">{t('biometric.inventoryRefreshFailed')}</p> : null}
    <section className="surface-card mb-4 overflow-hidden border-2 border-amber-200">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 p-4">
        <div><h3 className="font-extrabold">{activityLabels.title}</h3><p className="mt-1 text-xs text-(--muted)">{activityLabels.window}: <span dir="ltr">{recentActivity?.start_date || '—'} → {recentActivity?.end_date || '—'}</span></p></div>
        <div className="flex items-center gap-3"><span className="rounded-full bg-amber-200 px-4 py-2 text-xl font-extrabold">{recentActivityLoading ? '…' : recentUnmappedUsers.length}</span><button type="button" className="btn-secondary" disabled={recentActivityLoading} onClick={loadRecentActivity}>{t('common.refresh')}</button></div>
      </div>
      {recentActivityError ? <p className="alert alert--error m-4">{activityLabels.unavailable}</p> : null}
    </section>
    <section className="surface-card mb-4 border-2 border-blue-200 p-4"><div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr]"><div className={selectedDevice ? 'rounded-xl bg-blue-50 p-3' : 'rounded-xl bg-slate-50 p-3'}><p className="text-sm text-(--muted)">{t('biometric.selectedDeviceIdentity')}</p>{selectedDevice ? <><p className="mt-1 font-extrabold">{selectedDevice.name}</p><p dir="ltr">{selectedDevice.employeeNo}</p><p className="text-xs text-(--muted)">{deviceSource(selectedDevice)} · {deviceStatus(selectedDevice)}</p></> : <p className="mt-1 text-sm text-(--muted)">{t('biometricMapping.selectIdentity')}</p>}</div><p className="self-center text-center text-3xl" dir="ltr">→</p><div className={selectedWorker ? 'rounded-xl bg-blue-50 p-3' : 'rounded-xl bg-slate-50 p-3'}><p className="text-sm text-(--muted)">{t('biometric.selectedWorker')}</p>{selectedWorker ? <><p className="mt-1 font-extrabold">{selectedWorker.full_name}</p><p dir="ltr">{selectedWorker.employee_code || '—'}</p>{selectedWorkerMappings.length ? <p className="mt-2 text-xs text-(--muted)">{activityLabels.existingIdentities}: <span dir="ltr">{selectedWorkerMappings.map((mapping) => `${mapping.device_id || 'legacy'}: ${mapping.device_employee_no}`).join(' · ')}</span></p> : null}</> : <p className="mt-1 text-sm text-(--muted)">{t('biometric.chooseWorkerFirst')}</p>}</div></div><div className="mt-3 flex flex-wrap gap-2 border-t border-(--border) pt-3"><button type="button" className="btn-secondary" disabled={linkingWorker} onClick={clearSelections}>{t('biometric.clearSelection')}</button><button type="button" className="btn-primary px-8" disabled={!selectedDevice || selectedDevice.hasActiveMapping || !selectedWorker?.id || linkingWorker} onClick={link}>{linkingWorker ? t('common.saving') : t('biometric.link')}</button></div></section>
    {selectedDevice && !selectedDevice.hasActiveMapping ? <section className="surface-card mb-4 p-4"><h3 className="font-extrabold">{t('biometric.similarNames')}</h3><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{similarWorkers.map(({ worker }) => <button type="button" key={worker.id} onClick={() => selectWorker(worker)} className={String(selectedWorker?.id) === String(worker.id) ? 'btn-primary text-start' : 'btn-secondary text-start'}><b>{worker.full_name}</b><span className="block text-xs" dir="ltr">{worker.employee_code || '—'}</span><span className="block text-xs">{worker.team?.name || worker.team_name || '—'}</span></button>)}</div>{!similarWorkers.length ? <p className="mt-3 text-sm text-(--muted)">{t('biometricMapping.noSimilarNames')}</p> : null}{!selectedWorker ? <div className="mt-4 border-t border-(--border) pt-4"><p className="text-sm text-(--muted)">{t('biometric.workerNotFound')}</p><button type="button" className="btn-secondary mt-2" onClick={openCreateWorker}>{t('biometric.addNewWorker')}</button></div> : null}</section> : null}
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="surface-card overflow-hidden"><div className="border-b border-(--border) p-4"><h3 className="font-extrabold">{activityLabels.title}</h3><div className="mt-3 grid gap-2 sm:grid-cols-2"><input className="input-base" value={deviceQuery} onChange={(event) => setDeviceQuery(event.target.value)} placeholder={t('biometric.searchDevice')} /><select className="input-base" value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}><option value="all">{t('biometric.allDevices')}</option><option value="office-main">{t('biometric.officeMain')}</option><option value="office-secondary">{t('biometric.officeSecondary')}</option></select></div></div><div className="max-h-[34rem] divide-y divide-(--border) overflow-y-auto">{deviceUsers.map((user) => <button type="button" key={user.identityKey} onClick={() => selectDevice(user)} className={selectedDeviceIdentity === user.identityKey ? 'block w-full bg-blue-100 p-4 text-start ring-2 ring-inset ring-blue-600' : 'block w-full p-4 text-start hover:bg-slate-50'}><div className="flex items-center justify-between gap-2"><b>{user.name || '—'}</b><span dir="ltr">{user.employeeNo}</span></div><p className="mt-1 text-xs text-(--muted)">{deviceSource(user)} · {activityLabels.latest}: {timeLabel(user.latestRecentEventAt)} · {activityLabels.events}: {user.recentEventCount}</p></button>)}{!deviceUsers.length ? <p className="p-5 text-sm text-(--muted)">{activityLabels.empty}</p> : null}</div></section>
      <section className="surface-card overflow-hidden"><div className="border-b border-(--border) p-4"><h3 className="font-extrabold">{t('biometric.systemWorkers')}</h3><input className="input-base mt-3" value={workerQuery} onChange={(event) => setWorkerQuery(event.target.value)} placeholder={t('biometric.searchWorker')} /></div><div className="max-h-[34rem] divide-y divide-(--border) overflow-y-auto">{workers.map((worker) => <button type="button" key={worker.id} onClick={() => selectWorker(worker)} className={String(selectedWorker?.id) === String(worker.id) ? 'block w-full bg-blue-100 p-4 text-start ring-2 ring-inset ring-blue-600' : 'block w-full p-4 text-start hover:bg-slate-50'}><b>{worker.full_name}</b><p className="mt-1 text-xs text-(--muted)"><span dir="ltr">{worker.employee_code || '—'}</span> · {worker.team?.name || worker.team_name || '—'}</p></button>)}{!workers.length ? <p className="p-5 text-sm text-(--muted)">{t('common.noResults')}</p> : null}</div></section>
    </div>
    <CreateWorkerFromDeviceModal deviceUser={selectedDevice} teams={data?.teams || []} initialEmployeeCode={suggestedEmployeeCode} isOpen={createWorkerOpen} isSaving={creatingWorker} onClose={() => setCreateWorkerOpen(false)} onSubmit={createWorkerFromDevice} />
  </section>
}
