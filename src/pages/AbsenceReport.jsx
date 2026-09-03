import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import { getTeamsRequest } from '../api/teamsApi'
import { getWorkersRequest } from '../api/workersApi'
import { useTranslation } from '../i18n/LanguageContext'
import {
  ATTENDANCE_REFRESH_INTERVAL_MS,
  isAttendancePageLocked,
  kinshasaClock,
  prepareAttendanceOutput,
} from '../utils/attendanceOperationalGate'
import { absenceWeekDates, buildAbsenceReport, createAbsenceReportRefreshCoordinator } from '../utils/absenceReport'

const asArray = (value) => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []
const currentBusinessDate = () => kinshasaClock().date
const requestKeyFor = ({ mode, selectedDate }) => `${mode}:${selectedDate}`
const datesFor = ({ mode, selectedDate }) => mode === 'week' ? absenceWeekDates(selectedDate) : [selectedDate]

export default function AbsenceReport() {
  const { t, language } = useTranslation()
  const [mode, setMode] = useState('today')
  const [selectedDate, setSelectedDate] = useState(currentBusinessDate)
  const [teamId, setTeamId] = useState('')
  const [snapshot, setSnapshot] = useState({ key: '', workers: [], teams: [], attendance: [], fetchedAt: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const requestRef = useRef({ mode, selectedDate })
  const refreshCoordinatorRef = useRef(null)
  const mountedRef = useRef(true)

  requestRef.current = { mode, selectedDate }
  if (!refreshCoordinatorRef.current) refreshCoordinatorRef.current = createAbsenceReportRefreshCoordinator()
  const businessDate = kinshasaClock(now).date
  const requestKey = requestKeyFor(requestRef.current)
  const dates = useMemo(() => datesFor({ mode, selectedDate }), [mode, selectedDate])
  const isTodayView = mode === 'today' && selectedDate === businessDate
  const locked = mode === 'today' && isAttendancePageLocked({ selectedDate, now })
  const locale = language === 'ar' ? 'ar-EG' : language === 'fr' ? 'fr-FR' : 'en-GB'

  const refreshSnapshot = useCallback(async (requested = requestRef.current) => {
    const key = requestKeyFor(requested)
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
      return await refreshCoordinatorRef.current(key, async () => {
        const [workersResult, teamsResult, attendanceResult] = await Promise.all([
          getWorkersRequest(),
          getTeamsRequest(),
          getAttendanceRequest(attendanceParams),
        ])
        const nextSnapshot = {
          key,
          workers: asArray(workersResult.data),
          teams: asArray(teamsResult.data).filter((team) => team.is_active !== false),
          attendance: asArray(attendanceResult.data),
          fetchedAt: new Date(),
        }
        if (mountedRef.current && requestKeyFor(requestRef.current) === key) setSnapshot(nextSnapshot)
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
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (locked) return
    refreshSnapshot(requestRef.current).catch(() => {})
  }, [locked, mode, refreshSnapshot, selectedDate])

  useEffect(() => {
    if (!isTodayView || locked) return undefined
    const timer = window.setInterval(() => refreshSnapshot(requestRef.current).catch(() => {}), ATTENDANCE_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [isTodayView, locked, refreshSnapshot])

  useEffect(() => {
    const refreshAfterFocus = () => {
      const requested = requestRef.current
      if (document.visibilityState !== 'hidden'
        && requested.mode === 'today'
        && requested.selectedDate === currentBusinessDate()
        && !isAttendancePageLocked({ selectedDate: requested.selectedDate, now: new Date() })) {
        refreshSnapshot(requested).catch(() => {})
      }
    }
    window.addEventListener('focus', refreshAfterFocus)
    document.addEventListener('visibilitychange', refreshAfterFocus)
    return () => {
      window.removeEventListener('focus', refreshAfterFocus)
      document.removeEventListener('visibilitychange', refreshAfterFocus)
    }
  }, [refreshSnapshot])

  const report = useMemo(() => buildAbsenceReport({
    workers: snapshot.key === requestKey ? snapshot.workers : [],
    attendance: snapshot.key === requestKey ? snapshot.attendance : [],
    mode,
    selectedDate,
    businessDate,
    teamId,
  }), [businessDate, mode, requestKey, selectedDate, snapshot, teamId])

  const printReport = async () => {
    setError('')
    const requested = { ...requestRef.current }
    const result = await prepareAttendanceOutput({
      locked,
      refresh: () => refreshSnapshot(requested),
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
  const teams = snapshot.teams
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
        <p className="absence-report-generated">{t('absenceReport.generatedAt')}: {snapshot.fetchedAt?.toLocaleString(locale) || '—'}</p>
        {snapshot.fetchedAt ? <p className="absence-report-screen-only text-sm font-semibold text-(--muted)">{t('attendance.lastUpdated')}: <span dir="ltr">{kinshasaClock(snapshot.fetchedAt).time}</span></p> : null}
      </header>
      <div className="absence-report-summary">
        <div className="absence-summary-card absence-summary-card--teams"><span>{t('absenceReport.teamsWithMissingMorning')}</span><strong>{report.groups.length}</strong></div>
        <div className="absence-summary-card absence-summary-card--workers"><span>{t('absenceReport.missingMorningWorkers')}</span><strong>{report.missingMorningWorkers}</strong></div>
      </div>
      {reportLoading ? <p className="py-8 text-center">{t('common.loading')}</p> : report.groups.length === 0 ? <p className="absence-report-empty">{t('absenceReport.empty')}</p> : report.groups.map((group) => <section key={group.id} className={`absence-team-block ${group.workers.length <= 4 ? 'absence-team-block--small' : ''}`}>
        <div className="absence-team-heading"><h2>{group.name}</h2><p>{t('absenceReport.missingMorningCount')}: {group.workers.length}</p></div>
        {mode === 'today' ? <div className="absence-today-list">{group.workers.map((worker) => <div key={worker.id} className="absence-worker-card"><strong>{worker.name}</strong>{worker.employeeCode ? <span>{worker.employeeCode}</span> : null}</div>)}</div> : <div className="absence-week-table-wrap"><table className="absence-week-table"><thead><tr><th>{t('attendance.worker')}</th><th>{t('workers.employeeCode')}</th>{dates.map((date) => <th key={date}>{new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(`${date}T12:00:00`))}</th>)}<th>{t('absenceReport.missingMorningTotal')}</th></tr></thead><tbody>{group.workers.map((worker) => <tr key={worker.id}><td>{worker.name}</td><td>{worker.employeeCode || '—'}</td>{worker.states.map((day) => <td key={day.date} className={`absence-state absence-state--${day.state}`}>{statusLabel(day.state)}</td>)}<td className="absence-total-cell">{worker.missingMorningDays}</td></tr>)}</tbody></table></div>}
      </section>)}
    </article>}
  </section>
}
