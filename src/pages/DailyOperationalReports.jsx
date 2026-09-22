import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getCurrentAttendanceEvidenceRequest } from '../api/currentAttendanceEvidenceApi'
import { getErrorMessage } from '../api/axios'
import { getBiometricMappingsRequest } from '../api/biometricMappingApi'
import { getWorkersRequest } from '../api/workersApi'
import { useTranslation } from '../i18n/LanguageContext'
import { kinshasaClock } from '../utils/attendanceOperationalGate'
import { attendanceStatusKey, buildDailyAttendanceExceptions, buildDailyOvertimeReport, yesterdayFromBusinessDate } from '../utils/dailyOperationalReports'
import { formatEveningOvertimeMinutes } from '../utils/weeklyPayrollOvertime'

const yesterday = () => yesterdayFromBusinessDate(kinshasaClock().date)
const formatTime = (value) => value && value !== '—' ? <span dir="ltr">{String(value).slice(0, 5)}</span> : '—'

export default function DailyOperationalReports({ type }) {
  const { t, language } = useTranslation()
  const [selectedDate, setSelectedDate] = useState(yesterday)
  const [attendance, setAttendance] = useState([])
  const [evidence, setEvidence] = useState([])
  const [mappings, setMappings] = useState([])
  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const overtime = type === 'overtime'
  const title = t(overtime ? 'reports.dailyOvertimeTitle' : 'reports.dailyExceptionsTitle')
  const locale = language === 'ar' ? 'ar-EG' : language === 'fr' ? 'fr-FR' : 'en-GB'
  const formattedDate = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${selectedDate}T12:00:00`))

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [attendanceResult, workersResult, mappingsResult, evidenceResult] = await Promise.all([
        getAttendanceRequest({ date: selectedDate, staff_classification: 'normal', paginate: true }),
        getWorkersRequest(),
        getBiometricMappingsRequest(),
        getCurrentAttendanceEvidenceRequest(selectedDate),
      ])
      setAttendance(attendanceResult.data || [])
      setWorkers(workersResult.data || [])
      setMappings(mappingsResult.data || [])
      setEvidence(evidenceResult.data || [])
    } catch (requestError) { setError(getErrorMessage(requestError)); setAttendance([]); setEvidence([]); setWorkers([]); setMappings([]) }
    finally { setLoading(false) }
  }, [selectedDate])

  useEffect(() => { load() }, [load])

  const rows = useMemo(() => (overtime
    ? buildDailyOvertimeReport({ attendance, mappings, date: selectedDate })
    : buildDailyAttendanceExceptions({ workers, attendance, evidence, mappings, date: selectedDate })), [attendance, evidence, mappings, overtime, selectedDate, workers])
  const label = (status) => t(`attendance.${({ in_progress: 'inProgress', half_day: 'halfDay', not_recorded: 'notRecorded' }[status] || status)}`)

  return <section>
    <style>{'@media print { @page { size: A4 landscape; margin: 12mm; } }'}</style>
    <div className="daily-report-screen-only mb-4 flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-xl font-extrabold">{title}</h2><p className="mt-1 text-sm text-(--muted)">{t('reports.dailyReportDescription')}</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 text-sm font-bold">{t('attendance.date')}<input className="input-base mt-1" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value || yesterday())} /></label>
        <button type="button" className="btn-primary" disabled={loading} onClick={() => window.print()}>{t('reports.print')}</button>
      </div>
    </div>
    {error ? <p className="daily-report-screen-only alert alert--error mb-4">{error}</p> : null}
    <article className="daily-report-print-root" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <header className="daily-report-header"><p>{t('app.name')}</p><h1>{title}</h1><p>{formattedDate}</p></header>
      {loading ? <p className="py-8 text-center">{t('common.loading')}</p> : rows.length === 0 ? <p className="daily-report-empty">{t('reports.noData')}</p> : <div className="daily-report-table-wrap"><table className="daily-report-table"><thead><tr><th>#</th><th>{t('reports.worker')}</th><th>{t('reports.biometricId')}</th><th>{t('reports.team')}</th>{!overtime && <th>{t('attendance.status')}</th>}<th>{t('attendance.checkIn')}</th><th>{t(overtime ? 'attendance.checkOut' : 'reports.lastPunch')}</th>{overtime && <th>{t('reports.overtimeHours')}</th>}<th>{t('attendance.notes')}</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || `${row.worker}-${index}`}><td>{index + 1}</td><td className="daily-report-worker">{row.worker}</td><td dir="ltr">{row.biometricId}</td><td>{row.team}</td>{!overtime && <td>{label(attendanceStatusKey(row))}</td>}<td>{formatTime(row.checkIn)}</td><td>{formatTime(row.checkOut === '—' ? row.lastPunch : row.checkOut)}</td>{overtime && <td dir="ltr">{formatEveningOvertimeMinutes(row.overtimeMinutes)}</td>}<td>{row.note}</td></tr>)}</tbody></table></div>}
    </article>
  </section>
}
