import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import WorkerWeekAttendanceRecovery from '../components/WorkerWeekAttendanceRecovery'
import { formatEveningOvertimeMinutes } from '../utils/weeklyPayrollOvertime'
import { useAuthStore } from '../store/authStore'

const empty = '—'
const dateText = (value) => value ? String(value).slice(0, 10).split('-').reverse().join('/') : empty
const timeText = (value) => {
  if (!value) return empty
  const text = String(value)
  if (!text.includes('T')) return text.slice(0, 5)
  const instant = new Date(text)
  return Number.isNaN(instant.getTime()) ? text : new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kinshasa', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant)
}
const statusText = { present: 'حاضر', half_day: 'نصف يوم', absent: 'غائب', no_record: 'لا يوجد سجل', not_applicable: 'غير مشمول', future: 'لم يأتِ بعد', late: 'متأخر', pending: 'قيد الانتظار', in_progress: 'قيد المعالجة' }
const weekdays = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

function Section({ title, children, sectionRef }) {
  return <section ref={sectionRef} className="border-t border-(--border) py-7"><h3 className="mb-4 text-xl font-extrabold">{title}</h3>{children}</section>
}
function Fact({ label, value }) {
  return <div className="rounded-lg bg-(--surface-subtle) p-3"><p className="text-sm text-(--muted)">{label}</p><p className="mt-1 font-bold" dir="auto">{value ?? empty}</p></div>
}
function Table({ headers, rows, emptyText }) {
  return rows.length ? <div className="overflow-x-auto rounded-xl border border-(--border)"><table className="min-w-full text-sm md:text-base"><thead className="bg-(--surface-subtle)"><tr>{headers.map((header) => <th key={header} className="whitespace-nowrap px-4 py-3 text-start">{header}</th>)}</tr></thead><tbody>{rows}</tbody></table></div> : <p className="text-(--muted)">{emptyText}</p>
}

