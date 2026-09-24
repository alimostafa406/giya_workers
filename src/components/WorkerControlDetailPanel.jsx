import { Link } from 'react-router-dom'
import WorkerWeekAttendanceRecovery from './WorkerWeekAttendanceRecovery'
import { formatEveningOvertimeMinutes } from '../utils/weeklyPayrollOvertime'
import { monitoringFactText } from '../utils/workerControlDetail'
import { useAuthStore } from '../store/authStore'

const empty = '—'
const dateText = (value) => value ? String(value).split('-').reverse().join('/') : empty
const timeText = (value) => {
  if (!value) return empty
  const text = String(value)
  if (!text.includes('T')) return text.slice(0, 5)
  const instant = new Date(text)
  return Number.isNaN(instant.getTime()) ? text : new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kinshasa', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant)
}
const statusText = {
  present: 'حاضر', half_day: 'نصف يوم', absent: 'غائب', no_record: 'لا يوجد سجل',
  not_applicable: 'غير مشمول', future: 'لم يأتِ بعد', late: 'متأخر',
  pending: 'قيد الانتظار', in_progress: 'قيد المعالجة',
}
function Section({ title, children }) {
  return <section className="border-t border-(--border) py-7"><h3 className="mb-5 text-xl font-extrabold">{title}</h3>{children}</section>
}
function Fact({ label, value }) {
  return <div className="rounded-lg bg-(--surface-subtle) p-4"><p className="text-sm text-(--muted)">{label}</p><p className="mt-1 text-base font-bold" dir="auto">{value ?? empty}</p></div>
}
function DayTable({ days }) {
  return <div className="overflow-x-auto rounded-xl border border-(--border)"><table className="min-w-full text-base"><thead className="bg-(--surface-subtle)"><tr>{['التاريخ', 'الحالة', 'الدخول', 'الخروج', 'الإضافي المسائي'].map((label) => <th key={label} className="whitespace-nowrap px-4 py-3 text-start">{label}</th>)}</tr></thead><tbody>{days.map((day) => <tr key={day.date} className="border-t border-(--border)"><td className="whitespace-nowrap px-4 py-3" dir="ltr">{dateText(day.date)}</td><td className="whitespace-nowrap px-4 py-3">{statusText[day.status] || day.status}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{timeText(day.checkIn)}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{timeText(day.checkOut)}</td><td className="whitespace-nowrap px-4 py-3" dir="ltr">{formatEveningOvertimeMinutes(day.overtimeMinutes)}</td></tr>)}</tbody></table></div>
}

