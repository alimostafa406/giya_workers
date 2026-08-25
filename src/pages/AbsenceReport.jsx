import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import { getTeamsRequest } from '../api/teamsApi'
import { getWorkersRequest } from '../api/workersApi'
import { useTranslation } from '../i18n/LanguageContext'
import { absenceWeekDates, attendanceBusinessDate, buildAbsenceReport } from '../utils/absenceReport'

const asArray = (value) => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []

export default function AbsenceReport() {
  const { t, language } = useTranslation()
  const [mode, setMode] = useState('today')
  const [teamId, setTeamId] = useState('')
  const [workers, setWorkers] = useState([])
  const [teams, setTeams] = useState([])
  const [attendance, setAttendance] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [generatedAt, setGeneratedAt] = useState(new Date())
  const businessDate = attendanceBusinessDate()
  const dates = useMemo(() => mode === 'week' ? absenceWeekDates(businessDate) : [businessDate], [businessDate, mode])
  const locale = language === 'ar' ? 'ar-EG' : language === 'fr' ? 'fr-FR' : 'en-GB'

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const attendanceParams = mode === 'week'
          ? { date_from: dates[0], date_to: dates.at(-1), staff_classification: 'normal' }
          : { date: businessDate, staff_classification: 'normal' }
        const [workersResult, teamsResult, attendanceResult] = await Promise.all([
          getWorkersRequest(), getTeamsRequest(), getAttendanceRequest(attendanceParams),
        ])
        if (!active) return
        setWorkers(asArray(workersResult.data))
        setTeams(asArray(teamsResult.data).filter((team) => team.is_active !== false))
        setAttendance(asArray(attendanceResult.data))
        setGeneratedAt(new Date())
      } catch (requestError) {
        if (active) setError(getErrorMessage(requestError))
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [businessDate, dates, mode])

  const report = useMemo(() => buildAbsenceReport({ workers, attendance, mode, businessDate, teamId }), [attendance, businessDate, mode, teamId, workers])
  const formatDate = (value) => new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(`${value}T12:00:00`))
  const statusLabel = (state) => ({ absent: t('attendance.absent'), present: t('attendance.present'), half_day: t('attendance.halfDay'), review: t('absenceReport.needsReview'), not_recorded: t('dashboard.notRecorded'), future: '—', not_applicable: '—' }[state] || '—')
  const title = mode === 'today' ? t('absenceReport.todayTitle') : t('absenceReport.weekTitle')
  const range = mode === 'today' ? formatDate(businessDate) : `${formatDate(dates[0])} → ${formatDate(dates.at(-1))}`

  return <section>
    <style>{`@media print { @page { size: A4 ${mode === 'week' ? 'landscape' : 'portrait'}; margin: 12mm; } }`}</style>
    <div className="absence-report-screen-only mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-extrabold">{t('absenceReport.title')}</h2><p className="mt-1 text-sm text-(--muted)">{t('absenceReport.description')}</p></div>
      <Link className="btn-secondary" to="/attendance">{t('payroll.back')}</Link>
    </div>
    <div className="absence-report-screen-only surface-card mb-5 flex flex-wrap items-end gap-3 p-4">
      <div className="flex gap-2">{['today', 'week'].map((item) => <button key={item} type="button" className={mode === item ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode(item)}>{t(`absenceReport.${item}`)}</button>)}</div>
      <label className="min-w-52 text-sm font-bold">{t('attendance.team')}<select className="input-base mt-1" value={teamId} onChange={(event) => setTeamId(event.target.value)}><option value="">{t('absenceReport.allTeams')}</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <button type="button" className="btn-primary" disabled={loading} onClick={() => window.print()}>{t('absenceReport.print')}</button>
    </div>
    {error ? <p className="absence-report-screen-only alert alert--error mb-4">{error}</p> : null}

    <article className={`absence-report-print-root absence-report--${mode}`} dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <header className="absence-report-header">
        <p className="absence-report-company">{t('absenceReport.companyTitle')}</p>
        <h1>{title}</h1>
        <p>{range}</p>
        <p className="absence-report-generated">{t('absenceReport.generatedAt')}: {generatedAt.toLocaleString(locale)}</p>
      </header>
      <div className="absence-report-summary">
        <div><span>{t('absenceReport.teamsWithAbsence')}</span><strong>{report.groups.length}</strong></div>
        <div><span>{t('absenceReport.absentWorkers')}</span><strong>{report.absentWorkers}</strong></div>
        {mode === 'week' ? <div><span>{t('absenceReport.confirmedAbsenceDays')}</span><strong>{report.absenceDays}</strong></div> : null}
      </div>
      {loading ? <p className="py-8 text-center">{t('common.loading')}</p> : report.groups.length === 0 ? <p className="absence-report-empty">{t('absenceReport.empty')}</p> : report.groups.map((group) => <section key={group.id} className={`absence-team-block ${group.workers.length <= 4 ? 'absence-team-block--small' : ''}`}>
        <div className="absence-team-heading"><h2>{group.name}</h2><p>{t('absenceReport.absentCount')}: {group.workers.length}</p></div>
        {mode === 'today' ? <div className="absence-today-list">{group.workers.map((worker) => <div key={worker.id} className="absence-worker-card"><strong>{worker.name}</strong>{worker.employeeCode ? <span>{worker.employeeCode}</span> : null}</div>)}</div> : <table className="absence-week-table"><thead><tr><th>{t('attendance.worker')}</th><th>{t('workers.employeeCode')}</th>{dates.map((date) => <th key={date}>{new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(`${date}T12:00:00`))}</th>)}<th>{t('absenceReport.absenceTotal')}</th></tr></thead><tbody>{group.workers.map((worker) => <tr key={worker.id}><td>{worker.name}</td><td>{worker.employeeCode || '—'}</td>{worker.states.map((day) => <td key={day.date} className={day.state === 'absent' ? 'absence-state-absent' : ''}>{statusLabel(day.state)}</td>)}<td className="absence-total-cell">{worker.absenceDays}</td></tr>)}</tbody></table>}
      </section>)}
    </article>
  </section>
}
