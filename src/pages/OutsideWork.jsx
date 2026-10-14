import { useCallback, useEffect, useMemo, useState } from 'react'
import { getWorkersRequest } from '../api/workersApi'
import { deleteOutsideWorkMovement, getOutsideWorkMovements, saveOutsideWorkMovement } from '../api/outsideWorkApi'
import { getErrorMessage } from '../api/axios'
import { useTranslation } from '../i18n/LanguageContext'
import { kinshasaClock } from '../utils/attendanceOperationalGate'
import { durationMinutes, foremanKey, formatClock, formatDuration, weekDays, weeklyForemanReport } from '../utils/outsideWork'
import { outsideWorkEligibleWorkers, outsideWorkForemen, searchOutsideWorkPeople } from '../utils/outsideWorkRoster'

const emptyForm = (date) => ({ id: null, work_date: date, foreman_worker_id: '', foreman_name: '',
  start_time: '08:00', end_time: '17:00', note: '', workers: [] })
const labelSets = {
  ar: { title: 'العمل الخارجي', week: 'الأسبوع', add: 'إضافة حركة معلم', date: 'التاريخ', foreman: 'المعلم',
    foremanName: 'اسم المعلم', start: 'البداية', end: 'النهاية', workers: 'العمال', commonStart: 'بداية العمال المشتركة',
    commonEnd: 'نهاية العمال المشتركة', note: 'ملاحظة', save: 'حفظ', cancel: 'إلغاء', edit: 'تعديل', delete: 'حذف',
    show: 'عرض العمال', hide: 'إخفاء العمال', report: 'تقرير المعلم الأسبوعي', print: 'طباعة تقرير المعلم الأسبوعي',
    movementCount: 'عدد الحركات', dayCount: 'أيام العمل الخارجي', totalHours: 'إجمالي الساعات', average: 'متوسط اليوم',
    duration: 'المدة', count: 'عدد العمال', noMovements: 'لا توجد حركات لهذا اليوم', search: 'ابحث عن عامل',
    manualForeman: 'معلم غير مسجل كعامل', chooseForeman: 'اختر المعلم', chooseReport: 'اختر معلماً للتقرير',
    workerTimes: 'يمكن تعديل وقت كل عامل بعد اختياره', invalid: 'أدخل أوقاتاً صحيحة، بحيث تكون النهاية بعد البداية.',
    confirmDelete: 'حذف هذه الحركة؟', day: 'اليوم', loading: 'جاري التحميل...',
    formTitle: 'إضافة حركة عمل خارجي', editTitle: 'تعديل حركة عمل خارجي', searchForeman: 'ابحث عن معلم أجنبي',
    selectedWorkers: 'العمال المختارون', override: 'تعديل وقت عامل', removeWorker: 'إزالة العامل',
    changeForeman: 'تغيير المعلم', noMatches: 'لا توجد نتائج مطابقة', selectForemanError: 'اختر معلماً أجنبياً أو أدخل معلماً غير مسجل.',
    manualName: 'اسم المعلم غير المسجل', manualToggle: 'معلم غير مسجل' },
  en: { title: 'Outside Work', week: 'Week', add: 'Add foreman movement', date: 'Date', foreman: 'Foreman',
    foremanName: 'Foreman name', start: 'Start', end: 'End', workers: 'Workers', commonStart: 'Common worker start',
    commonEnd: 'Common worker end', note: 'Note', save: 'Save', cancel: 'Cancel', edit: 'Edit', delete: 'Delete',
    show: 'Show workers', hide: 'Hide workers', report: 'Weekly foreman report', print: 'Print Weekly Foreman Report',
    movementCount: 'Movements', dayCount: 'Outside-work days', totalHours: 'Total hours', average: 'Daily average',
    duration: 'Duration', count: 'Worker count', noMovements: 'No movements for this day', search: 'Search workers',
    manualForeman: 'Foreman not in worker list', chooseForeman: 'Select foreman', chooseReport: 'Select a foreman',
    workerTimes: 'You can override each selected worker’s times', invalid: 'Enter valid times with end after start.',
    confirmDelete: 'Delete this movement?', day: 'Day', loading: 'Loading...',
    formTitle: 'Add outside-work movement', editTitle: 'Edit outside-work movement', searchForeman: 'Search foreign foremen',
    selectedWorkers: 'Selected workers', override: 'Override worker time', removeWorker: 'Remove worker',
    changeForeman: 'Change foreman', noMatches: 'No matches', selectForemanError: 'Select a foreign foreman or enter an unregistered foreman.',
    manualName: 'Unregistered foreman name', manualToggle: 'Unregistered foreman' },
  fr: { title: 'Travail extérieur', week: 'Semaine', add: 'Ajouter un déplacement', date: 'Date', foreman: 'Chef d’équipe',
    foremanName: 'Nom du chef', start: 'Début', end: 'Fin', workers: 'Travailleurs', commonStart: 'Début commun',
    commonEnd: 'Fin commune', note: 'Note', save: 'Enregistrer', cancel: 'Annuler', edit: 'Modifier', delete: 'Supprimer',
    show: 'Afficher les travailleurs', hide: 'Masquer les travailleurs', report: 'Rapport hebdomadaire du chef',
    print: 'Imprimer le rapport hebdomadaire', movementCount: 'Déplacements', dayCount: 'Jours extérieurs',
    totalHours: 'Heures totales', average: 'Moyenne quotidienne', duration: 'Durée', count: 'Travailleurs',
    noMovements: 'Aucun déplacement ce jour', search: 'Rechercher un travailleur',
    manualForeman: 'Chef hors liste', chooseForeman: 'Choisir le chef', chooseReport: 'Choisir un chef',
    workerTimes: 'Les horaires individuels peuvent être modifiés', invalid: 'La fin doit suivre le début.',
    confirmDelete: 'Supprimer ce déplacement ?', day: 'Jour', loading: 'Chargement...',
    formTitle: 'Ajouter un déplacement extérieur', editTitle: 'Modifier le déplacement extérieur',
    searchForeman: 'Rechercher un chef étranger', selectedWorkers: 'Travailleurs sélectionnés',
    override: 'Modifier les horaires individuels', removeWorker: 'Retirer le travailleur',
    changeForeman: 'Changer de chef', noMatches: 'Aucun résultat',
    selectForemanError: 'Choisir un chef étranger ou saisir un chef non enregistré.',
    manualName: 'Nom du chef non enregistré', manualToggle: 'Chef non enregistré' },
}

