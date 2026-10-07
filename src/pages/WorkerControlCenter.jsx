import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { reactivateWorkerRequest } from '../api/workersApi'
import { clearWorkerControlDataCache, getWorkerControlDataSnapshot, invalidateWorkerControlAttendanceCache, loadWorkerControlData, loadWorkerControlSearchMappings } from '../api/workerControlData'
import { buildWorkerControlDetail } from '../utils/workerControlDetail'
import { buildWorkerControlPages, workerControlCategories } from '../utils/workerControlPages'
import { workerControlPeriods } from '../utils/workerControlPeriods'
import { workerControlSearchResults } from '../utils/workerControlSearch'
import WorkerControlWorkerPage from './WorkerControlWorkerPage'
import { useAuthStore } from '../store/authStore'

const base = '/worker-control-center'
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kinshasa' })
const dateText = (date) => date ? String(date).slice(0, 10).split('-').reverse().join('/') : '—'
const timeText = (value) => {
  if (!value) return '—'
  if (!String(value).includes('T')) return String(value).slice(0, 5)
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? String(value) : new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kinshasa', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant)
}
const statusText = { present: 'حاضر', half_day: 'نصف يوم', absent: 'غائب', no_record: 'لا يوجد سجل', late: 'متأخر' }
const workerName = { label: 'العامل', render: (row) => <b>{row.worker?.full_name || '—'}</b> }
const workerCode = { label: 'كود الموظف', render: (row) => row.worker?.employee_code || '—' }
const teamName = { label: 'الفريق', render: (row) => row.worker?.team?.name || row.worker?.team_name || '—' }
const dayStatus = (row) => statusText[row?.status] || row?.status || '—'

function SubjectTable({ rows, columns, empty = 'لا توجد بيانات لهذه الفئة حالياً' }) {
  return <div className="overflow-x-auto rounded-xl border border-(--border) bg-white">
    <table className="min-w-full text-base"><thead className="bg-(--surface-subtle)"><tr>{columns.map((column) => <th key={column.label} className="whitespace-nowrap px-5 py-4 text-start font-extrabold">{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.worker?.id || row.id || index} className="border-t border-(--border)">{columns.map((column) => <td key={column.label} className="whitespace-nowrap px-5 py-4">{column.render(row)}</td>)}</tr>)}</tbody></table>
    {!rows.length ? <p className="p-7 text-(--muted)">{empty}</p> : null}
  </div>
}

