import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAttendanceRequest } from '../api/attendanceApi.js'
import { getAttendanceEvidenceRangeRequest } from '../api/currentAttendanceEvidenceApi.js'
import { getMorningVerificationStatusRequest } from '../api/attendanceAgentApi.js'
import { getBiometricMappingsRequest } from '../api/biometricMappingApi.js'
import { getWorkersRequest } from '../api/workersApi.js'
import { getErrorMessage } from '../api/axios.js'
import DailyAttendanceSummary from '../components/Attendance/DailyAttendanceSummary.jsx'
import { useTranslation } from '../i18n/LanguageContext.jsx'
import { kinshasaClock } from '../utils/attendanceOperationalGate.js'
import { attendanceStatusKey } from '../utils/dailyOperationalReports.js'
import { adjacentOperationalDate, dailyReportData, operationalWeekDates } from '../utils/dailyReportCenter.js'
import { formatEveningOvertimeMinutes } from '../utils/weeklyPayrollOvertime.js'
import { EMPTY_OVERTIME_TEAMS, useOvertimeReportSettings } from '../utils/useOvertimeReportSettings.js'

const words = {
  ar: { title: 'التقارير اليومية', week: 'الأسبوع الحالي', open: 'عرض تقرير اليوم', exceptions: 'تقرير الحضور والاستثناءات', overtime: 'تقرير الوقت الإضافي', absent: 'غائب', halfDay: 'نصف يوم', notRecorded: 'دون سجل', exceptionCount: 'استثناءات الحضور', overtimeWorkers: 'عمال الإضافي', overtimeHours: 'ساعات الإضافي', worker: 'العامل', team: 'الفريق', status: 'الحالة', in: 'الدخول', out: 'الخروج', last: 'آخر بصمة', note: 'ملاحظة', biometric: 'رقم جهاز البصمة', printAttendance: 'طباعة تقرير الحضور', printOvertime: 'طباعة تقرير الوقت الإضافي', printAll: 'طباعة تقرير اليوم كاملًا', previous: 'اليوم السابق', next: 'اليوم التالي', back: 'العودة إلى الأسبوع', pending: 'تقرير اليوم قد لا يكون نهائيًا: التحقق الصباحي النهائي لم يكتمل.', upcoming: 'يوم قادم', noRows: 'لا توجد نتائج', refresh: 'تحديث', printed: 'وقت الطباعة', invalid: 'تاريخ غير صالح', saturday: 'السبت', sunday: 'الأحد' },
  en: { title: 'Daily Reports', week: 'Current week', open: 'View day report', exceptions: 'Attendance and Exceptions', overtime: 'Overtime Report', absent: 'Absent', halfDay: 'Half day', notRecorded: 'No record', exceptionCount: 'Attendance exceptions', overtimeWorkers: 'Overtime workers', overtimeHours: 'Overtime hours', worker: 'Worker', team: 'Team', status: 'Status', in: 'Check-in', out: 'Check-out', last: 'Last punch', note: 'Note', biometric: 'Biometric ID', printAttendance: 'Print attendance', printOvertime: 'Print overtime', printAll: 'Print full day', previous: 'Previous day', next: 'Next day', back: 'Back to week', pending: 'Today’s report may not be final: morning verification is not complete.', upcoming: 'Upcoming day', noRows: 'No results', refresh: 'Refresh', printed: 'Printed at', invalid: 'Invalid date', saturday: 'Saturday', sunday: 'Sunday' },
  fr: { title: 'Rapports quotidiens', week: 'Semaine en cours', open: 'Voir le rapport du jour', exceptions: 'Présence et anomalies', overtime: 'Heures supplémentaires', absent: 'Absent', halfDay: 'Demi-journée', notRecorded: 'Sans dossier', exceptionCount: 'Anomalies de présence', overtimeWorkers: 'Travailleurs en heures sup.', overtimeHours: 'Heures supplémentaires', worker: 'Travailleur', team: 'Équipe', status: 'Statut', in: 'Entrée', out: 'Sortie', last: 'Dernier pointage', note: 'Note', biometric: 'ID biométrique', printAttendance: 'Imprimer la présence', printOvertime: 'Imprimer les heures sup.', printAll: 'Imprimer la journée', previous: 'Jour précédent', next: 'Jour suivant', back: 'Retour à la semaine', pending: 'Le rapport du jour peut être provisoire : la vérification du matin n’est pas terminée.', upcoming: 'Jour à venir', noRows: 'Aucun résultat', refresh: 'Actualiser', printed: 'Imprimé à', invalid: 'Date invalide', saturday: 'Samedi', sunday: 'Dimanche' },
}

