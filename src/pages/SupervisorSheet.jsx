import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import { getWorkerBiometricSearchIndexRequest } from '../api/biometricMappingApi'
import { getTeamsRequest } from '../api/teamsApi'
import { getWorkersRequest } from '../api/workersApi'
import { finalizeSupervisorReviewRequest, getHistoricalSupervisorReviewRequest, saveSupervisorMorningReviewRequest } from '../api/supervisorMorningReviewApi'
import { useTranslation } from '../i18n/LanguageContext'
import { useAuthStore } from '../store/authStore'
import { ATTENDANCE_REFRESH_INTERVAL_MS, isAttendancePageLocked, kinshasaClock, prepareAttendanceOutput } from '../utils/attendanceOperationalGate'
import { createAbsenceReportRefreshCoordinator } from '../utils/absenceReport'
import { buildSupervisorSheet, supervisorSheetTeams } from '../utils/supervisorSheet'
import { isSupervisorFinalWindow, savedSupervisorResults, supervisorChoiceOutcome, supervisorReviewWorkerIds, unselectedSupervisorWorkerIds } from '../utils/supervisorMorningReview'

const RESULTS = ['A', 'P', 'O', 'M']
const asArray = (value) => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []

export default function SupervisorSheet() {
  const { t, language } = useTranslation()
  const admin = useAuthStore((state) => state.admin)
  const [date, setDate] = useState(() => kinshasaClock().date)
  const selectedDateRef = useRef(date)
  const baselineRef = useRef({})
  const [readOnly, setReadOnly] = useState(false)
  const [exactPopulation, setExactPopulation] = useState(false)
  const [reconstructed, setReconstructed] = useState(false)
  const [workers, setWorkers] = useState([])
  const [teams, setTeams] = useState([])
  const [mappings, setMappings] = useState([])
  const [attendance, setAttendance] = useState([])
  const [teamId, setTeamId] = useState('')
  const [results, setResults] = useState({})
  const [printMode, setPrintMode] = useState('blank')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [frozen, setFrozen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const today = kinshasaClock(now).date
  const historical = date < today
  const mountedRef = useRef(true)
  const frozenRef = useRef(false)
  const refreshCoordinatorRef = useRef(createAbsenceReportRefreshCoordinator())
  const locked = isAttendancePageLocked({ selectedDate: date, now })
  const finalWindow = isSupervisorFinalWindow(date, now)

  const refreshSnapshot = useCallback(async ({ final = false } = {}) => {
    if (frozenRef.current) return
    if (isSupervisorFinalWindow(date, new Date()) && !final) throw new Error('final_review_pending')
    if (isAttendancePageLocked({ selectedDate: date, now: new Date() })) throw new Error('attendance_locked')
    if (mountedRef.current) { setLoading(true); setError('') }
    try {
      return await refreshCoordinatorRef.current(`${date}:${final ? 'final' : 'live'}`, async () => {
        const history = historical ? await getHistoricalSupervisorReviewRequest(date) : final ? await finalizeSupervisorReviewRequest(date) : null
        const [workersResult, teamsResult, attendanceResult, mappingsResult] = await Promise.all([
          history ? { data: history.workers } : getWorkersRequest(), history ? { data: history.teams } : getTeamsRequest(),
          history ? { data: history.attendance } : getAttendanceRequest({ date, staff_classification: 'normal' }),
          getWorkerBiometricSearchIndexRequest(),
        ])
        if (!mountedRef.current || frozenRef.current || selectedDateRef.current !== date) return
        setReadOnly(Boolean(history && (!history.available || history.read_only)))
        setExactPopulation(history?.exact_population === true)
        setReconstructed(history?.reconstructed === true)
        const restored = savedSupervisorResults(asArray(attendanceResult.data), date)
        baselineRef.current = restored
        setResults((current) => ({ ...restored, ...current }))
        setWorkers(asArray(workersResult.data))
        setTeams(asArray(teamsResult.data))
        setAttendance(asArray(attendanceResult.data))
        setMappings(asArray(mappingsResult.data))
        setError('')
        if (final) { frozenRef.current = true; setFrozen(true) }
      })
    } catch (requestError) {
      if (mountedRef.current && selectedDateRef.current === date) setError(getErrorMessage(requestError))
      throw requestError
    } finally {
      if (mountedRef.current && selectedDateRef.current === date) setLoading(false)
    }
  }, [date, historical])

  useEffect(() => () => { mountedRef.current = false }, [])
  useEffect(() => {
    if (historical) return undefined
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [historical])
  useEffect(() => {
    if (locked || frozen) return
    refreshSnapshot({ final: finalWindow }).catch(() => {})
  }, [locked, finalWindow, frozen, refreshSnapshot])
  useEffect(() => {
    if (historical || locked || finalWindow || frozen) return undefined
    const timer = window.setInterval(() => refreshSnapshot().catch(() => {}), ATTENDANCE_REFRESH_INTERVAL_MS)
    const refreshAfterFocus = () => {
      if (document.visibilityState !== 'hidden' && !isSupervisorFinalWindow(date, new Date())
        && !isAttendancePageLocked({ selectedDate: date, now: new Date() })) {
        refreshSnapshot().catch(() => {})
      }
    }
    window.addEventListener('focus', refreshAfterFocus)
    document.addEventListener('visibilitychange', refreshAfterFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshAfterFocus)
      document.removeEventListener('visibilitychange', refreshAfterFocus)
    }
  }, [date, historical, locked, finalWindow, frozen, refreshSnapshot])

  const availableTeams = useMemo(() => supervisorSheetTeams(teams), [teams])
  const sheet = useMemo(() => buildSupervisorSheet({ workers: locked ? [] : workers, attendance, mappings, date, teamId, exactPopulation }), [workers, attendance, mappings, date, teamId, locked, exactPopulation])
  const allSheet = useMemo(() => buildSupervisorSheet({ workers: locked ? [] : workers, attendance, mappings, date, exactPopulation }), [workers, attendance, mappings, date, locked, exactPopulation])
  const missingSelections = unselectedSupervisorWorkerIds(allSheet.groups, results)
  const selectedTeamName = availableTeams.find((team) => String(team.id) === teamId)?.name || t('supervisorSheet.allTeams')
  const formattedDate = new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : language === 'fr' ? 'fr-FR' : 'en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Africa/Kinshasa',
  }).format(new Date(`${date}T12:00:00Z`))

  const printSheet = async (mode) => {
    setError('')
    const generatePrint = async () => {
      setPrintMode(mode)
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
      window.print()
    }
    if (frozen) { await generatePrint(); return }
    const result = await prepareAttendanceOutput({
      locked: locked || finalWindow,
      refresh: refreshSnapshot,
      generate: generatePrint,
    })
    if (!result.ok) setError(result.reason === 'locked' ? t('attendance.operationalLockTitle') : t('attendance.outputRefreshFailed'))
  }

  const saveResults = async () => {
    if (!admin?.is_active || !frozen || readOnly || loading || error || saving || !allSheet.workerCount) return
    if (missingSelections.length) {
      setSaveError(t('supervisorSheet.missingSelections', { count: missingSelections.length }))
      return
    }
    if (!window.confirm(t('supervisorSheet.saveConfirm'))) return
    const workerIds = supervisorReviewWorkerIds(allSheet.groups)
    const selectedResults = Object.fromEntries(workerIds.map((id) => [id, results[id]]))
    setSaving(true); setSaveError('')
    try {
      await saveSupervisorMorningReviewRequest({ date, workerIds, results: selectedResults })
      baselineRef.current = selectedResults
      setSaved(true)
      setSaveMessage(t('supervisorSheet.saveSuccess', { count: workerIds.length }))
    } catch (requestError) {
      setSaveError(getErrorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  return <section>
    <style>{'@media print { @page { size: A4 portrait; margin: 12mm; } }'}</style>
    <div className="absence-report-screen-only mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-extrabold">{t('supervisorSheet.title')}</h2><p className="mt-1 text-sm text-(--muted)">{t('supervisorSheet.description')}</p></div>
      <Link className="btn-secondary" to="/attendance">{t('payroll.back')}</Link>
    </div>
    <div className="absence-report-screen-only surface-card mb-5 flex flex-wrap items-end gap-3 p-4">
      <label className="flex flex-col gap-1 text-sm font-bold">{t('attendance.date')}
        <input aria-label={t('attendance.date')} type="date" max={today} value={date} disabled={saving} className="input-base block" dir="ltr" onChange={(event) => {
          const next = event.target.value
          if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next > kinshasaClock().date || next === date) return
          selectedDateRef.current = next; frozenRef.current = false; baselineRef.current = {}
          setFrozen(false); setLoading(true); setWorkers([]); setAttendance([]); setResults({}); setSaved(false)
          setExactPopulation(false); setReconstructed(false)
          setError(''); setSaveError(''); setSaveMessage(''); setPrintMode('blank'); setNow(new Date()); setDate(next)
        }} />
      </label>
      <label className="min-w-52 text-sm font-bold">{t('attendance.team')}
        <select className="input-base mt-1 block w-full" style={{ appearance: 'auto' }} value={teamId} onChange={(event) => setTeamId(event.target.value)}>
          <option value="">{t('supervisorSheet.allTeams')}</option>
          {availableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </label>
      <button type="button" className="btn-secondary" disabled={locked || (finalWindow && !frozen) || loading || Boolean(error) || !sheet.workerCount} onClick={() => printSheet('blank')}>{t('supervisorSheet.printBlank')}</button>
      <button type="button" className="btn-primary" disabled={locked || (finalWindow && !frozen) || loading || Boolean(error) || !sheet.workerCount} onClick={() => printSheet('results')}>{t('supervisorSheet.printResults')}</button>
      <button type="button" className="btn-secondary" disabled={saving} onClick={() => { setResults({ ...baselineRef.current }); setSaved(false); setPrintMode('blank') }}>{t('supervisorSheet.clearResults')}</button>
      {admin?.is_active && <button type="button" className="btn-primary" disabled={!frozen || readOnly || loading || Boolean(error) || saving || !allSheet.workerCount} onClick={saveResults}>{t('supervisorSheet.saveResults')}</button>}
      {finalWindow && !frozen && !loading && <button type="button" className="btn-secondary" onClick={() => refreshSnapshot({ final: true }).catch(() => {})}>{t('supervisorSheet.retryFinalCheck')}</button>}
    </div>
    {error ? <p role="alert" className="alert alert--error mb-4">{error}</p> : null}
    {saveError ? <p role="alert" className="alert alert--error mb-4">{saveError}</p> : null}
    {saveMessage ? <p role="status" className="alert mb-4">{saveMessage}</p> : null}
    {reconstructed && <p role="status" className="mb-4 text-sm font-semibold text-amber-800">{({ ar: 'قائمة تاريخية معاد بناؤها — قد لا تطابق الورقة النهائية الأصلية', en: 'Reconstructed historical list — may not match the original final sheet', fr: 'Liste historique reconstruite — peut différer de la feuille finale originale' })[language]}</p>}
    {!locked && <p className="absence-report-screen-only mb-4 text-sm font-semibold text-(--muted)" role="status">
      {historical ? ({ ar: 'مراجعة تاريخ سابق', en: 'Historical date review', fr: 'Révision d’une date passée' })[language] : frozen ? t('supervisorSheet.frozen') : finalWindow ? t('supervisorSheet.finalChecking') : t('supervisorSheet.refreshingUntil11')}
      {historical && readOnly ? ({ ar: ' — للقراءة فقط: سجل تاريخي غير متاح أو فترة رواتب معتمدة/مدفوعة', en: ' — Read-only: historical roster unavailable or payroll finalized/paid', fr: ' — Lecture seule : historique indisponible ou paie finalisée/payée' })[language] : ''}
      {frozen && !saved && allSheet.workerCount > 0 ? ` · ${t('supervisorSheet.missingSelections', { count: missingSelections.length })}` : ''}
    </p>}
    {locked ? <div className="surface-card border border-amber-200 bg-amber-50 px-6 py-10 text-center" role="status">
      <h3 className="text-xl font-extrabold text-amber-900">{t('attendance.operationalLockTitle')}</h3>
      <p className="mt-2 text-sm font-semibold text-amber-800">{t('attendance.operationalLockDescription')}</p>
    </div> : <article className="absence-report-print-root" dir={language === 'ar' ? 'rtl' : 'ltr'} data-print-mode={printMode}>
      <header className="absence-report-header">
        <p className="absence-report-company">{t('absenceReport.companyTitle')}</p>
        <h1>{t('supervisorSheet.title')}</h1>
        <p>{t('attendance.date')}: <span dir="ltr">{formattedDate}</span> · {t('attendance.team')}: {selectedTeamName}</p>
        <p>{t('supervisorSheet.workerCount')}: {sheet.workerCount}</p>
        {reconstructed && <p>{({ ar: 'قائمة تاريخية معاد بناؤها — قد لا تطابق الورقة النهائية الأصلية', en: 'Reconstructed historical list — may not match the original final sheet', fr: 'Liste historique reconstruite — peut différer de la feuille finale originale' })[language]}</p>}
      </header>
      {loading ? <p className="py-8 text-center">{t('common.loading')}</p> : !error && !sheet.workerCount ? <p className="absence-report-empty">{t('supervisorSheet.noWorkers')}</p> : null}
      {!loading && !error ? sheet.groups.filter((group) => group.workers.length > 0).map((group) => <section key={group.id} className="absence-team-block">
        <div className="absence-team-heading"><h2>{group.name}</h2><p>{t('supervisorSheet.workerCount')}: {group.workers.length}</p></div>
        <div className="absence-week-table-wrap"><table className="absence-week-table supervisor-sheet-table">
          <thead><tr><th>{t('attendance.worker')}</th><th>{t('workers.employeeCode')}</th><th>{t('reports.biometricId')}</th><th>{t('supervisorSheet.result')}</th></tr></thead>
          <tbody>{group.workers.map((worker) => <tr key={worker.id}>
            <td>{worker.name}</td><td dir="ltr">{worker.employeeCode || '—'}</td><td dir="ltr">{worker.biometricId}</td>
            <td><div className="supervisor-sheet-screen-only supervisor-sheet-choices" role="group" aria-label={`${worker.name} ${t('supervisorSheet.result')}`}>
              {RESULTS.map((value) => <button key={value} type="button" className="supervisor-sheet-choice" disabled={!frozen || readOnly || saving} aria-pressed={results[worker.id] === value} title={t(`supervisorSheet.${value}`)} onClick={() => { setSaved(false); setResults((current) => ({ ...current, [worker.id]: value })) }}>{value}</button>)}
              {saved && results[worker.id] && <span className="text-xs font-bold">{t(`attendance.${supervisorChoiceOutcome(results[worker.id])?.status}`)}{supervisorChoiceOutcome(results[worker.id])?.reason ? ` - ${t(`supervisorSheet.${supervisorChoiceOutcome(results[worker.id]).reason}`)}` : ''}</span>}
            </div><span className="supervisor-sheet-print-only" data-testid={`printed-result-${worker.id}`}>{printMode === 'blank' ? '________' : results[worker.id] || '—'}</span></td>
          </tr>)}</tbody>
        </table></div>
      </section>) : null}
    </article>}
  </section>
}