export default function WorkerControlCenter({ category = null }) {
  const { teamId, workerId } = useParams()
  const location = useLocation()
  const authKey = useAuthStore((current) => current.user?.id || current.admin?.id || '')
  const [date, setDate] = useState(today())
  const [state, setState] = useState(() => getWorkerControlDataSnapshot({ date: today(), category, workerId, authKey }) || { workers: [], attendance: [], events: [], activated: [], mappings: [] })
  const [basicWorker, setBasicWorker] = useState(null)
  const [reactivating, setReactivating] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [actionError, setActionError] = useState('')
  const [loading, setLoading] = useState(() => !getWorkerControlDataSnapshot({ date: today(), category, workerId, authKey }))
  const [hasData, setHasData] = useState(() => Boolean(getWorkerControlDataSnapshot({ date: today(), category, workerId, authKey })))
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [workerSearch, setWorkerSearch] = useState('')
  const hasWorkerSearch = Boolean(workerSearch.trim())
  const [searchMappings, setSearchMappings] = useState([])
  const [searchError, setSearchError] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [minimumAbsences, setMinimumAbsences] = useState(1)
  const [visibleAbsenceDays, setVisibleAbsenceDays] = useState(null)

  useEffect(() => {
    const timer = setInterval(() => setDate(today()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useLayoutEffect(() => {
    let current = true
    const snapshot = getWorkerControlDataSnapshot({ date, category, workerId, authKey })
    if (snapshot) {
      setState(snapshot)
      setHasData(true)
      setLoading(false)
    } else {
      setHasData(false)
      setLoading(true)
    }
    setLoadError('')
    loadWorkerControlData({ date, category, workerId, authKey,
      onRoster: (workers) => { if (current) setBasicWorker(workers.find((worker) => String(worker.id) === workerId) || null) },
      onCore: (data) => { if (current) { setState(data); setHasData(true); setLoading(false) } },
      onOptionalError: (error) => { if (current) setLoadError(error?.message || 'تعذر تحميل بعض بيانات المتابعة.') },
    }).then((data) => {
      if (current) { setState(data); setHasData(true) }
    }).catch((error) => { if (current) setLoadError(error?.message || 'تعذر تحميل بيانات المتابعة.') }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [date, category, workerId, authKey])

  useEffect(() => {
    if (category !== null || !hasWorkerSearch) return undefined
    let current = true
    loadWorkerControlSearchMappings(authKey).then((response) => {
      if (current) { setSearchMappings(response.data || []); setSearchError('') }
    }).catch((error) => { if (current) setSearchError(error?.message || 'تعذر تحميل أرقام البصمة.') })
    return () => { current = false }
  }, [category, hasWorkerSearch, authKey])

  const period = workerControlPeriods(date)
  const pages = useMemo(() => category === null ? { rows: { teams: [] }, details: new Map() }
    : buildWorkerControlPages({ ...state,
      workers: category === 'worker-detail' ? state.workers.filter((worker) => String(worker.id) === workerId) : state.workers,
      today: date, weekStart: period.weekStart, monthStart: period.monthStart,
    }), [category, state, workerId, date, period.weekStart, period.monthStart])
  const selectedWorker = category === 'worker-detail' ? state.workers.find((worker) => String(worker.id) === workerId)
    || pages.rows['activated-today'].find((row) => String(row.worker.id) === workerId)?.worker : null
  const selectedDetail = selectedWorker && (category === 'worker-detail'
    ? buildWorkerControlDetail({ ...state, worker: selectedWorker, today: date, weekStart: period.weekStart, monthStart: period.monthStart, deriveMissingAbsence: true })
    : pages.details.get(String(selectedWorker.id)))
  const workerLink = (worker, focusActions = false) => ({ pathname: `${base}/worker/${encodeURIComponent(worker.id)}`, state: { from: location.pathname, focusActions } })
  const workerSearchRows = useMemo(() => workerControlSearchResults(state.workers, searchMappings, workerSearch), [state.workers, searchMappings, workerSearch])
  const details = { label: 'التفاصيل', render: (row) => <Link className="btn-secondary px-3 py-1" to={workerLink(row.worker).pathname} state={workerLink(row.worker).state}>التفاصيل</Link> }
  const reactivate = async (worker) => {
    if (!window.confirm('تفعيل هذا العامل؟')) return
    setReactivating(true)
    setActionError('')
    try {
      await reactivateWorkerRequest(worker)
      clearWorkerControlDataCache()
      setState(await loadWorkerControlData({ date, category, workerId, authKey }))
    } catch (error) {
      setActionError(error?.message || 'تعذر تفعيل العامل.')
    } finally {
      setReactivating(false)
    }
  }
  const refreshAttendance = async () => {
    invalidateWorkerControlAttendanceCache()
    setState(await loadWorkerControlData({ date, category, workerId, authKey }))
  }
  const refreshAll = async () => {
    clearWorkerControlDataCache()
    setRefreshing(true)
    setLoadError('')
    try {
      setState(await loadWorkerControlData({ date, category, workerId, authKey }))
      setHasData(true)
    } catch (error) {
      setLoadError(error?.message || 'تعذر تحديث بيانات المتابعة.')
    } finally {
      setRefreshing(false)
    }
  }

  const config = workerControlCategories.find((item) => item.key === category)
  const team = pages.rows.teams.find((item) => String(item.id) === String(teamId))
  const monthlyRows = [...(pages.rows.monthly || [])].filter((row) => {
    const query = search.trim().toLocaleLowerCase()
    return row.detail.monthCounts.absent >= minimumAbsences
      && (!teamFilter || String(row.worker.team_id) === teamFilter)
      && (!query || `${row.worker.full_name || ''} ${row.worker.employee_code || ''}`.toLocaleLowerCase().includes(query))
  }).sort((a, b) => b.detail.monthCounts.absent - a.detail.monthCounts.absent || String(a.worker.full_name || '').localeCompare(String(b.worker.full_name || '')))
  const rows = category === 'monthly' ? monthlyRows : category === 'consecutive-absence'
    ? [...pages.rows['consecutive-absence']].sort((a, b) => b.currentStreak - a.currentStreak)
    : pages.rows[category] || []
  const subject = category === 'team-detail' ? { title: team?.name || 'الفريق', description: 'العمال التشغيليون في هذا الفريق وحالة حضورهم اليوم.' } : config

  let columns = []
  if (category === 'absent-today') columns = [workerName, workerCode, teamName, { label: 'الدخول', render: (row) => timeText(row.detail.today.checkIn) }, { label: 'الخروج', render: (row) => timeText(row.detail.today.checkOut) }, { label: 'غياب الشهر', render: (row) => row.detail.monthCounts.absent }, { label: 'آخر حضور', render: (row) => dateText(row.detail.lastAttendance) }, details]
  if (category === 'consecutive-absence') columns = [workerName, teamName, { label: 'أيام الغياب المتتالي', render: (row) => <b className="text-lg text-(--primary)">{row.currentStreak} يوم</b> }, { label: 'فترة الغياب', render: (row) => <span className="inline-flex items-center gap-3"><span dir="ltr">{dateText(row.currentDates.at(-1)).slice(0, 5)} → {dateText(row.currentDates[0]).slice(0, 5)}</span><button type="button" className="text-sm font-semibold text-(--primary) hover:underline" onClick={() => setVisibleAbsenceDays(row)}>عرض الأيام</button></span> }, { label: 'غياب الشهر', render: (row) => row.monthAbsent || 0 }, { label: 'آخر حضور', render: (row) => dateText(row.lastAttendance?.attendance_date) }, details]
  if (category === 'weekly') columns = [workerName, workerCode, teamName, { label: 'غياب الأسبوع', render: (row) => row.weekAbsent || 0 }, { label: 'أيام متتالية هذا الأسبوع', render: (row) => row.weekLongest || 0 }, details]
  if (category === 'monthly') columns = [workerName, teamName, { label: 'حضور الشهر', render: (row) => row.detail.monthCounts.present }, { label: 'غياب الشهر', render: (row) => row.detail.monthCounts.absent }, { label: 'نصف يوم', render: (row) => row.detail.monthCounts.halfDay }, { label: 'أطول غياب متتالٍ', render: (row) => row.detail.longestAbsence }, { label: 'الغياب المتتالي الحالي', render: (row) => row.detail.currentAbsence }, { label: 'آخر حضور', render: (row) => dateText(row.detail.lastAttendance) }, details]
  if (category === 'half-day') columns = [workerName, workerCode, teamName, { label: 'نصف يوم هذا الأسبوع', render: (row) => row.weekHalf }, { label: 'نصف يوم هذا الشهر', render: (row) => row.monthHalf }, { label: 'حالة اليوم', render: (row) => dayStatus(row.todayRow) }, { label: 'الدخول', render: (row) => timeText(row.todayRow?.check_in) }, { label: 'الخروج', render: (row) => timeText(row.todayRow?.check_out) }, details]
  if (category === 'inactive-punched') columns = [workerName, teamName, { label: 'رقم البصمة', render: (row) => row.lastPunch?.device_employee_no || '—' }, { label: 'الجهاز', render: (row) => row.lastPunch?.device_id || '—' }, { label: 'أول بصمة', render: (row) => timeText(row.firstPunch?.event_timestamp) }, { label: 'آخر بصمة', render: (row) => timeText(row.lastPunch?.event_timestamp) }, { label: 'عدد البصمات', render: (row) => row.punchCount }, details, { label: 'تفعيل', render: (row) => <button type="button" className="btn-primary px-3 py-1" disabled={reactivating} onClick={() => reactivate(row.worker)}>تفعيل العامل</button> }]
  if (category === 'activated-today') columns = [workerName, teamName, { label: 'وقت التفعيل', render: (row) => timeText(row.activation?.activated_at) }, { label: 'بداية التشغيل', render: (row) => row.worker?.operational_start_date || '—' }, { label: 'رقم البصمة', render: (row) => row.activation?.biometric_ids?.join(' · ') || '—' }, details, { label: 'استرجاع حضور الأسبوع', render: (row) => <Link className="btn-secondary px-3 py-1" to={workerLink(row.worker, true).pathname} state={workerLink(row.worker, true).state}>استرجاع حضور الأسبوع</Link> }]
  if (category === 'returned') columns = [workerName, workerCode, teamName, { label: 'الغياب السابق', render: (row) => row.longest || 0 }, { label: 'حالة العودة', render: (row) => dayStatus(row.todayRow) }, { label: 'غياب الشهر', render: (row) => row.monthAbsent || 0 }, details]
  if (category === 'teams') columns = [{ label: 'الفريق', render: (row) => <b>{row.name || '—'}</b> }, { label: 'العمال النشطون', render: (row) => row.active }, { label: 'حاضر اليوم', render: (row) => row.present }, { label: 'نصف يوم', render: (row) => row.halfDay }, { label: 'غائب', render: (row) => row.absent }, { label: 'غير مسجل', render: (row) => row.notRecorded }, { label: 'غياب الأسبوع', render: (row) => row.weekAbsent }, { label: 'غياب الشهر', render: (row) => row.monthAbsent }, { label: 'التفاصيل', render: (row) => <Link className="btn-secondary px-3 py-1" to={`${base}/teams/${encodeURIComponent(row.id)}`}>التفاصيل</Link> }]
  if (category === 'team-detail') columns = [workerName, workerCode, { label: 'حالة اليوم', render: (row) => dayStatus(pages.details.get(String(row.worker.id))?.today) }, { label: 'غياب الشهر', render: (row) => pages.details.get(String(row.worker.id))?.monthCounts.absent ?? 0 }, details]
  const displayedRows = category === 'team-detail' ? (team?.workers || []).map((worker) => ({ worker })) : rows

  if (category === 'worker-detail') return <WorkerControlWorkerPage detail={hasData ? selectedDetail : null} basicWorker={basicWorker || selectedWorker} currentStreak={pages.rows['consecutive-absence'].find((row) => String(row.worker.id) === workerId)} loading={loading} loadError={loadError} backTo={location.state?.from?.startsWith(`${base}/`) && !location.state.from.startsWith(`${base}/worker/`) ? location.state.from : base} focusActions={location.state?.focusActions === true} onReactivate={reactivate} reactivating={reactivating} onRecovered={refreshAttendance} actionError={actionError} />

  return <section className="w-full pb-12" dir="rtl">
    <button type="button" className="btn-secondary mb-5 px-3 py-1" aria-label="تحديث بيانات المتابعة" disabled={refreshing} onClick={refreshAll}>{refreshing ? 'جارٍ التحديث...' : 'تحديث'}</button>
    {category ? <>
      <Link className="mb-7 inline-flex text-base font-bold text-(--primary) hover:underline" to={base}>← العودة إلى مركز مراقبة العمال</Link>
      <div className="mb-7"><h2 className="text-3xl font-extrabold">{subject?.title || 'مركز مراقبة العمال'}</h2><p className="mt-2 text-base text-(--muted)">{subject?.description}</p>{category === 'weekly' ? <p className="mt-3 text-lg font-bold">هذا الأسبوع: <span dir="ltr" className="inline-block">{dateText(period.weekStart)} → {dateText(period.weekEnd)}</span></p> : null}{category === 'monthly' ? <p className="mt-3 text-lg font-bold">هذا الشهر: <span dir="ltr" className="inline-block">{dateText(period.monthStart)} → {dateText(period.monthEnd)}</span></p> : null}{category === 'team-detail' ? <Link className="mt-3 inline-flex font-semibold text-(--primary) hover:underline" to={`${base}/teams`}>العودة إلى مراقبة الفرق</Link> : null}</div>
      {category === 'monthly' ? <div className="mb-6 flex flex-wrap gap-3"><input type="search" className="input-base max-w-xs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالاسم أو كود الموظف" aria-label="بحث عن عامل" /><select className="input-base max-w-xs" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)} aria-label="تصفية حسب الفريق"><option value="">كل الفرق</option>{pages.rows.teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select className="input-base max-w-xs" value={minimumAbsences} onChange={(event) => setMinimumAbsences(Number(event.target.value))} aria-label="الحد الأدنى للغياب"><option value={1}>غياب يوم أو أكثر</option><option value={3}>غياب 3 أيام أو أكثر</option><option value={5}>غياب 5 أيام أو أكثر</option></select></div> : null}
      {loading ? <p className="py-8 text-(--muted)">جارٍ تحميل بيانات المتابعة...</p> : loadError && !hasData ? <p className="alert alert--error">{loadError}</p> : <>{loadError ? <p className="alert alert--error mb-4">{loadError}</p> : null}<p className="mb-4 text-base font-bold">{displayedRows.length} {category === 'teams' ? 'فرق' : 'عامل'}</p><SubjectTable rows={displayedRows} columns={columns} /></>}
    </> : <>
      <div className="mb-7"><h2 className="text-3xl font-extrabold">مركز مراقبة العمال</h2><p className="mt-2 text-base text-(--muted)">ملخص تشغيلي سريع. افتح فئة لعرض بياناتها وتفاصيل العمال.</p></div>
      {loadError ? <p className="alert alert--error mb-5">{loadError}</p> : null}
      <div className="mb-7 rounded-xl border border-(--border) bg-white p-5"><label htmlFor="worker-control-search" className="mb-2 block font-bold">بحث عن عامل</label><input id="worker-control-search" type="search" className="input-base w-full max-w-xl" value={workerSearch} onChange={(event) => setWorkerSearch(event.target.value)} placeholder="بحث عن عامل أو رقم البصمة" />{workerSearch.trim() ? <div className="mt-4"><p className="mb-3 text-sm text-(--muted)">{workerSearchRows.length} عامل</p>{searchError ? <p className="alert alert--error mb-3">{searchError}</p> : null}{workerSearchRows.length ? <ul className="max-h-80 space-y-2 overflow-y-auto">{workerSearchRows.map(({ worker, biometricIds }) => <li key={worker.id}><Link to={workerLink(worker).pathname} state={workerLink(worker).state} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-(--border) px-4 py-3 hover:border-(--primary) hover:bg-(--surface-subtle)"><b>{worker.full_name}</b><span>{worker.employee_code || '—'}</span><span>{worker.team?.name || worker.team_name || '—'}</span><span dir="ltr">{biometricIds.join(' · ') || '—'}</span><span className="text-sm text-(--muted)">{worker.is_active ? 'نشط' : 'غير نشط'}</span></Link></li>)}</ul> : <p className="text-(--muted)">لا يوجد عمال مطابقون.</p>}</div> : null}</div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-worker-control-hub>{workerControlCategories.map((item) => <Link key={item.key} to={item.path} className="surface-card flex min-h-36 flex-col justify-between p-5 transition hover:border-(--primary) hover:shadow-md"><div><h3 className="text-lg font-extrabold">{item.title}</h3><p className="mt-2 text-sm text-(--muted)">{item.description}</p></div><div className="mt-5 flex items-end justify-end"><span className="font-bold text-(--primary)">فتح ←</span></div></Link>)}</div>
    </>}
    {actionError ? <p className="alert alert--error mt-5">{actionError}</p> : null}
    {visibleAbsenceDays && category === 'consecutive-absence' ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setVisibleAbsenceDays(null)}><div role="dialog" aria-modal="true" aria-label="أيام الغياب المتتالي" className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><h3 className="text-xl font-bold">أيام الغياب المتتالي</h3><p className="mt-1 text-(--muted)">{visibleAbsenceDays.worker?.full_name}</p></div><button type="button" className="btn-secondary px-3 py-1" onClick={() => setVisibleAbsenceDays(null)}>إغلاق</button></div><ul className="mt-4 max-h-72 overflow-y-auto space-y-2">{[...visibleAbsenceDays.currentDates].reverse().map((day) => <li key={day} className="border-b border-(--border) py-1" dir="ltr">{dateText(day)}</li>)}</ul></div></div> : null}
  </section>
}
