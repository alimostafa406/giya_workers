import { useEffect, useMemo, useRef, useState } from 'react'
import { getPayrollOperationsDataRequest } from '../api/payrollOperationsApi'
import { getErrorMessage } from '../api/axios'
import { mondayFor, weeklyDates } from '../utils/payrollCalculations'
import { formatPayrollMoney } from '../utils/payrollCurrency'
import { printTeamReport, teamWeeklyReport } from '../utils/teamWeeklyReport'
import './TeamWeeklyReport.css'

const money = (value, currency) => value == null ? '—' : formatPayrollMoney(value, { currency, paymentType: 'weekly' })
const hours = (minutes) => `${Number((minutes / 60).toFixed(4))} h`
const dateLabel = (date) => `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
const headers = ['العامل', 'كود العامل', 'أيام العمل', 'أيام الغياب', 'ساعات الإضافي اليدوي', 'الأجر الأساسي المستحق', 'مبلغ الإضافي', 'إجمالي القبض']
const summaryHeaders = ['الفريق', 'عدد العمال', 'إجمالي أيام العمل', 'إجمالي ساعات الإضافي اليدوي', 'إجمالي مبلغ الإضافي', 'إجمالي الأجور الأساسية', 'إجمالي القبض']
function Amounts({ totals, field }) { return Object.entries(totals.currencies).map(([currency, values]) => <bdi dir="ltr" className="block" key={currency}>{money(values[field], currency)}</bdi>) }
function SummaryRow({ name, totals }) { return <tr><th>{name}</th><td>{totals.workers}</td><td>{totals.workDays}</td><td><bdi dir="ltr">{hours(totals.minutes)}</bdi></td><td><Amounts totals={totals} field="overtimeAmount" /></td><td><Amounts totals={totals} field="basePay" /></td><td><strong><Amounts totals={totals} field="finalAmount" /></strong></td></tr> }
export default function TeamWeeklyReport() {
  const initialDate = new URLSearchParams(window.location.search).get('date')
  const [week, setWeek] = useState(() => mondayFor(initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? `${initialDate}T12:00:00` : new Date()))
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const allRef = useRef(null), summaryRef = useRef(null)
  const end = weeklyDates(week).at(-1)
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setData(null)
    getPayrollOperationsDataRequest({ date_from: week, date_to: end, paginate: true }).then((next) => { if (active) setData(next) })
      .catch((e) => { if (active) setError(getErrorMessage(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [week, end])
  const report = useMemo(() => data ? teamWeeklyReport(data, week) : null, [data, week])
  const period = <bdi dir="ltr">الاثنين {dateLabel(week)} → السبت {dateLabel(end)}</bdi>
  const print = (ref) => { if (!printTeamReport(ref.current)) setError('تعذر فتح الطباعة — اسمح بالنوافذ المنبثقة') }
  const title = (summary = false) => <><h1>{summary ? 'ملخص أجور جميع الفرق' : 'تقرير أجور الفريق الأسبوعي'}</h1><p>الفترة: {period}</p><p>الوقت الإضافي في هذا التقرير يعتمد على الإدخال اليدوي المعتمد.</p><p>{report?.locked ? 'لقطة رواتب محفوظة — للقراءة فقط' : 'حساب حالي — غير معتمد نهائياً'}</p>{report?.hasLiveMonthlyOvertime && <p>إضافي العمال الشهريين من الإدخال اليدوي للفترة؛ ليس جزءاً من لقطة الأجور الأسبوعية المحفوظة.</p>}</>
  return <section dir="rtl" className="team-weekly-report">
    <h1 className="text-2xl font-bold">تقرير أجور الفرق الأسبوعي</h1>
    <div className="team-report-controls surface-card"><label>الأسبوع<input className="input-base" type="date" value={week} onChange={(e) => { if (e.target.value) setWeek(mondayFor(`${e.target.value}T12:00:00`)) }} /></label>
      <button type="button" className="btn-primary" disabled={!report?.groups.length || loading} onClick={() => print(allRef)}>طباعة كل الفرق</button>
      <button type="button" className="btn-secondary" disabled={!report?.groups.length || loading} onClick={() => print(summaryRef)}>طباعة ملخص كل الفرق</button></div>
    {loading && <p role="status">جاري التحميل...</p>}{error && <p role="alert">{error}</p>}
    {report?.unavailable && <p role="alert">{report.unavailable}</p>}
    {report && !report.unavailable && !report.groups.length && <p>لا يوجد عمال رواتب أسبوعية مؤهلون</p>}
    {!!report?.groups.length && <><p>عدد الفرق: {report.groups.length} · عدد العمال: {report.totals.workers}</p><div ref={allRef} className="team-report-all">
      {report.groups.map((group) => <section key={group.id} className="team-report-content team-report-team" aria-label={`تقرير الفريق: ${group.name}`}>
        <header className="team-report-header">{title()}<h2 className="text-xl font-bold">الفريق: {group.name}</h2><p>عدد العمال: {group.lines.length}</p></header>
        {group.lines.some((l) => l.unresolved) && <p>تنبيه: توجد إعدادات أجر أو حضور غير مكتملة. — تعني أن المبلغ غير محسوم؛ الإجماليات المتأثرة غير محسومة أيضاً.</p>}
        <div className="overflow-x-auto"><table><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{group.lines.map((line) => <tr key={line.worker.id}><td>{line.worker.full_name}{line.monthlyOvertimeOnly && <small className="block text-(--muted)">شهري — إضافي فقط</small>}</td><td>{line.worker.employee_code || '—'}</td><td>{line.workDays}</td><td>{line.absentDays}</td><td><bdi dir="ltr">{hours(line.minutes)}</bdi></td><td><bdi dir="ltr">{money(line.basePay, line.currency)}</bdi></td><td><bdi dir="ltr">{money(line.overtimeAmount, line.currency)}</bdi></td><td><strong><bdi dir="ltr">{money(line.finalAmount, line.currency)}</bdi></strong></td></tr>)}</tbody></table></div>
        <div className="team-report-totals"><div>إجمالي أيام العمل للفريق<strong>{group.totals.workDays}</strong></div><div>إجمالي ساعات الإضافي اليدوي للفريق<strong><bdi dir="ltr">{hours(group.totals.minutes)}</bdi></strong></div><div>إجمالي مبلغ الإضافي<Amounts totals={group.totals} field="overtimeAmount" /></div><div>إجمالي الأجور الأساسية<Amounts totals={group.totals} field="basePay" /></div><div>إجمالي القبض للفريق<strong><Amounts totals={group.totals} field="finalAmount" /></strong></div></div>
      </section>)}
      <section ref={summaryRef} className="team-report-content team-report-summary" aria-label="ملخص أجور جميع الفرق">{title(true)}<div className="overflow-x-auto"><table><thead><tr>{summaryHeaders.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{report.groups.map((g) => <SummaryRow key={g.id} name={g.name} totals={g.totals} />)}</tbody><tfoot><SummaryRow name="الإجمالي العام" totals={report.totals} /></tfoot></table></div></section>
    </div></>}
  </section>
}
