import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import { getWorkerBiometricSearchIndexRequest } from '../api/biometricMappingApi'
import { getTeamsRequest } from '../api/teamsApi'
import { getWorkersRequest } from '../api/workersApi'
import { saveSupervisorMorningReviewRequest } from '../api/supervisorMorningReviewApi'
import { useTranslation } from '../i18n/LanguageContext'
import { useAuthStore } from '../store/authStore'
import { ATTENDANCE_REFRESH_INTERVAL_MS, isAttendancePageLocked, kinshasaClock, prepareAttendanceOutput } from '../utils/attendanceOperationalGate'
import { createAbsenceReportRefreshCoordinator } from '../utils/absenceReport'
import { buildSupervisorSheet, supervisorSheetTeams } from '../utils/supervisorSheet'
import { isSupervisorFinalWindow, supervisorChoiceOutcome, supervisorReviewWorkerIds, unselectedSupervisorWorkerIds } from '../utils/supervisorMorningReview'

const RESULTS = ['A', 'P', 'O', 'M']
const asArray = (value) => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []

export default function SupervisorSheet() {
  const { t, language } = useTranslation()
  const admin = useAuthStore((state) => state.admin)
  const [date] = useState(() => kinshasaClock().date)
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
        const [workersResult, teamsResult, attendanceResult, mappingsResult] = await Promise.all([
          getWorkersRequest(), getTeamsRequest(),
          getAttendanceRequest({ date, staff_classification: 'normal' }),
          getWorkerBiometricSearchIndexRequest(),
        ])
        if (!mountedRef.current || frozenRef.current) return
        setWorkers(asArray(workersResult.data))
        setTeams(asArray(teamsResult.data))
        setAttendance(asArray(attendanceResult.data))
        setMappings(asArray(mappingsResult.data))
        setError('')
        if (final) { frozenRef.current = true; setFrozen(true) }
      })
    } catch (requestError) {
      if (mountedRef.current) setError(getErrorMessage(requestError))
      throw requestError
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [date])

  useEffect(() => () => { mountedRef.current = false }, [])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (locked || frozen) return
    refreshSnapshot({ final: finalWindow }).catch(() => {})
  }, [locked, finalWindow, frozen, refreshSnapshot])
  useEffect(() => {
    if (locked || finalWindow || frozen) return undefined
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
  }, [date, locked, finalWindow, frozen, refreshSnapshot])

  const availableTeams = useMemo(() => supervisorSheetTeams(teams), [teams])
  const sheet = useMemo(() => buildSupervisorSheet({ workers: locked ? [] : workers, attendance, mappings, date, teamId }), [workers, attendance, mappings, date, teamId, locked])
  const allSheet = useMemo(() => buildSupervisorSheet({ workers: locked ? [] : workers, attendance, mappings, date }), [workers, attendance, mappings, date, locked])
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
    if (!admin?.is_active || !frozen || saving || saved || !allSheet.workerCount) return
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
      <p className="text-sm font-bold">{t('attendance.date')}: <span dir="ltr">{formattedDate}</span></p>
      <label className="min-w-52 text-sm font-bold">{t('attendance.team')}
        <select className="input-base mt-1" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
          <option value="">{t('supervisorSheet.allTeams')}</option>
          {availableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </label>
      <button type="button" className="btn-secondary" disabled={locked || (finalWindow && !frozen) || loading || Boolean(error) || !sheet.workerCount} onClick={() => printSheet('blank')}>{t('supervisorSheet.printBlank')}</button>
      <button type="button" className="btn-primary" disabled={locked || (finalWindow && !frozen) || loading || Boolean(error) || !sheet.workerCount} onClick={() => printSheet('results')}>{t('supervisorSheet.printResults')}</button>
      <button type="button" className="btn-secondary" disabled={saving || saved} onClick={() => { setResults({}); setPrintMode('blank') }}>{t('supervisorSheet.clearResults')}</button>
      {admin?.is_active && <button type="button" className="btn-primary" disabled={!frozen || saving || saved || !allSheet.workerCount} onClick={saveResults}>{t('supervisorSheet.saveResults')}</button>}
      {finalWindow && !frozen && !loading && <button type="button" className="btn-secondary" onClick={() => refreshSnapshot({ final: true }).catch(() => {})}>{t('supervisorSheet.retryFinalCheck')}</button>}
    </div>
    {error ? <p role="alert" className="alert alert--error mb-4">{error}</p> : null}
    {saveError ? <p role="alert" className="alert alert--error mb-4">{saveError}</p> : null}
    {saveMessage ? <p role="status" className="alert mb-4">{saveMessage}</p> : null}
    {!locked && <p className="absence-report-screen-only mb-4 text-sm font-semibold text-(--muted)" role="status">
      {frozen ? t('supervisorSheet.frozen') : finalWindow ? t('supervisorSheet.finalChecking') : t('supervisorSheet.refreshingUntil11')}
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
      </header>
      {loading ? <p className="py-8 text-center">{t('common.loading')}</p> : !error && !sheet.workerCount ? <p className="absence-report-empty">{t('supervisorSheet.noWorkers')}</p> : null}
      {!loading && !error ? sheet.groups.filter((group) => group.workers.length > 0).map((group) => <section key={group.id} className="absence-team-block">
        <div className="absence-team-heading"><h2>{group.name}</h2><p>{t('supervisorSheet.workerCount')}: {group.workers.length}</p></div>
        <div className="absence-week-table-wrap"><table className="absence-week-table supervisor-sheet-table">
          <thead><tr><th>{t('attendance.worker')}</th><th>{t('workers.employeeCode')}</th><th>{t('reports.biometricId')}</th><th>{t('supervisorSheet.result')}</th></tr></thead>
          <tbody>{group.workers.map((worker) => <tr key={worker.id}>
            <td>{worker.name}</td><td dir="ltr">{worker.employeeCode || '—'}</td><td dir="ltr">{worker.biometricId}</td>
            <td><div className="supervisor-sheet-screen-only supervisor-sheet-choices" role="group" aria-label={`${worker.name} ${t('supervisorSheet.result')}`}>
              {RESULTS.map((value) => <button key={value} type="button" className="supervisor-sheet-choice" disabled={!frozen || saving || saved} aria-pressed={results[worker.id] === value} title={t(`supervisorSheet.${value}`)} onClick={() => setResults((current) => ({ ...current, [worker.id]: value }))}>{value}</button>)}
              {saved && results[worker.id] && <span className="text-xs font-bold">{t(`attendance.${supervisorChoiceOutcome(results[worker.id])?.status}`)}{supervisorChoiceOutcome(results[worker.id])?.reason ? ` - ${t(`supervisorSheet.${supervisorChoiceOutcome(results[worker.id]).reason}`)}` : ''}</span>}
            </div><span className="supervisor-sheet-print-only" data-testid={`printed-result-${worker.id}`}>{printMode === 'blank' ? '________' : results[worker.id] || '—'}</span></td>
          </tr>)}</tbody>
        </table></div>
      </section>) : null}
    </article>}
  </section>
}