const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date
const displayDate = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
const displayTime = (value) => value && value !== '—' ? String(value).slice(0, 5) : '—'
const weekday = (date, language) => new Intl.DateTimeFormat(language === 'ar' ? 'ar' : language === 'fr' ? 'fr' : 'en', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))

function ReportTable({ rows, overtime, labels, t }) {
  return rows.length ? <div className="daily-center-table-wrap"><table className="daily-center-table"><thead><tr><th>{labels.worker}</th><th>{labels.biometric}</th><th>{labels.team}</th>{!overtime && <th>{labels.status}</th>}<th>{labels.in}</th><th>{labels.out}</th>{!overtime && <th>{labels.last}</th>}{overtime && <th>{labels.overtimeHours}</th>}<th>{labels.note}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="font-bold">{row.worker}</td><td dir="ltr">{row.biometricId}</td><td>{row.team}</td>{!overtime && <td>{t(`attendance.${({ half_day: 'halfDay', in_progress: 'inProgress', not_recorded: 'notRecorded' }[attendanceStatusKey(row)] || attendanceStatusKey(row))}`)}</td>}<td dir="ltr">{displayTime(row.checkIn)}</td><td dir="ltr">{displayTime(row.checkOut)}</td>{!overtime && <td dir="ltr">{displayTime(row.lastPunch)}</td>}{overtime && <td dir="ltr">{formatEveningOvertimeMinutes(row.overtimeMinutes)}</td>}<td>{row.note}</td></tr>)}</tbody></table></div> : <p className="py-6 text-center text-(--muted)">{labels.noRows}</p>
}

