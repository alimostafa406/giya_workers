import { useEffect, useMemo, useState } from 'react'
import { getWorkersRequest, getWorkersActivatedTodayRequest, reactivateWorkerRequest } from '../api/workersApi'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getBiometricMappingsRequest, getInactiveWorkerBiometricActivityRequest } from '../api/biometricMappingApi'
import { buildWorkerControlAlerts } from '../utils/workerControlCenter'
import { buildWorkerControlSectionMetrics } from '../utils/workerControlSectionMetrics'
import { buildWorkerControlDetail } from '../utils/workerControlDetail'
import WorkerControlDetailPanel from '../components/WorkerControlDetailPanel'

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kinshasa' })
const monthStart = (d) => `${d.slice(0, 7)}-01`
const monday = (d) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10) }
const text = { overview: 'نظرة عامة اليوم', absent: 'الغائبون اليوم', consecutive: 'الغياب المتتالي' }

function ReportSection({ id, title, rows, columns }) {
  return <section id={id} className="mb-14 scroll-mt-6">
    <div className="mb-4 flex items-center justify-between border-b-2 border-(--border) pb-3"><h3 className="text-2xl font-extrabold">{title}</h3><span className="status-badge status-badge--neutral">{rows.length}</span></div>
    <div className="overflow-x-auto rounded-xl border border-(--border) bg-white"><table className="min-w-full text-base"><thead className="bg-(--surface-subtle)"><tr>{columns.map(c => <th className="whitespace-nowrap px-5 py-4 text-start font-extrabold" key={c.label}>{c.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className="border-t border-(--border)" key={`${row.type}-${row.worker?.id}-${index}`}>{columns.map(c => <td className="whitespace-nowrap px-5 py-4" key={c.label}>{c.render(row)}</td>)}</tr>)}</tbody></table>{!rows.length ? <p className="p-7 text-(--muted)">لا توجد حالات حالياً</p> : null}</div>
  </section>
}

export default function WorkerControlCenter() {
  const [date] = useState(today())
  const [state, setState] = useState({ workers: [], attendance: [], events: [], activated: [], mappings: [] })
  const [selected, setSelected] = useState(null)
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [reactivating, setReactivating] = useState(false)
  const [actionError, setActionError] = useState('')
  useEffect(() => { Promise.all([getWorkersRequest(), getAttendanceRequest({ date_from: monthStart(date), date_to: date, paginate: true }), getInactiveWorkerBiometricActivityRequest({ attendanceDate: date }), getWorkersActivatedTodayRequest(), getBiometricMappingsRequest().catch(() => ({ data: [] }))]).then(([w, a, e, x, m]) => setState({ workers: w.data || [], attendance: a.data || [], events: e.data || [], activated: x.data || [], mappings: m.data || [] })) }, [date])
  const alerts = useMemo(() => buildWorkerControlAlerts({ ...state, today: date, weekStart: monday(date), monthStart: monthStart(date) }), [state, date])
  const { halfDayRows, teamRows } = useMemo(() => buildWorkerControlSectionMetrics({ ...state, alerts, today: date, weekStart: monday(date), monthStart: monthStart(date) }), [state, alerts, date])
  const oneEach = (rows) => rows.filter((row, index, all) => all.findIndex(item => item.worker?.id === row.worker?.id) === index)
  const absent = oneEach(alerts.filter(a => a.todayRow?.status === 'absent'))
  const consecutive = [...alerts.filter(a => a.type === 'consecutive_absence')].sort((a, b) => (b.longest || 0) - (a.longest || 0))
  const groups = [{ id: 'absent-today', label: 'الغائبون اليوم', rows: absent }, { id: 'consecutive-absence', label: 'الغياب المتتالي', rows: consecutive }, { id: 'weekly-absence', label: 'الغياب الأسبوعي', rows: alerts.filter(a => a.type === 'weekly_absence') }, { id: 'monthly-monitoring', label: 'المراقبة الشهرية', rows: alerts.filter(a => a.type === 'monthly_absence') }, { id: 'half-day-monitoring', label: 'نصف اليوم', rows: halfDayRows }, { id: 'inactive-punch', label: 'غير مفعّلين قاموا بالبصمة', rows: alerts.filter(a => a.type === 'inactive_punch') }, { id: 'activated-today', label: 'تم تفعيلهم اليوم', rows: alerts.filter(a => a.type === 'activated_today') }, { id: 'returned-after-absence', label: 'عادوا بعد غياب', rows: alerts.filter(a => a.type === 'returned_after_absence') }]
  const worker = { label: 'العامل', render: r => <><b>{r.worker?.full_name || '—'}</b></> }
  const team = { label: 'الفريق', render: r => r.worker?.team_name || '—' }
  const details = { label: 'التفاصيل', render: r => <button className="btn-secondary px-3 py-1" onClick={() => setSelected(r)}>التفاصيل</button> }
  const weekly = [...alerts.filter(a => a.type === 'weekly_absence')].sort((a, b) => (b.weekAbsent || 0) - (a.weekAbsent || 0) || (b.longest || 0) - (a.longest || 0))
  const monthly = alerts.filter(a => a.type === 'monthly_absence')
  const returned = alerts.filter(a => a.type === 'returned_after_absence')
  const inactivePunches = alerts.filter(a => a.type === 'inactive_punch')
  const activatedToday = alerts.filter(a => a.type === 'activated_today')
  const selectedTeam = teamRows.find(row => row.id === selectedTeamId)
  const selectedWorker = state.workers.find(worker => String(worker.id) === String(selected?.worker?.id)) || selected?.worker
  const selectedDetail = useMemo(() => buildWorkerControlDetail({ worker: selectedWorker, ...state, today: date, weekStart: monday(date), monthStart: monthStart(date) }), [selectedWorker, state, date])
  const reactivate = async (worker) => {
    if (!window.confirm('تفعيل هذا العامل؟')) return
    setReactivating(true)
    setActionError('')
    try {
      await reactivateWorkerRequest(worker)
      const [workers, activated] = await Promise.all([getWorkersRequest(), getWorkersActivatedTodayRequest()])
      setState(current => ({ ...current, workers: workers.data || [], activated: activated.data || [] }))
    } catch (error) {
      setActionError(error?.message || 'تعذر تفعيل العامل.')
    } finally {
      setReactivating(false)
    }
  }
  const refreshAttendance = async () => {
    const response = await getAttendanceRequest({ date_from: monthStart(date), date_to: date, paginate: true })
    setState(current => ({ ...current, attendance: response.data || [] }))
  }

  return <section className="w-full pb-12" dir="rtl">
    <div className="mb-9"><h2 className="text-3xl font-extrabold">مركز مراقبة العمال</h2><p className="mt-2 text-base text-(--muted)">متابعة تشغيلية مبنية على بيانات الحضور الحالية.</p></div>
    <section id="today-overview" className="mb-14"><h3 className="mb-5 text-2xl font-extrabold">{text.overview}</h3><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{groups.map(g => <button key={g.id} className="surface-card min-h-34 p-5 text-start" onClick={() => document.getElementById(g.id)?.scrollIntoView({ behavior: 'smooth' })}><p className="text-base font-bold text-(--muted)">{g.label}</p><b className="mt-3 block text-4xl">{g.rows.length}</b></button>)}</div></section>
    <ReportSection id="absent-today" title={text.absent} rows={absent} columns={[worker, { label: 'كود الموظف', render: r => r.worker?.employee_code || '—' }, team, { label: 'الغياب المتتالي', render: r => r.longest || 0 }, { label: 'غياب الأسبوع', render: r => r.weekAbsent || 0 }, { label: 'غياب الشهر', render: r => r.monthAbsent || 0 }, { label: 'آخر حضور', render: r => r.lastAttendance?.attendance_date || '—' }, details]} />
    <ReportSection id="consecutive-absence" title={text.consecutive} rows={consecutive} columns={[worker, team, { label: 'الأيام المتتالية', render: r => r.longest || 0 }, { label: 'الحالة', render: r => `غائب ${r.longest || 0} أيام متتالية` }, { label: 'غياب الأسبوع', render: r => r.weekAbsent || 0 }, { label: 'غياب الشهر', render: r => r.monthAbsent || 0 }, details]} />
    <ReportSection id="weekly-absence" title="مراقبة الغياب الأسبوعي" rows={weekly} columns={[worker, { label: 'كود الموظف', render: r => r.worker?.employee_code || '—' }, team, { label: 'غياب الأسبوع', render: r => r.weekAbsent || 0 }, { label: 'الغياب المتتالي', render: r => r.longest || 0 }, { label: 'غياب الشهر', render: r => r.monthAbsent || 0 }, { label: 'الحالة', render: r => `غاب ${r.weekAbsent || 0} أيام هذا الأسبوع` }, details]} />
    <ReportSection id="monthly-monitoring" title="المراقبة الشهرية" rows={monthly} columns={[worker, { label: 'كود الموظف', render: r => r.worker?.employee_code || '—' }, team, { label: 'غياب الشهر', render: r => r.monthAbsent || 0 }, { label: 'نصف يوم', render: r => r.half || 0 }, { label: 'الغياب المتتالي', render: r => r.longest || 0 }, { label: 'آخر حضور', render: r => r.lastAttendance?.attendance_date || '—' }, { label: 'المتابعة', render: r => `غاب ${r.monthAbsent || 0} أيام هذا الشهر` }, details]} />
    <ReportSection id="returned-after-absence" title="عادوا بعد غياب" rows={returned} columns={[worker, { label: 'كود الموظف', render: r => r.worker?.employee_code || '—' }, team, { label: 'الغياب السابق', render: r => r.longest || 0 }, { label: 'حالة العودة', render: r => r.todayRow?.status || 'present' }, { label: 'غياب الشهر', render: r => r.monthAbsent || 0 }, details]} />
    <ReportSection id="inactive-punch" title="عمال غير مفعّلين قاموا بالبصمة" rows={inactivePunches} columns={[worker, { label: 'كود الموظف', render: r => r.worker?.employee_code || '—' }, team, { label: 'رقم البصمة', render: r => r.lastPunch?.device_employee_no || '—' }, { label: 'الجهاز', render: r => r.lastPunch?.device_id || '—' }, { label: 'آخر بصمة', render: r => r.lastPunch?.event_timestamp || '—' }, details]} />
    <ReportSection id="activated-today" title="تم تفعيلهم اليوم" rows={activatedToday} columns={[worker, { label: 'كود الموظف', render: r => r.worker?.employee_code || '—' }, team, { label: 'وقت التفعيل', render: r => r.worker?.activated_at || '—' }, { label: 'بداية التشغيل', render: r => r.worker?.operational_start_date || '—' }, details]} />
    <ReportSection id="half-day-monitoring" title="مراقبة نصف اليوم" rows={halfDayRows} columns={[worker, { label: 'كود الموظف', render: r => r.worker?.employee_code || '—' }, team, { label: 'نصف يوم هذا الأسبوع', render: r => r.weekHalf }, { label: 'نصف يوم هذا الشهر', render: r => r.monthHalf }, { label: 'حالة اليوم', render: r => r.todayRow?.status || '—' }, { label: 'دخول اليوم', render: r => r.todayRow?.check_in || '—' }, { label: 'خروج اليوم', render: r => r.todayRow?.check_out || '—' }, { label: 'آخر بصمة', render: r => r.lastPunch?.event_timestamp || '—' }, details]} />
    <ReportSection id="team-monitoring" title="مراقبة الفرق" rows={teamRows} columns={[{ label: 'الفريق', render: r => <b>{r.name || '—'}</b> }, { label: 'العمال النشطون', render: r => r.active }, { label: 'حاضر اليوم', render: r => r.present }, { label: 'نصف يوم اليوم', render: r => r.halfDay }, { label: 'غائب اليوم', render: r => r.absent }, { label: 'غير مسجل اليوم', render: r => r.notRecorded }, { label: 'غياب الأسبوع', render: r => r.weekAbsent }, { label: 'غياب الشهر', render: r => r.monthAbsent }, { label: 'غياب متتالٍ 2+', render: r => r.consecutive }, { label: 'عمال تحت المتابعة', render: r => r.monitored }, { label: 'التفاصيل', render: r => <button className="btn-secondary px-3 py-1" onClick={() => setSelectedTeamId(current => current === r.id ? '' : r.id)}>التفاصيل</button> }]} />
    {selectedTeam ? <section id="team-worker-details" className="mb-14 scroll-mt-6"><h3 className="mb-4 text-2xl font-extrabold">{selectedTeam.name}</h3><div className="overflow-x-auto rounded-xl border border-(--border) bg-white"><table className="min-w-full text-base"><thead><tr><th className="px-5 py-4 text-start">العامل</th><th className="px-5 py-4 text-start">كود الموظف</th><th className="px-5 py-4 text-start">حالة اليوم</th><th className="px-5 py-4 text-start">التفاصيل</th></tr></thead><tbody>{selectedTeam.workers.map(member => <tr key={member.id} className="border-t border-(--border)"><td className="px-5 py-4">{member.full_name}</td><td className="px-5 py-4">{member.employee_code || '—'}</td><td className="px-5 py-4">{state.attendance.find(row => row.worker_id === member.id && row.attendance_date === date)?.status || '—'}</td><td className="px-5 py-4"><button className="btn-secondary" onClick={() => setSelected({ worker: member })}>التفاصيل</button></td></tr>)}</tbody></table></div></section> : null}
    <WorkerControlDetailPanel detail={selectedDetail} onClose={() => { setSelected(null); setActionError('') }} onReactivate={reactivate} reactivating={reactivating} onRecovered={refreshAttendance} actionError={actionError} />
  </section>
}