export default function WorkerControlDetailPanel({ detail, onClose, onReactivate, reactivating = false, onRecovered, actionError = '' }) {
  const admin = useAuthStore((state) => state.admin)
  if (!detail) return null
  const { worker, today, week, month, weekCounts, monthCounts } = detail
  const biometricIds = [...new Set(detail.mappings.filter((mapping) => mapping.is_active === true && mapping.mapping_review_state === 'confirmed').map((mapping) => mapping.device_employee_no).filter(Boolean))]
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 md:p-6" dir="rtl">
    <div role="dialog" aria-modal="true" aria-label={`متابعة العامل: ${worker.full_name}`} className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-(--border) bg-white shadow-2xl md:max-h-[calc(100vh-3rem)]">
      <div className="flex items-start justify-between gap-4 border-b border-(--border) p-5 md:px-8"><div><h2 className="text-2xl font-extrabold md:text-3xl">{worker.full_name}</h2><p className="mt-2 text-base text-(--muted)">كود الموظف: {worker.employee_code || empty} · {worker.team?.name || worker.team_name || empty}</p></div><button type="button" onClick={onClose} aria-label="إغلاق التفاصيل" className="btn-secondary">إغلاق</button></div>
      <div className="overflow-y-auto px-5 md:px-8">
        <div className="grid gap-3 py-6 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="الحالة" value={worker.is_active ? 'نشط' : 'غير نشط'} />
          <Fact label="بداية المشاركة التشغيلية" value={worker.operational_start_date || empty} />
          <Fact label="نوع الدفع" value={worker.payment_type || empty} />
          <Fact label="أرقام البصمة المؤكدة" value={biometricIds.join(' · ') || empty} />
        </div>

        <Section title="اليوم"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="حالة الحضور" value={statusText[today.status] || today.status} />
          <Fact label="الدخول" value={timeText(today.checkIn)} />
          <Fact label="الخروج" value={timeText(today.checkOut)} />
          <Fact label="آخر بصمة متاحة" value={timeText(today.lastPunch)} />
          <Fact label="جهاز البصمة" value={today.device || empty} />
          <Fact label="الإضافي المسائي" value={formatEveningOvertimeMinutes(today.overtimeMinutes)} />
        </div>{detail.monitoring.some((fact) => fact.code === 'inactive_punch_today') ? <p className="mt-4 rounded-lg bg-amber-50 p-4 font-bold">غير مفعّل وقام بالبصمة اليوم</p> : null}</Section>

        <Section title="هذا الأسبوع"><DayTable days={week} /><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Fact label="أيام الحضور" value={weekCounts.present} /><Fact label="أيام الغياب المسجلة" value={weekCounts.absent} /><Fact label="أنصاف الأيام" value={weekCounts.halfDay} /><Fact label="الغياب المتتالي الحالي" value={detail.currentAbsence} /><Fact label="إجمالي الإضافي" value={formatEveningOvertimeMinutes(weekCounts.overtimeMinutes)} /></div></Section>

        <Section title="هذا الشهر"><div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Fact label="أيام الحضور" value={monthCounts.present} /><Fact label="أيام الغياب المسجلة" value={monthCounts.absent} /><Fact label="أنصاف الأيام" value={monthCounts.halfDay} /><Fact label="أيام مؤهلة دون سجل" value={monthCounts.noRecord} /><Fact label="أطول غياب متتالٍ" value={detail.longestAbsence} /><Fact label="الغياب المتتالي الحالي" value={detail.currentAbsence} /><Fact label="نسبة الحضور (نصف اليوم = ½)" value={detail.attendancePercentage == null ? empty : `${Math.round(detail.attendancePercentage)}%`} /><Fact label="آخر حضور" value={dateText(detail.lastAttendance)} /><Fact label="آخر بصمة متاحة" value={timeText(detail.lastPunch)} /><Fact label="أيام إضافي / الساعات" value={`${monthCounts.overtimeDays} / ${formatEveningOvertimeMinutes(monthCounts.overtimeMinutes)}`} /></div><DayTable days={month} /></Section>

        <Section title="ملخص المتابعة">{detail.monitoring.length ? <ul className="space-y-2">{detail.monitoring.map((fact, index) => <li key={`${fact.code}-${index}`} className="rounded-lg bg-(--surface-subtle) px-4 py-3 font-semibold">{monitoringFactText(fact)}</li>)}</ul> : <p className="text-(--muted)">لا توجد ملاحظات متابعة حالية</p>}</Section>

        <Section title="سجل الغياب">{detail.absenceDays.length ? <><div className="flex flex-wrap gap-2">{detail.absenceDays.map((day) => <span key={day.date} className="rounded-lg bg-(--surface-subtle) px-3 py-2" dir="ltr">{dateText(day.date)}</span>)}</div>{detail.absenceStreaks.filter((streak) => streak.count > 1).map((streak) => <p key={streak.from} className="mt-3 font-semibold" dir="auto">{dateText(streak.from)} ← {dateText(streak.to)} · {streak.count} أيام متتالية</p>)}</> : <p className="text-(--muted)">لا يوجد غياب مسجل هذا الشهر</p>}</Section>

        <Section title="سجل نصف اليوم">{detail.halfDays.length ? <div className="overflow-x-auto"><table className="min-w-full text-base"><thead><tr>{['التاريخ', 'الدخول', 'الخروج', 'آخر بصمة متاحة'].map((label) => <th key={label} className="px-4 py-3 text-start">{label}</th>)}</tr></thead><tbody>{detail.halfDays.map((day) => <tr key={day.date} className="border-t border-(--border)"><td className="px-4 py-3" dir="ltr">{dateText(day.date)}</td><td className="px-4 py-3" dir="ltr">{timeText(day.checkIn)}</td><td className="px-4 py-3" dir="ltr">{timeText(day.checkOut)}</td><td className="px-4 py-3" dir="ltr">{timeText(day.lastPunch)}</td></tr>)}</tbody></table></div> : <p className="text-(--muted)">لا توجد أنصاف أيام مسجلة هذا الشهر</p>}</Section>

        <Section title="معلومات البصمة">{detail.mappings.length ? <div className="overflow-x-auto"><table className="min-w-full text-base"><thead><tr>{['الجهاز', 'رقم البصمة', 'حالة الربط', 'حالة التأكيد', 'آخر بصمة متاحة'].map((label) => <th key={label} className="px-4 py-3 text-start">{label}</th>)}</tr></thead><tbody>{detail.mappings.map((mapping) => <tr key={mapping.id} className="border-t border-(--border)"><td className="px-4 py-3">{mapping.device_id || empty}</td><td className="px-4 py-3" dir="ltr">{mapping.device_employee_no || empty}</td><td className="px-4 py-3">{mapping.is_active ? 'نشط' : 'غير نشط'}</td><td className="px-4 py-3">{mapping.mapping_review_state || empty}</td><td className="px-4 py-3" dir="ltr">{timeText(mapping.latestPunch)}</td></tr>)}</tbody></table></div> : <p className="text-(--muted)">لا توجد هوية بصمة مرتبطة</p>}</Section>

        <Section title="النشاط والحالة"><div className="grid gap-3 sm:grid-cols-2"><Fact label="بداية المشاركة التشغيلية" value={worker.operational_start_date || empty} /><Fact label="وقت التفعيل المسجل اليوم" value={timeText(detail.activation?.activated_at)} /></div></Section>

        {admin ? <Section title="الإجراءات"><div className="flex flex-wrap gap-3"><Link className="btn-secondary" to="/workers" state={{ editWorkerId: worker.id }} onClick={onClose}>تعديل العامل</Link><Link className="btn-secondary" to="/workers" state={{ editWorkerId: worker.id }} onClick={onClose}>إدارة / تعديل البصمة</Link>{worker.is_active ? <WorkerWeekAttendanceRecovery worker={worker} onRecovered={onRecovered} /> : <button type="button" className="btn-primary" disabled={reactivating} onClick={() => onReactivate(worker)}>{reactivating ? 'جارٍ التفعيل...' : 'تفعيل العامل'}</button>}</div>{actionError ? <p className="mt-3 text-red-700">{actionError}</p> : null}</Section> : null}
      </div>
    </div>
  </div>
}