export default function DailyReportsCenter() {
  const { date } = useParams()
  const { language, t } = useTranslation()
  const labels = words[language] || words.ar
  const today = kinshasaClock().date
  const days = useMemo(() => operationalWeekDates(today), [today])
  const [source, setSource] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const overtimeSettings = useOvertimeReportSettings(`${date || today}:${reload}`)
  const overtimeTeamIds = overtimeSettings.loading ? EMPTY_OVERTIME_TEAMS : overtimeSettings.settings.team_ids
  const [verification, setVerification] = useState(null)
  const [printMode, setPrintMode] = useState('all')
  const [printTime, setPrintTime] = useState('')
  const isDay = date != null
  const valid = !isDay || (validDate(date) && new Date(`${date}T12:00:00Z`).getUTCDay() !== 0)

  useEffect(() => {
    if (!valid) { setLoading(false); return }
    let live = true
    const from = isDay ? date : days[0]
    const to = isDay ? date : days[5]
    setLoading(true); setError(''); setSource(null); setVerification(null)
    Promise.all([
      getAttendanceRequest({ date_from: from, date_to: to, staff_classification: 'normal', paginate: true }),
      getWorkersRequest(), getBiometricMappingsRequest(), getAttendanceEvidenceRangeRequest(from, to),
      today >= from && today <= to ? getMorningVerificationStatusRequest(today).catch(() => null) : Promise.resolve(null),
    ]).then(([attendance, workers, mappings, evidence, morning]) => {
      if (live) { setSource({ attendance: attendance.data || [], workers: workers.data || [], mappings: mappings.data || [], evidence: evidence.data || [] }); setVerification(morning) }
    }).catch((cause) => { if (live) setError(getErrorMessage(cause)) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [date, isDay, reload, valid, today, days])

  const reports = useMemo(() => source ? (isDay ? (date <= today ? { [date]: dailyReportData({ date, businessDate: today, ...source, overtimeTeamIds }) } : {}) : Object.fromEntries(days.filter((day) => day <= today).map((day) => [day, dailyReportData({ date: day, businessDate: today, ...source, overtimeTeamIds })]))) : {}, [source, isDay, date, days, today, overtimeTeamIds])
  const report = reports[date]
  const print = (mode) => {
    setPrintMode(mode)
    setPrintTime(new Intl.DateTimeFormat(language === 'ar' ? 'ar' : language === 'fr' ? 'fr' : 'en', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Kinshasa' }).format(new Date()))
    window.setTimeout(() => window.print(), 0)
  }
  useEffect(() => {
    const reset = () => setPrintMode('all')
    window.addEventListener('afterprint', reset)
    return () => window.removeEventListener('afterprint', reset)
  }, [])

  if (!valid) return <p className="alert alert--error">{labels.invalid}</p>
  return <section className="daily-center" dir={language === 'ar' ? 'rtl' : 'ltr'} data-print-mode={printMode}>
    <style>{'@media print { @page { size: A4 landscape; margin: 12mm; } }'}</style>
    <header className="daily-center-screen-only mb-6 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-extrabold">{labels.title}</h1><p className="mt-1 text-(--muted)">{isDay ? `${weekday(date, language)} ${displayDate(date)}` : `${labels.week}: ${displayDate(days[0])} → ${displayDate(days[5])}`}</p></div><button type="button" className="btn-primary" onClick={() => setReload((value) => value + 1)} disabled={loading}>{labels.refresh}</button></header>
    {error && <p className="alert alert--error mb-4">{error}</p>}
    {loading && <p className="py-8 text-center">{t('common.loading')}</p>}
    {!loading && !error && !isDay && <>{days.includes(today) && verification?.latestAttempt?.status !== 'complete' && <p className="alert alert--warning mb-5">{labels.pending}</p>}<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{days.map((day) => {
      const counts = reports[day]?.counts
      return <article key={day} className="rounded-2xl border border-(--border) bg-white p-5 shadow-sm"><h2 className="text-lg font-extrabold">{weekday(day, language)} <span dir="ltr">{displayDate(day)}</span></h2>{counts ? <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm"><dt>{labels.exceptionCount}</dt><dd className="font-bold">{counts.exceptions}</dd><dt>{labels.absent}</dt><dd className="font-bold">{counts.absent}</dd><dt>{labels.halfDay}</dt><dd className="font-bold">{counts.halfDay}</dd><dt>{labels.notRecorded}</dt><dd className="font-bold">{counts.notRecorded}</dd><dt>{labels.overtimeWorkers}</dt><dd className="font-bold">{counts.overtimeWorkers}</dd><dt>{labels.overtimeHours}</dt><dd className="font-bold">{formatEveningOvertimeMinutes(counts.overtimeMinutes)}</dd></dl> : <p className="mt-4 text-sm text-(--muted)">{labels.upcoming}</p>}<Link className="btn-primary mt-5 inline-flex" to={`/reports/daily/${day}`}>{labels.open}</Link></article>
    })}</div></>}
    {!loading && !error && isDay && <div className="daily-center-screen-only mb-5 flex flex-wrap gap-2"><Link className="btn-primary" to={`/reports/daily/${adjacentOperationalDate(date, -1)}`}>{labels.previous}</Link><Link className="btn-primary" to="/reports/daily">{labels.back}</Link><Link className="btn-primary" to={`/reports/daily/${adjacentOperationalDate(date, 1)}`}>{labels.next}</Link></div>}
    {!loading && !error && isDay && date > today && <p className="alert alert--warning mb-5">{labels.upcoming}</p>}
    {!loading && !error && isDay && report && <>
      {date === today && verification?.latestAttempt?.status !== 'complete' && <p className="daily-center-screen-only alert alert--warning mb-5">{labels.pending}</p>}
      <DailyAttendanceSummary key={date} rows={report.monitoringRows} counts={report.monitoringCounts} labels={labels} t={t} />
      <div className="daily-center-screen-only mb-6 grid gap-3 sm:grid-cols-3">{[[labels.exceptionCount, report.counts.exceptions], [labels.overtimeWorkers, report.counts.overtimeWorkers], [labels.overtimeHours, formatEveningOvertimeMinutes(report.counts.overtimeMinutes)]].map(([name, value]) => <div className="rounded-xl border border-(--border) bg-white p-3" key={name}><p className="text-xs text-(--muted)">{name}</p><p className="mt-1 text-xl font-extrabold">{value}</p></div>)}</div>
      <div className="daily-center-screen-only mb-5 flex flex-wrap gap-2"><button type="button" className="btn-primary" onClick={() => print('attendance')}>{labels.printAttendance}</button><button type="button" className="btn-primary" onClick={() => print('overtime')}>{labels.printOvertime}</button><button type="button" className="btn-primary" onClick={() => print('all')}>{labels.printAll}</button></div>
      <div className="daily-center-print-root"><header className="daily-center-print-header"><p>{t('app.name')}</p><h1>{labels.title} — {weekday(date, language)} {displayDate(date)}</h1><p>{labels.printed}: {printTime}</p></header>
        <article className="daily-center-report daily-center-attendance"><h2>{labels.exceptions} ({report.counts.exceptions})</h2><ReportTable rows={report.exceptions} labels={labels} t={t} /></article>
        <article className="daily-center-report daily-center-overtime"><h2>{labels.overtime} ({report.counts.overtimeWorkers})</h2><ReportTable rows={report.overtime} overtime labels={labels} t={t} /></article>
      </div>
    </>}
  </section>
}
