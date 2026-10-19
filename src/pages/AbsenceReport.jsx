import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getWorkerBiometricSearchIndexRequest } from '../api/biometricMappingApi'
import { getErrorMessage } from '../api/axios'
import { getTeamsRequest } from '../api/teamsApi'
import { getWorkersRequest } from '../api/workersApi'
import { finalizeSupervisorReviewRequest, getHistoricalSupervisorReviewRequest } from '../api/supervisorMorningReviewApi'
import { buildSupervisorSheet } from '../utils/supervisorSheet'
import { reportWorkerMatchesSearch } from '../utils/reportWorkerSearch'
import ReportWorkerSearch from '../components/Reports/ReportWorkerSearch'
import { useTranslation } from '../i18n/LanguageContext'
import {
  isAttendancePageLocked,
  kinshasaClock,
  prepareAttendanceOutput,
} from '../utils/attendanceOperationalGate'
import { absenceWeekDates, buildAbsenceReport, createAbsenceReportRefreshCoordinator } from '../utils/absenceReport'
import { isOperationalAttendanceTeam } from '../utils/activeWorkers'
import { isSupervisorFinalWindow } from '../utils/supervisorMorningReview'

const asArray = (value) => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []
const currentBusinessDate = () => kinshasaClock().date
const requestKeyFor = ({ mode, selectedDate }) => `${mode}:${selectedDate}`
const datesFor = ({ mode, selectedDate }) => mode === 'week' ? absenceWeekDates(selectedDate) : [selectedDate]
const compactBiometricId = (value) => value === '—' ? '—' : String(value).split(' · ').map((id) => `#${id}`).join(' · ')