export default function OutsideWork() {
  const { language } = useTranslation()
  const l = labelSets[language] || labelSets.en
  const [anchor, setAnchor] = useState(() => kinshasaClock().date)
  const days = useMemo(() => weekDays(anchor), [anchor])
  const [movements, setMovements] = useState([])
  const [workers, setWorkers] = useState([])
  const [form, setForm] = useState(null)
  const [common, setCommon] = useState({ start: '08:00', end: '17:00' })
  const [search, setSearch] = useState('')
  const [foremanSearch, setForemanSearch] = useState('')
  const [manualForeman, setManualForeman] = useState(false)
  const [expanded, setExpanded] = useState([])
  const [reportForeman, setReportForeman] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!days.length) return
    setLoading(true)
    try {
      const [rows, roster] = await Promise.all([
        getOutsideWorkMovements(days[0], days[6]), getWorkersRequest({ includePayrollProfiles: false }),
      ])
      setMovements(rows)
      setWorkers(roster.data || [])
      setError('')
    } catch (cause) { setError(getErrorMessage(cause)) }
    finally { setLoading(false) }
  }, [days])
  useEffect(() => { load() }, [load])

  const foreignForemen = useMemo(() => outsideWorkForemen(workers), [workers])
  const eligibleWorkers = useMemo(() => outsideWorkEligibleWorkers(workers, form?.work_date), [workers, form?.work_date])
  const visibleForemen = useMemo(() => searchOutsideWorkPeople(foreignForemen, foremanSearch).slice(0, 12), [foreignForemen, foremanSearch])
  const visibleWorkers = useMemo(() => searchOutsideWorkPeople(eligibleWorkers, search).slice(0, 25), [eligibleWorkers, search])
  const foremen = useMemo(() => [...new Map(movements.map((row) => [foremanKey(row), row.foreman_name])).entries()], [movements])
  const report = useMemo(() => weeklyForemanReport(movements, reportForeman, days), [movements, reportForeman, days])
  const reportName = foremen.find(([key]) => key === reportForeman)?.[1] || ''
  const nameForSelected = (entry) => eligibleWorkers.find((worker) => worker.id === entry.worker_id)?.full_name
    || entry.worker_name || entry.worker_id
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const toggleWorker = (worker) => setForm((current) => ({ ...current, workers: current.workers.some((row) => row.worker_id === worker.id)
    ? current.workers.filter((row) => row.worker_id !== worker.id)
    : [...current.workers, { worker_id: worker.id, worker_name: worker.full_name,
      start_time: common.start, end_time: common.end }] }))
  const updateWorker = (id, key, value) => setForm((current) => ({ ...current,
    workers: current.workers.map((row) => row.worker_id === id ? { ...row, [key]: value } : row) }))
  const changeCommon = (key, value) => {
    setCommon((current) => ({ ...current, [key]: value }))
    setForm((current) => ({ ...current, workers: current.workers.map((row) => ({ ...row,
      [key === 'start' ? 'start_time' : 'end_time']: value })) }))
  }
  const edit = (movement) => {
    setForm({ id: movement.id, work_date: movement.work_date,
      foreman_worker_id: movement.foreman_worker_id || '', foreman_name: movement.foreman_name,
      start_time: movement.start_time.slice(0, 5), end_time: movement.end_time.slice(0, 5),
      note: movement.note || '', workers: (movement.outside_work_movement_workers || []).map((row) => ({
        worker_id: row.worker_id, worker_name: row.worker_name,
        start_time: row.start_time.slice(0, 5), end_time: row.end_time.slice(0, 5),
      })) })
    setCommon({ start: '08:00', end: '17:00' })
    setSearch('')
    setForemanSearch('')
    setManualForeman(!movement.foreman_worker_id)
  }
  const save = async (event) => {
    event.preventDefault()
    if (!form.foreman_worker_id && (!manualForeman || !form.foreman_name.trim())) {
      setError(l.selectForemanError); return
    }
    if (durationMinutes(form.start_time, form.end_time) == null
      || form.workers.some((row) => durationMinutes(row.start_time, row.end_time) == null)) {
      setError(l.invalid); return
    }
    setBusy(true); setError('')
    try { await saveOutsideWorkMovement(form); await load(); setForm(null) }
    catch (cause) { setError(getErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  const remove = async (id) => {
    if (!window.confirm(l.confirmDelete)) return
    setBusy(true); setError('')
    try { await deleteOutsideWorkMovement(id); await load() }
    catch (cause) { setError(getErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  const dateLabel = (date) => new Intl.DateTimeFormat(language === 'ar' ? 'ar-CD' : language,
    { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))

  return <div className="outside-work-page space-y-7">
    <style>{`@media print { @page { size: A4 portrait; margin: 14mm; }
      .app-sidebar, main > header, .outside-work-page > :not(.outside-work-print) { display: none !important; }
      main, main > div, .outside-work-page { max-width: none !important; width: 100% !important; padding: 0 !important; margin: 0 !important; }
      .outside-work-print { display: block !important; width: 100%; color: #111; }
      .outside-work-print tr { break-inside: avoid; } .outside-work-print thead { display: table-header-group; } }`}</style>
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-2xl font-extrabold">{l.title}</h1><p className="text-sm text-(--muted)">{days[0]} → {days[6]}</p></div>
      <div className="flex flex-wrap gap-3"><label className="text-sm font-semibold">{l.week} <input aria-label={l.week} type="date" value={anchor} onChange={(event) => setAnchor(event.target.value)} className="form-input ms-2 rounded-lg border p-2" /></label>
        <button type="button" className="btn-primary" onClick={() => {
          setForm(emptyForm(days.includes(kinshasaClock().date) ? kinshasaClock().date : days[0]))
          setSearch(''); setForemanSearch(''); setManualForeman(false)
        }}>{l.add}</button></div>
    </header>
    {error && <p role="alert" className="alert alert--error">{error}</p>}
    {form && <form onSubmit={save} className="surface-card overflow-hidden rounded-2xl border border-(--border) shadow-sm" aria-label={l.add}>
      <div className="border-b border-(--border) bg-(--surface-subtle) px-5 py-4 sm:px-6"><h2 className="text-lg font-extrabold">{form.id ? l.editTitle : l.formTitle}</h2></div>
      <div className="space-y-6 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-bold">{l.date}<input aria-label={l.date} required type="date" value={form.work_date} onChange={(event) => update('work_date', event.target.value)} className="input-base mt-1 w-full" /></label>
          <div className="relative text-sm font-bold">{l.foreman}
            {form.foreman_worker_id && !manualForeman ? <div className="mt-1 flex min-h-11 items-center justify-between gap-3 rounded-xl border border-(--border) bg-(--primary-soft) px-3 py-2">
              <span>{form.foreman_name}{foreignForemen.find((worker) => worker.id === form.foreman_worker_id)?.employee_code ? ` · ${foreignForemen.find((worker) => worker.id === form.foreman_worker_id).employee_code}` : ''}</span>
              <button type="button" className="text-xs font-bold text-(--primary-strong)" onClick={() => { update('foreman_worker_id', ''); update('foreman_name', ''); setForemanSearch('') }}>{l.changeForeman}</button>
            </div> : manualForeman ? <input aria-label={l.manualName} required value={form.foreman_name} onChange={(event) => update('foreman_name', event.target.value)} className="input-base mt-1 w-full" />
              : <><input aria-label={l.searchForeman} value={foremanSearch} onChange={(event) => setForemanSearch(event.target.value)} placeholder={l.searchForeman} className="input-base mt-1 w-full" />
                {foremanSearch.trim() && <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-(--border) bg-white p-1 shadow-lg" role="listbox" aria-label={l.foreman}>
                  {visibleForemen.length ? visibleForemen.map((worker) => <button type="button" role="option" aria-selected="false" key={worker.id} onClick={() => {
                    setForm((current) => ({ ...current, foreman_worker_id: worker.id, foreman_name: worker.full_name }))
                    setForemanSearch('')
                  }} className="block w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-(--primary-soft)">{worker.full_name}{worker.employee_code ? ` · ${worker.employee_code}` : ''}</button>)
                    : <p className="px-3 py-2 text-sm text-(--muted)">{l.noMatches}</p>}
                </div>}</>}
            {!form.foreman_worker_id && <button type="button" className="mt-2 text-xs font-semibold text-(--muted) underline" onClick={() => {
              setManualForeman((current) => !current); setForemanSearch(''); update('foreman_name', '')
            }}>{manualForeman ? l.searchForeman : l.manualToggle}</button>}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-bold">{l.start}<input aria-label={`Foreman ${l.start}`} required type="time" value={form.start_time} onChange={(event) => update('start_time', event.target.value)} className="input-base mt-1 w-full" /></label>
          <label className="block text-sm font-bold">{l.end}<input aria-label={`Foreman ${l.end}`} required type="time" value={form.end_time} onChange={(event) => update('end_time', event.target.value)} className="input-base mt-1 w-full" /></label>
        </div>
        <div className="border-t border-(--border) pt-5"><h3 className="font-extrabold">{l.workers}</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-bold">{l.commonStart}<input aria-label={l.commonStart} type="time" value={common.start} onChange={(event) => changeCommon('start', event.target.value)} className="input-base mt-1 w-full" /></label>
            <label className="block text-sm font-bold">{l.commonEnd}<input aria-label={l.commonEnd} type="time" value={common.end} onChange={(event) => changeCommon('end', event.target.value)} className="input-base mt-1 w-full" /></label>
          </div>
          <label className="mt-4 block text-sm font-bold">{l.search}<input aria-label={l.search} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={l.search} className="input-base mt-1 w-full" /></label>
          {search.trim() && <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-(--border) bg-white p-2" role="listbox" aria-label={l.workers}>
            {visibleWorkers.length ? visibleWorkers.map((worker) => <button type="button" role="option" aria-selected={form.workers.some((row) => row.worker_id === worker.id)} key={worker.id} onClick={() => toggleWorker(worker)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-sm hover:bg-(--primary-soft)"><span>{worker.full_name}{worker.employee_code ? ` · ${worker.employee_code}` : ''}</span><span aria-hidden="true">{form.workers.some((row) => row.worker_id === worker.id) ? '✓' : '+'}</span></button>)
              : <p className="px-3 py-2 text-sm text-(--muted)">{l.noMatches}</p>}
          </div>}
          <p className="mt-4 text-sm font-bold">{l.selectedWorkers}: {form.workers.length}</p>
          {form.workers.length > 0 && <><div className="mt-2 flex flex-wrap gap-2">{form.workers.map((row) => <span key={row.worker_id} className="inline-flex items-center gap-2 rounded-full border border-(--border) bg-(--surface-subtle) px-3 py-1.5 text-sm font-semibold">{nameForSelected(row)}<button type="button" aria-label={`${l.removeWorker}: ${nameForSelected(row)}`} onClick={() => setForm((current) => ({ ...current, workers: current.workers.filter((item) => item.worker_id !== row.worker_id) }))} className="text-lg leading-none text-(--muted) hover:text-red-600">×</button></span>)}</div>
            <details className="mt-3 rounded-xl border border-(--border) bg-white p-3"><summary className="cursor-pointer text-sm font-bold">{l.override}</summary><div className="mt-3 space-y-2">{form.workers.map((row) => <div key={row.worker_id} className="grid items-center gap-2 rounded-lg bg-(--surface-subtle) p-2 text-sm sm:grid-cols-3"><strong>{nameForSelected(row)}</strong><label>{l.start} <input aria-label={`${nameForSelected(row)} ${l.start}`} type="time" value={row.start_time} onChange={(event) => updateWorker(row.worker_id, 'start_time', event.target.value)} className="input-base mt-1 w-full" /></label><label>{l.end} <input aria-label={`${nameForSelected(row)} ${l.end}`} type="time" value={row.end_time} onChange={(event) => updateWorker(row.worker_id, 'end_time', event.target.value)} className="input-base mt-1 w-full" /></label></div>)}</div></details></>}
        </div>
        <label className="block text-sm font-bold">{l.note}<input aria-label={l.note} value={form.note} onChange={(event) => update('note', event.target.value)} className="input-base mt-1 w-full" /></label>
        <div className="flex gap-2 border-t border-(--border) pt-4"><button type="submit" disabled={busy} className="btn-primary">{l.save}</button><button type="button" onClick={() => setForm(null)} className="btn-secondary">{l.cancel}</button></div>
      </div>
    </form>}
    {loading ? <p>{l.loading}</p> : days.map((day) => {
      const rows = movements.filter((movement) => movement.work_date === day)
      return <section key={day} className="surface-card p-4 sm:p-5"><h2 className="mb-3 text-lg font-extrabold">{dateLabel(day)} <span className="text-sm text-(--muted)">({rows.length})</span></h2>
        {!rows.length && <p className="text-sm text-(--muted)">{l.noMovements}</p>}
        <div className="space-y-3">{rows.map((row) => {
          const members = row.outside_work_movement_workers || []
          const open = expanded.includes(row.id)
          return <article key={row.id} className="rounded-xl border p-3"><div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <strong className="text-base">{row.foreman_name}</strong><span dir="ltr">{formatClock(row.start_time)} → {formatClock(row.end_time)}</span>
            <span>{l.duration}: {formatDuration(durationMinutes(row.start_time, row.end_time))}</span><span>{l.count}: {members.length}</span>
            <div className="ms-auto flex gap-2"><button type="button" className="btn-secondary" onClick={() => setExpanded((current) => open ? current.filter((id) => id !== row.id) : [...current, row.id])}>{open ? l.hide : `${l.show} (${members.length})`}</button>
              <button type="button" className="btn-secondary" onClick={() => edit(row)}>{l.edit}</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => remove(row.id)}>{l.delete}</button></div></div>
            {open && <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-start">{l.workers}</th><th className="p-2 text-start">{l.start}</th><th className="p-2 text-start">{l.end}</th></tr></thead><tbody>{members.map((member) => <tr key={member.id} className="border-t"><td className="p-2">{member.worker_name}</td><td className="p-2" dir="ltr">{formatClock(member.start_time)}</td><td className="p-2" dir="ltr">{formatClock(member.end_time)}</td></tr>)}</tbody></table></div>}
          </article>
        })}</div>
      </section>
    })}
    <section className="surface-card space-y-4 p-5"><h2 className="text-xl font-extrabold">{l.report}</h2>
      <div className="flex flex-wrap gap-3"><label>{l.foreman} <select aria-label={l.chooseReport} value={reportForeman} onChange={(event) => setReportForeman(event.target.value)} className="ms-2 rounded-lg border p-2"><option value="">{l.chooseReport}</option>{foremen.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <button type="button" disabled={!report.rows.length} className="btn-secondary" onClick={() => window.print()}>{l.print}</button></div>
      {reportForeman && <><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{[l.day, l.date, l.start, l.end, l.duration, l.count].map((item) => <th key={item} className="p-2 text-start">{item}</th>)}</tr></thead><tbody>{report.rows.map((row) => <tr key={row.id} className="border-t"><td className="p-2">{dateLabel(row.work_date).split(' ')[0]}</td><td className="p-2">{row.work_date}</td><td className="p-2" dir="ltr">{formatClock(row.start_time)}</td><td className="p-2" dir="ltr">{formatClock(row.end_time)}</td><td className="p-2">{formatDuration(durationMinutes(row.start_time, row.end_time))}</td><td className="p-2">{row.outside_work_movement_workers?.length || 0}</td></tr>)}</tbody></table></div>
        <div className="flex flex-wrap gap-5 text-sm font-bold"><span>{l.dayCount}: {report.dayCount}</span><span>{l.totalHours}: {formatDuration(report.totalMinutes)}</span><span>{l.average}: {formatDuration(report.averageMinutes)}</span><span>{l.movementCount}: {report.movementCount}</span></div></>}
    </section>
    <section className="outside-work-print hidden" aria-hidden="true"><h1>{l.report}</h1><h2>{reportName}</h2><p>{days[0]} → {days[6]}</p>
      <table className="w-full border-collapse text-sm"><thead><tr>{[l.day, l.date, l.start, l.end, l.duration, l.count].map((item) => <th key={item} className="border p-2 text-start">{item}</th>)}</tr></thead><tbody>{report.rows.map((row) => <tr key={row.id}><td className="border p-2">{dateLabel(row.work_date).split(' ')[0]}</td><td className="border p-2">{row.work_date}</td><td className="border p-2">{formatClock(row.start_time)}</td><td className="border p-2">{formatClock(row.end_time)}</td><td className="border p-2">{formatDuration(durationMinutes(row.start_time, row.end_time))}</td><td className="border p-2">{row.outside_work_movement_workers?.length || 0}</td></tr>)}</tbody></table>
      <p className="mt-4">{l.dayCount}: {report.dayCount} · {l.totalHours}: {formatDuration(report.totalMinutes)} · {l.average}: {formatDuration(report.averageMinutes)} · {l.movementCount}: {report.movementCount}</p>
    </section>
  </div>
}
