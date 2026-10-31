import { useEffect, useMemo, useRef, useState } from 'react'
import { getPayrollOperationsDataRequest } from '../api/payrollOperationsApi'
import { getErrorMessage } from '../api/axios'
import { mondayFor, weeklyDates } from '../utils/payrollCalculations'
import { formatPayrollMoney } from '../utils/payrollCurrency'
import { printTeamReport, teamWeeklyReport } from '../utils/teamWeeklyReport'
import { weeklyPayrollDisplayStatus } from '../utils/weeklyPayrollOvertime'
import { useTranslation } from '../i18n/LanguageContext'
import './TeamWeeklyReport.css'
import OutsideWorkTeamMarkers from '../components/Reports/OutsideWorkTeamMarkers'
import { teamReportDayOvertime } from '../utils/teamWeeklyReportDayOvertime'
import PayableAttendanceDay from '../components/Payroll/PayableAttendanceDay'

const money = (value, currency) => value == null ? '—' : formatPayrollMoney(value, { currency, paymentType: 'weekly' })
const hours = (minutes) => `${Number((minutes / 60).toFixed(4))} h`
const dateLabel = (date) => `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const headerKeys = ['worker', 'code', ...dayKeys, 'workDays', 'absentDays', 'manualHours', 'basePay', 'overtimeAmount', 'totalPay']
const summaryKeys = ['team', 'workers', 'totalWorkDays', 'totalAbsentDays', 'totalManualHours', 'totalOvertimeAmount', 'totalBasePay', 'totalPay']
const dayStatus = (detail, t) => ({ present: t('attendance.present'), absent: t('attendance.absent'), half_day: '½', neutral: '—' })[weeklyPayrollDisplayStatus(detail)]
function DayCell({ line, date, t }) {
  const detail = line.details?.find(detail => detail.date === date)
  const duration = teamReportDayOvertime(line, date)
  return <td className="team-report-day" style={duration ? { whiteSpace: 'normal' } : undefined}>
    <PayableAttendanceDay line={line} date={date} statusText={dayStatus(detail, t)} />
  </td>
}
function Amounts({ totals, field }) { return Object.entries(totals.currencies).map(([currency, values]) => <bdi dir="ltr" className="block" key={currency}>{money(values[field], currency)}</bdi>) }
function TeamTotalRow({ totals }) { const { t } = useTranslation(); return <tr className="team-report-total-row"><th scope="row">{t('teamWeeklyReport.teamTotal')}</th><td>{totals.workers} {t('teamWeeklyReport.workersWord')}</td>{dayKeys.map((day) => <td key={day}>—</td>)}<td>{totals.workDays}</td><td>{totals.absentDays}</td><td><bdi dir="ltr">{hours(totals.minutes)}</bdi></td><td><Amounts totals={totals} field="basePay" /></td><td><Amounts totals={totals} field="overtimeAmount" /></td><td><Amounts totals={totals} field="finalAmount" /></td></tr> }
function SummaryRow({ name, totals }) { return <tr><th>{name}</th><td>{totals.workers}</td><td>{totals.workDays}</td><td>{totals.absentDays}</td><td><bdi dir="ltr">{hours(totals.minutes)}</bdi></td><td><Amounts totals={totals} field="overtimeAmount" /></td><td><Amounts totals={totals} field="basePay" /></td><td><strong><Amounts totals={totals} field="finalAmount" /></strong></td></tr> }
export default function TeamWeeklyReport() {
  const { t, language, direction } = useTranslation()
  const l = (key) => t(`teamWeeklyReport.${key}`)
  const groupName = (group) => group.id === 'unassigned' ? t('common.unknown') : group.name
  const initialDate = new URLSearchParams(window.location.search).get('date')
  const [week, setWeek] = useState(() => mondayFor(initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? `${initialDate}T12:00:00` : new Date()))
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const allRef = useRef(null), summaryRef = useRef(null)
  const end = weeklyDates(week).at(-1)
  const dates = weeklyDates(week)
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setData(null)
    getPayrollOperationsDataRequest({ date_from: week, date_to: end, paginate: true }).then((next) => { if (active) setData(next) })
      .catch((e) => { if (active) setError(getErrorMessage(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [week, end])
  const report = useMemo(() => data ? teamWeeklyReport(data, week) : null, [data, week])
  const period = <bdi dir="ltr">{l('monday')} {dateLabel(week)} → {l('saturday')} {dateLabel(end)}</bdi>
  const print = (ref) => { if (!printTeamReport(ref.current, { language, title: l(ref === summaryRef ? 'summaryTitle' : 'title') })) setError(l('printBlocked')) }
  const title = (summary = false) => <><h1>{l(summary ? 'summaryTitle' : 'teamTitle')}</h1><p>{l('period')}: {period}</p><p>{l('note')}</p><p>{l(report?.locked ? 'locked' : 'draft')}</p>{report?.hasLiveMonthlyOvertime && <p>{l('liveMonthly')}</p>}</>
  return <section lang={language} dir={direction} className="team-weekly-report">
    <h1 className="text-2xl font-bold">{l('title')}</h1>
    <div className="team-report-controls surface-card"><label>{l('week')}<input className="input-base" type="date" value={week} onChange={(e) => { if (e.target.value) setWeek(mondayFor(`${e.target.value}T12:00:00`)) }} /></label>
      <button type="button" className="btn-primary" disabled={!report?.groups.length || loading} onClick={() => print(allRef)}>{l('printAll')}</button>
      <button type="button" className="btn-secondary" disabled={!report?.groups.length || loading} onClick={() => print(summaryRef)}>{l('printSummary')}</button></div>
    {loading && <p role="status">{l('loading')}</p>}{error && <p role="alert">{error}</p>}
    {report?.unavailable && <p role="alert">{l('unavailable')}</p>}
    {report && !report.unavailable && !report.groups.length && <p>{l('empty')}</p>}
    {!!report?.groups.length && <><p>{l('teams')}: {report.groups.length} · {l('workers')}: {report.totals.workers}</p><div ref={allRef} className="team-report-all">
      {report.groups.map((group) => <section key={group.id} className="team-report-content team-report-team" aria-label={`${l('teamRegion')}: ${groupName(group)}`}>
        <header className="team-report-header">{title()}<h2 className="text-xl font-bold">{l('team')}: {groupName(group)}</h2><p>{l('workers')}: {group.lines.length}</p></header>
        {group.lines.some((line) => line.unresolved) && <p>{l('incomplete')}</p>}
        <div className="overflow-x-auto"><table><thead><tr>{headerKeys.map((key) => <th key={key}>{l(key)}</th>)}</tr></thead><tbody>{group.lines.map((line) => <tr key={line.worker.id}><td>{line.worker.full_name}{line.monthlyOvertimeOnly && <small className="block text-(--muted)">{l('monthlyOnly')}</small>}</td><td>{line.worker.employee_code || '—'}</td>{dates.map((date) => <DayCell key={date} line={line} date={date} t={t} />)}<td>{line.workDays}</td><td>{line.absentDays}</td><td><bdi dir="ltr">{hours(line.minutes)}</bdi></td><td><bdi dir="ltr">{money(line.basePay, line.currency)}</bdi></td><td><bdi dir="ltr">{money(line.overtimeAmount, line.currency)}</bdi></td><td><strong><bdi dir="ltr">{money(line.finalAmount, line.currency)}</bdi></strong></td></tr>)}</tbody><tfoot><TeamTotalRow totals={group.totals} /></tfoot></table></div>
        <OutsideWorkTeamMarkers markers={group.outsideWorkMarkers} dates={dates} language={language} />
      </section>)}
      <section ref={summaryRef} className="team-report-content team-report-summary" aria-label={l('summaryTitle')}>{title(true)}<div className="overflow-x-auto"><table><thead><tr>{summaryKeys.map((key) => <th key={key}>{l(key)}</th>)}</tr></thead><tbody>{report.groups.map((g) => <SummaryRow key={g.id} name={groupName(g)} totals={g.totals} />)}</tbody><tfoot><SummaryRow name={l('grandTotal')} totals={report.totals} /></tfoot></table></div></section>
    </div></>}
  </section>
}