export default function WorkerControlWorkerPage({ detail, currentStreak, loading, loadError, backTo, focusActions = false, onReactivate, reactivating = false, onRecovered, actionError = '' }) {
  const admin = useAuthStore((state) => state.admin)
  const actionsRef = useRef(null)
  useEffect(() => { if (detail && focusActions) actionsRef.current?.scrollIntoView?.({ block: 'start' }) }, [detail, focusActions])
  useEffect(() => { if (detail && !focusActions) { document.documentElement.scrollTop = 0; document.body.scrollTop = 0 } }, [detail?.worker?.id, focusActions])

  if (loading || loadError || !detail) return <section className="w-full pb-12" dir="rtl"><Link className="mb-6 inline-flex font-bold text-(--primary) hover:underline" to={backTo}>← العودة</Link><p className="py-6 text-(--muted)">{loading ? 'جارٍ تحميل بيانات العامل...' : loadError || 'العامل غير موجود.'}</p></section>

  const { worker, today, week, month, weekCounts, monthCounts } = detail
  const biometricIds = [...new Set(detail.mappings.filter((mapping) => mapping.is_active === true && mapping.mapping_review_state === 'confirmed').map((mapping) => mapping.device_employee_no).filter(Boolean))]
  const currentDates = new Set(currentStreak?.currentDates || [])
  const absencePeriods = detail.absenceStreaks.filter((period) => ![...currentDates].some((date) => date >= period.from && date <= period.to)).map((period) => ({
    ...period, dates: detail.month.filter((day) => day.status === 'absent' && day.date >= period.from && day.date <= period.to).map((day) => day.date),
  }))
  if (currentStreak?.currentStreak >= 2) absencePeriods.push({ from: currentStreak.currentDates.at(-1), to: currentStreak.currentDates[0], count: currentStreak.currentStreak, dates: [...currentStreak.currentDates].reverse() })
  absencePeriods.sort((a, b) => b.to.localeCompare(a.to))

  return <section className="w-full pb-12" dir="rtl">
    <Link className="mb-6 inline-flex font-bold text-(--primary) hover:underline" to={backTo}>← العودة</Link>
    <header className="mb-7"><h2 className="text-2xl font-extrabold md:text-3xl">{worker.full_name}</h2><p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-(--muted) md:text-base"><span>كود الموظف: {worker.employee_code || empty}</span><span>الفريق: {worker.team?.name || worker.team_name || empty}</span><span>الحالة: {worker.is_active ? 'نشط' : 'غير نشط'}</span><span>رقم البصمة: {biometricIds.join(' · ') || empty}</span></p></header>

    <Section title="ملخص سريع"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Fact label="حالة اليوم" value={statusText[today.status] || today.status} /><Fact label="الدخول" value={timeText(today.checkIn)} /><Fact label="الخروج" value={timeText(today.checkOut)} /><Fact label="آخر بصمة" value={timeText(today.lastPunch)} /><Fact label="غياب هذا الأسبوع" value={weekCounts.absent} /><Fact label="غياب هذا الشهر" value={monthCounts.absent} /><Fact label="نصف يوم هذا الشهر" value={monthCounts.halfDay} /></div></Section>

    <Section title="هذا الأسبوع"><Table headers={['اليوم', 'التاريخ', 'الحالة', 'الدخول', 'الخروج', 'الإضافي']} rows={week.map((day) => <tr key={day.date} className="border-t border-(--border)"><td className="whitespace-nowrap px-4 py-3">{weekdays[new Date(`${day.date}T12:00:00Z`).getUTCDay()]}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{dateText(day.date)}</td><td className="whitespace-nowrap px-4 py-3">{statusText[day.status] || day.status}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{timeText(day.checkIn)}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{timeText(day.checkOut)}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{formatEveningOvertimeMinutes(day.overtimeMinutes)}</td></tr>)} emptyText="لا توجد أيام لهذا الأسبوع." /></Section>

    <Section title="هذا الشهر"><div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Fact label="حاضر" value={monthCounts.present} /><Fact label="غائب" value={monthCounts.absent} /><Fact label="نصف يوم" value={monthCounts.halfDay} /><Fact label="أطول غياب متتالٍ" value={detail.longestAbsence} /><Fact label="آخر حضور" value={dateText(detail.lastAttendance)} /></div><Table headers={['التاريخ', 'الحالة', 'الدخول', 'الخروج']} rows={month.map((day) => <tr key={day.date} className="border-t border-(--border)"><td className="whitespace-nowrap px-4 py-3" dir="ltr">{dateText(day.date)}</td><td className="whitespace-nowrap px-4 py-3">{statusText[day.status] || day.status}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{timeText(day.checkIn)}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{timeText(day.checkOut)}</td></tr>)} emptyText="لا توجد أيام لهذا الشهر." /></Section>

    <Section title="سجل الغياب">{absencePeriods.length ? <div className="space-y-2">{absencePeriods.map((period) => <details key={`${period.from}-${period.to}`} className="rounded-lg border border-(--border) px-4 py-3"><summary className="cursor-pointer font-semibold"><span dir="ltr" className="inline-block">{dateText(period.from)} → {dateText(period.to)}</span><span className="mr-3">{period.count} أيام</span><span className="mr-3 text-sm text-(--primary)">عرض الأيام</span></summary><ul className="mt-3 grid gap-2 border-t border-(--border) pt-3 sm:grid-cols-3 lg:grid-cols-6">{period.dates.map((date) => <li key={date} dir="ltr">{dateText(date)}</li>)}</ul></details>)}</div> : <p className="text-(--muted)">لا يوجد غياب مسجل.</p>}</Section>

    <Section title="سجل نصف اليوم"><Table headers={['التاريخ', 'الدخول', 'الخروج', 'آخر بصمة']} rows={detail.halfDays.map((day) => <tr key={day.date} className="border-t border-(--border)"><td className="whitespace-nowrap px-4 py-3" dir="ltr">{dateText(day.date)}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{timeText(day.checkIn)}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{timeText(day.checkOut)}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{timeText(day.lastPunch)}</td></tr>)} emptyText="لا توجد أنصاف أيام مسجلة هذا الشهر." /></Section>

    <Section title="معلومات البصمة"><Table headers={['الجهاز', 'رقم البصمة', 'حالة الربط', 'آخر بصمة']} rows={detail.mappings.map((mapping, index) => <tr key={mapping.id || index} className="border-t border-(--border)"><td className="whitespace-nowrap px-4 py-3">{mapping.device_id || empty}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{mapping.device_employee_no || empty}</td><td className="whitespace-nowrap px-4 py-3">{mapping.is_active ? 'نشط' : 'غير نشط'} · {mapping.mapping_review_state || empty}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{timeText(mapping.latestPunch)}</td></tr>)} emptyText="لا توجد هوية بصمة مرتبطة." /></Section>

    {admin ? <Section title="الإجراءات" sectionRef={actionsRef}><div className="flex flex-wrap gap-3"><Link className="btn-secondary" to="/workers" state={{ editWorkerId: worker.id }}>تعديل العامل</Link><Link className="btn-secondary" to="/workers" state={{ editWorkerId: worker.id }}>إدارة / تعديل البصمة</Link>{worker.is_active ? <WorkerWeekAttendanceRecovery worker={worker} onRecovered={onRecovered} /> : <button type="button" className="btn-primary" disabled={reactivating} onClick={() => onReactivate(worker)}>{reactivating ? 'جارٍ التفعيل...' : 'تفعيل العامل'}</button>}</div>{actionError ? <p className="mt-3 text-red-700">{actionError}</p> : null}</Section> : null}
  </section>
}