export default function AbsenceReport() {
  const { t, language } = useTranslation()
  const [mode, setMode] = useState('today')
  const [selectedDate, setSelectedDate] = useState(currentBusinessDate)
  const [teamId, setTeamId] = useState('')
  const [search, setSearch] = useState('')
  const [snapshot, setSnapshot] = useState({ key: '', workers: [], teams: [], attendance: [], mappings: [], fetchedAt: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const requestRef = useRef({ mode, selectedDate })
  const refreshCoordinatorRef = useRef(null)
  const mountedRef = useRef(true)
  const frozenSnapshotRef = useRef(null)
  const latestSnapshotRef = useRef(null)

  requestRef.current = { mode, selectedDate }
  if (!refreshCoordinatorRef.current) refreshCoordinatorRef.current = createAbsenceReportRefreshCoordinator()
  const businessDate = kinshasaClock(now).date
  const requestKey = requestKeyFor(requestRef.current)
  const dates = useMemo(() => datesFor({ mode, selectedDate }), [mode, selectedDate])
  const isTodayView = mode === 'today' && selectedDate === businessDate
  const locked = mode === 'today' && isAttendancePageLocked({ selectedDate, now })
  const finalWindow = isTodayView && isSupervisorFinalWindow(selectedDate, now)
  const frozen = frozenSnapshotRef.current?.key === requestKey
  const locale = language === 'ar' ? 'ar-EG' : language === 'fr' ? 'fr-FR' : 'en-GB'

  const refreshSnapshot = useCallback(async (requested = requestRef.current, { final = false } = {}) => {
    const key = requestKeyFor(requested)
    if (frozenSnapshotRef.current?.key === key) return frozenSnapshotRef.current
    if (requested.mode === 'today' && requested.selectedDate === currentBusinessDate()
      && isSupervisorFinalWindow(requested.selectedDate, new Date()) && !final) {
      return latestSnapshotRef.current
    }
    if (requested.mode === 'today' && isAttendancePageLocked({ selectedDate: requested.selectedDate, now: new Date() })) {
      const lockError = new Error('attendance_locked')
      lockError.code = 'attendance_locked'
      throw lockError
    }
    const requestedDates = datesFor(requested)
    const attendanceParams = requested.mode === 'week'
      ? { date_from: requestedDates[0], date_to: requestedDates.at(-1), staff_classification: 'normal' }
      : { date: requested.selectedDate, staff_classification: 'normal' }
    if (mountedRef.current) { setLoading(true); setError('') }
    try {
      return await refreshCoordinatorRef.current(`${key}:${final ? 'final' : 'live'}`, async () => {
        const review = final ? await finalizeSupervisorReviewRequest(requested.selectedDate)
          : requested.mode === 'today' && requested.selectedDate < currentBusinessDate()
            ? await getHistoricalSupervisorReviewRequest(requested.selectedDate) : null
        const finalReview = review?.exact_population ? review : null
        if (final && (!finalReview?.available || !finalReview.exact_population)) throw new Error('Final morning snapshot unavailable')
        const [workersResult, teamsResult, attendanceResult, mappingsResult] = await Promise.all([
          finalReview ? { data: finalReview.workers } : getWorkersRequest(),
          finalReview ? { data: finalReview.teams } : getTeamsRequest(),
          finalReview ? { data: finalReview.attendance } : getAttendanceRequest(attendanceParams),
          getWorkerBiometricSearchIndexRequest(),
        ])
        const nextSnapshot = {
          key,
          workers: asArray(workersResult.data),
          teams: asArray(teamsResult.data).filter((team) => team.is_active !== false),
          attendance: asArray(attendanceResult.data),
          mappings: asArray(mappingsResult.data),
          fetchedAt: new Date(),
          exactPopulation: finalReview?.exact_population === true,
        }
        if (mountedRef.current && requestKeyFor(requestRef.current) === key) {
          latestSnapshotRef.current = nextSnapshot
          setSnapshot(nextSnapshot)
          if (final) frozenSnapshotRef.current = nextSnapshot
        }
        return nextSnapshot
      })
    } catch (requestError) {
      if (mountedRef.current) setError(getErrorMessage(requestError))
      throw requestError
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => () => { mountedRef.current = false }, [])

  useEffect(() => {
    if (frozen) return undefined
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [frozen])

  useEffect(() => {
    if (!isTodayView || locked || finalWindow || frozen) return undefined
    const cutoff = new Date(`${selectedDate}T11:00:00+01:00`).getTime()
    const timer = window.setTimeout(() => setNow(new Date()), Math.max(0, cutoff - Date.now()))
    return () => window.clearTimeout(timer)
  }, [selectedDate, isTodayView, locked, finalWindow, frozen])

  useEffect(() => {
    if (locked) return
    if (frozen) {
      setSnapshot(frozenSnapshotRef.current)
      return
    }
    refreshSnapshot(requestRef.current, { final: finalWindow }).catch(() => {})
  }, [locked, mode, refreshSnapshot, selectedDate, finalWindow, frozen])

  const report = useMemo(() => {
    if (snapshot.key === requestKey && snapshot.exactPopulation) {
      const sheet = buildSupervisorSheet({ workers: snapshot.workers.filter((worker) => reportWorkerMatchesSearch(worker, search)),
        date: selectedDate, teamId, exactPopulation: true })
      return { groups: sheet.groups, missingMorningWorkers: sheet.workerCount }
    }
    return buildAbsenceReport({
      workers: snapshot.key === requestKey ? snapshot.workers : [],
      attendance: snapshot.key === requestKey ? snapshot.attendance : [],
      mappings: snapshot.key === requestKey ? snapshot.mappings : [],
      mode,
      selectedDate,
      businessDate,
      teamId,
      search,
    })
  }, [businessDate, mode, requestKey, search, selectedDate, snapshot, teamId])

  const printReport = async () => {
    setError('')
    const requested = { ...requestRef.current }
    const result = await prepareAttendanceOutput({
      locked,
      refresh: () => requested.mode === 'today' && snapshot.key === requestKeyFor(requested)
        ? isSupervisorFinalWindow(requested.selectedDate, new Date()) && !frozenSnapshotRef.current
          ? refreshSnapshot(requested, { final: true }) : Promise.resolve(snapshot)
        : refreshSnapshot(requested),
      generate: async () => {
        await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
        window.print()
      },
    })
    if (!result.ok) setError(result.reason === 'locked' ? t('attendance.operationalLockTitle') : t('attendance.outputRefreshFailed'))
  }

  const formatDate = (value) => new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(`${value}T12:00:00`))
  const statusLabel = (state) => ({ morning_recorded: t('absenceReport.morningRecorded'), morning_missing: t('absenceReport.morningMissing'), future: '—' }[state] || '—')
  const title = mode === 'today' ? t('absenceReport.todayTitle') : t('absenceReport.weekTitle')
  const range = mode === 'today' ? formatDate(selectedDate) : `${formatDate(dates[0])} → ${formatDate(dates.at(-1))}`
  const teams = snapshot.teams.filter(isOperationalAttendanceTeam)
  const reportLoading = loading || (!locked && snapshot.key !== requestKey)

  return <section>
    <style>{`@media print { @page { size: A4 ${mode === 'week' ? 'landscape' : 'portrait'}; margin: 12mm; } }`}</style>
    <div className="absence-report-screen-only mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-extrabold">{t('absenceReport.title')}</h2><p className="mt-1 text-sm text-(--muted)">{t('absenceReport.description')}</p></div>
      <Link className="btn-secondary" to="/attendance">{t('payroll.back')}</Link>
    </div>
    <div className="absence-report-screen-only surface-card mb-5 flex flex-wrap items-end gap-3 p-4">
      <div className="flex gap-2">{['today', 'week'].map((item) => <button key={item} type="button" className={mode === item ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode(item)}>{t(`absenceReport.${item}`)}</button>)}</div>
      <label className="min-w-44 text-sm font-bold">{t('attendance.date')}<input className="input-base mt-1" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value || currentBusinessDate())} /></label>
      <label className="min-w-52 text-sm font-bold">{t('attendance.team')}<select className="input-base mt-1" value={teamId} onChange={(event) => setTeamId(event.target.value)}><option value="">{t('absenceReport.allTeams')}</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <ReportWorkerSearch value={search} onChange={setSearch} label={t('reports.workerSearchLabel')} placeholder={t('reports.workerSearchPlaceholder')} />
      <button type="button" className="btn-primary" disabled={locked || reportLoading} onClick={printReport}>{t('absenceReport.print')}</button>
    </div>
    {error ? <p className="absence-report-screen-only alert alert--error mb-4">{error}</p> : null}

    {locked ? <div className="surface-card border border-amber-200 bg-amber-50 px-6 py-10 text-center" role="status">
      <h3 className="text-xl font-extrabold text-amber-900">{t('attendance.operationalLockTitle')}</h3>
      <p className="mt-2 text-sm font-semibold text-amber-800">{t('attendance.operationalLockDescription')}</p>
    </div> : <article className={`absence-report-print-root absence-report--${mode}`} dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <header className="absence-report-header">
        <p className="absence-report-company">{t('absenceReport.companyTitle')}</p>
        <h1>{title}</h1>
        <p>{range}</p>
        {isTodayView && <p className="text-sm text-(--muted)" role="status">{language === 'ar'
          ? frozen ? 'القائمة النهائية — تم اعتمادها الساعة 11:00' : 'تقرير مؤقت — سيتم اعتماد القائمة النهائية الساعة 11:00'
          : frozen ? 'Final list — cutoff 11:00' : 'Provisional report — final list at 11:00'}</p>}
        <p className="absence-report-generated">{t('absenceReport.generatedAt')}: {snapshot.fetchedAt?.toLocaleString(locale) || '—'}</p>
        {snapshot.fetchedAt ? <p className="absence-report-screen-only text-sm font-semibold text-(--muted)">{t('attendance.lastUpdated')}: <span dir="ltr">{kinshasaClock(snapshot.fetchedAt).time}</span></p> : null}
      </header>
      <div className="absence-report-summary">
        <div className="absence-summary-card absence-summary-card--teams"><span>{t('absenceReport.teamsWithMissingMorning')}</span><strong>{report.groups.length}</strong></div>
        <div className="absence-summary-card absence-summary-card--workers"><span>{t('absenceReport.missingMorningWorkers')}</span><strong>{report.missingMorningWorkers}</strong></div>
      </div>
      {reportLoading ? <p className="py-8 text-center">{t('common.loading')}</p> : report.groups.length === 0 ? <p className="absence-report-empty">{search.trim() ? t('common.noResults') : t('absenceReport.empty')}</p> : report.groups.map((group) => <section key={group.id} className={`absence-team-block ${group.workers.length <= 4 ? 'absence-team-block--small' : ''}`}>
        <div className="absence-team-heading"><h2>{group.name}</h2><p>{t('absenceReport.missingMorningCount')}: {group.workers.length}</p></div>
        {mode === 'today' ? <div className="absence-today-list">{group.workers.map((worker) => <div key={worker.id} className="absence-worker-card flex-wrap gap-2"><strong>{worker.name}</strong><span className="flex items-center gap-2" dir="ltr">{worker.employeeCode ? <span>{worker.employeeCode}</span> : null}<span>{compactBiometricId(worker.biometricId)}</span></span></div>)}</div> : <div className="absence-week-table-wrap"><table className="absence-week-table"><thead><tr><th>{t('attendance.worker')}</th><th>{t('workers.employeeCode')}</th><th>{t('reports.biometricId')}</th>{dates.map((date) => <th key={date}>{new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(`${date}T12:00:00`))}</th>)}<th>{t('absenceReport.missingMorningTotal')}</th></tr></thead><tbody>{group.workers.map((worker) => <tr key={worker.id}><td>{worker.name}</td><td>{worker.employeeCode || '—'}</td><td dir="ltr">{worker.biometricId}</td>{worker.states.map((day) => <td key={day.date} className={`absence-state absence-state--${day.state}`}>{statusLabel(day.state)}</td>)}<td className="absence-total-cell">{worker.missingMorningDays}</td></tr>)}</tbody></table></div>}
      </section>)}
    </article>}
  </section>
}
