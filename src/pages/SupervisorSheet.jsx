import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getErrorMessage } from '../api/axios'
import { getWorkerBiometricSearchIndexRequest } from '../api/biometricMappingApi'
import { getTeamsRequest } from '../api/teamsApi'
import { getWorkersRequest } from '../api/workersApi'
import { useTranslation } from '../i18n/LanguageContext'
import { kinshasaClock } from '../utils/attendanceOperationalGate'
import { buildSupervisorSheet, supervisorSheetTeams } from '../utils/supervisorSheet'

const RESULTS = ['A', 'P', 'O', 'M']
const asArray = (value) => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []

export default function SupervisorSheet() {
  const { t, language } = useTranslation()
  const [date] = useState(() => kinshasaClock().date)
  const [workers, setWorkers] = useState([])
  const [teams, setTeams] = useState([])
  const [mappings, setMappings] = useState([])
  const [teamId, setTeamId] = useState('')
  const [results, setResults] = useState({})
  const [printMode, setPrintMode] = useState('blank')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([getWorkersRequest({ includePayrollProfiles: false }), getTeamsRequest(), getWorkerBiometricSearchIndexRequest()])
      .then(([workersResult, teamsResult, mappingsResult]) => {
        if (!active) return
        setWorkers(asArray(workersResult.data))
        setTeams(asArray(teamsResult.data))
        setMappings(asArray(mappingsResult.data))
      })
      .catch((requestError) => { if (active) setError(getErrorMessage(requestError)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const availableTeams = useMemo(() => supervisorSheetTeams(teams), [teams])
  const sheet = useMemo(() => buildSupervisorSheet({ workers, teams, mappings, date, teamId }), [workers, teams, mappings, date, teamId])
  const selectedTeamName = availableTeams.find((team) => String(team.id) === teamId)?.name || t('supervisorSheet.allTeams')
  const formattedDate = new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : language === 'fr' ? 'fr-FR' : 'en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Africa/Kinshasa',
  }).format(new Date(`${date}T12:00:00Z`))

  const printSheet = (mode) => {
    setPrintMode(mode)
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()))
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
      <button type="button" className="btn-secondary" disabled={loading || Boolean(error) || !sheet.workerCount} onClick={() => printSheet('blank')}>{t('supervisorSheet.printBlank')}</button>
      <button type="button" className="btn-primary" disabled={loading || Boolean(error) || !sheet.workerCount} onClick={() => printSheet('results')}>{t('supervisorSheet.printResults')}</button>
      <button type="button" className="btn-secondary" onClick={() => { setResults({}); setPrintMode('blank') }}>{t('supervisorSheet.clearResults')}</button>
    </div>
    {error ? <p role="alert" className="alert alert--error mb-4">{error}</p> : null}
    <article className="absence-report-print-root" dir={language === 'ar' ? 'rtl' : 'ltr'} data-print-mode={printMode}>
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
            <td>{worker.name}</td><td dir="ltr">{worker.employeeCode}</td><td dir="ltr">{worker.biometricId}</td>
            <td><div className="supervisor-sheet-screen-only supervisor-sheet-choices" role="group" aria-label={`${worker.name} ${t('supervisorSheet.result')}`}>
              {RESULTS.map((value) => <button key={value} type="button" className="supervisor-sheet-choice" aria-pressed={results[worker.id] === value} title={t(`supervisorSheet.${value}`)} onClick={() => setResults((current) => ({ ...current, [worker.id]: value }))}>{value}</button>)}
            </div><span className="supervisor-sheet-print-only" data-testid={`printed-result-${worker.id}`}>{printMode === 'blank' ? '________' : results[worker.id] || '—'}</span></td>
          </tr>)}</tbody>
        </table></div>
      </section>) : null}
    </article>
  </section>
}
