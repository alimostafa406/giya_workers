import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getWorkersRequest } from '../api/workersApi'
import { deleteOutsideWorkMovement, getOutsideWorkMovements, getOutsideWorkTeams, saveOutsideWorkMovement } from '../api/outsideWorkApi'
import { getErrorMessage } from '../api/axios'
import { useTranslation } from '../i18n/LanguageContext'
import { kinshasaClock } from '../utils/attendanceOperationalGate'
import { durationMinutes, foremanKey, formatClock, formatDuration, hasOutsideWorkForeman, isFinalOutsideWorkMovement, newOutsideWorkForm, outsideWorkFinalError, outsideWorkForm, weekDays, weeklyForemanReport } from '../utils/outsideWork'
import OutsideWorkEntryForm from '../components/OutsideWork/OutsideWorkEntryForm'
import { getWorkerBiometricSearchIndexRequest } from '../api/biometricMappingApi'
import { biometricIdsByWorker } from '../utils/dailyOperationalReports'

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


const flowLabels = {
  ar: { team: 'الفريق', chooseTeam: 'اختر الفريق', teamWorkers: 'عمال الفريق', selectAll: 'اختيار كل عمال الفريق',
    deselectAll: 'إلغاء تحديد عمال الفريق', selected: 'المحددون', of: 'من', teamSearch: 'بحث داخل الفريق',
    otherSearch: 'إضافة عامل من فريق آخر', otherPlaceholder: 'اسم العامل / كود العامل / رقم البصمة',
    otherTeams: 'من فرق أخرى', missingWorker: 'عامل غير موجود', openWorkers: 'فتح صفحة العمال',
    savedBeforeWorkers: 'سيتم حفظ المسودة قبل فتح صفحة العمال. عند العودة يمكنك إكمالها.',
    saveDraft: 'حفظ كمسودة', saveFinal: 'حفظ', movements: 'الحركات', drafts: 'المسودات',
    continue: 'متابعة', updated: 'آخر تحديث', noDrafts: 'لا توجد مسودات', saved: 'تم الحفظ',
    required: 'التاريخ والفريق مطلوبان للحفظ النهائي.', unresolved: 'أكمل العامل غير الموجود أو امسح الملاحظة قبل الحفظ النهائي.',
    selectWorkers: 'اختر عاملاً حقيقياً واحداً على الأقل.', historyTimes: 'أوقات العمال المحفوظة مختلفة؛ ستبقى كما هي إلى أن تعدّل وقت العمال المشترك.' },
  en: { team: 'Team', chooseTeam: 'Select team', teamWorkers: 'Team workers', selectAll: 'Select all team workers',
    deselectAll: 'Deselect team workers', selected: 'Selected', of: 'of', teamSearch: 'Search within team',
    otherSearch: 'Add worker from another team', otherPlaceholder: 'Worker name / employee code / biometric ID',
    otherTeams: 'From other teams', missingWorker: 'Worker not found', openWorkers: 'Open Workers page',
    savedBeforeWorkers: 'Your draft is saved before opening Workers. Return to continue it.',
    saveDraft: 'Save as draft', saveFinal: 'Save', movements: 'Movements', drafts: 'Drafts',
    continue: 'Continue', updated: 'Last updated', noDrafts: 'No drafts', saved: 'Saved',
    required: 'Date and team are required for final save.', unresolved: 'Resolve or clear the missing-worker note before final save.',
    selectWorkers: 'Select at least one real worker.', historyTimes: 'Saved worker times differ; they remain unchanged until you edit the shared worker times.' },
  fr: { team: 'Équipe', chooseTeam: 'Choisir une équipe', teamWorkers: 'Travailleurs de l’équipe',
    selectAll: 'Sélectionner toute l’équipe', deselectAll: 'Désélectionner l’équipe', selected: 'Sélectionnés', of: 'sur',
    teamSearch: 'Rechercher dans l’équipe', otherSearch: 'Ajouter un travailleur d’une autre équipe',
    otherPlaceholder: 'Nom / code employé / ID biométrique', otherTeams: 'Autres équipes',
    missingWorker: 'Travailleur introuvable', openWorkers: 'Ouvrir la page Travailleurs',
    savedBeforeWorkers: 'Le brouillon sera enregistré avant l’ouverture. Revenez pour le compléter.',
    saveDraft: 'Enregistrer le brouillon', saveFinal: 'Enregistrer', movements: 'Déplacements',
    drafts: 'Brouillons', continue: 'Continuer', updated: 'Dernière modification', noDrafts: 'Aucun brouillon',
    saved: 'Enregistré', required: 'La date et l’équipe sont requises.',
    unresolved: 'Résoudre ou effacer la note du travailleur introuvable avant l’enregistrement final.',
    selectWorkers: 'Sélectionner au moins un travailleur.', historyTimes: 'Les horaires enregistrés diffèrent ; ils restent inchangés jusqu’à modification des horaires communs.' },
}

export default function OutsideWork() {
  const { language } = useTranslation()
  const reportLabels = {
    ar: { foremanStart: 'بداية المعلم', foremanEnd: 'نهاية المعلم', overtime: 'الوقت الإضافي', totalOvertime: 'إجمالي الوقت الإضافي للمعلم' },
    en: { foremanStart: 'Foreman Start', foremanEnd: 'Foreman End', overtime: 'Overtime', totalOvertime: 'Total foreman overtime' },
    fr: { foremanStart: 'Début du chef', foremanEnd: 'Fin du chef', overtime: 'Heures supplémentaires', totalOvertime: 'Total des heures supplémentaires du chef' },
  }
  const l = { ...(labelSets[language] || labelSets.en), ...(flowLabels[language] || flowLabels.en), ...(reportLabels[language] || reportLabels.en) }
  const [params, setParams] = useSearchParams()
  const resumeId = useRef(params.get('draft') || sessionStorage.getItem('outside_work_resume_draft'))
  const [anchor, setAnchor] = useState(() => kinshasaClock().date)
  const days = useMemo(() => weekDays(anchor), [anchor])
  const [movements, setMovements] = useState([])
  const [workers, setWorkers] = useState([])
  const [teams, setTeams] = useState([])
  const [mappings, setMappings] = useState([])
  const [form, setForm] = useState(null)
  const [tab, setTab] = useState('movements')
  const [expanded, setExpanded] = useState([])
  const [reportForeman, setReportForeman] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const generation = useRef(0)
  const load = useCallback(async () => {
    if (!days.length) return
    const current = ++generation.current
    setLoading(true)
    try {
      const [rows, roster, activeTeams, identities] = await Promise.all([
        getOutsideWorkMovements(days[0], days[6]), getWorkersRequest({ includePayrollProfiles: false }),
        getOutsideWorkTeams(), getWorkerBiometricSearchIndexRequest(),
      ])
      if (current !== generation.current) return
      setMovements(rows)
      setWorkers(roster.data || [])
      setTeams(activeTeams)
      setMappings(identities.data || [])
      setError('')
    } catch (cause) { if (current === generation.current) setError(getErrorMessage(cause)) }
    finally { if (current === generation.current) setLoading(false) }
  }, [days])
  useEffect(() => {
    const requests = generation
    load()
    return () => { requests.current++ }
  }, [load])
  useEffect(() => {
    if (loading || !resumeId.current) return
    const draft = movements.find((row) => row.id === resumeId.current && row.status === 'draft')
    if (!draft) return
    resumeId.current = null
    sessionStorage.removeItem('outside_work_resume_draft')
    setForm({ ...outsideWorkForm(draft), team: draft.team })
    setTab('drafts')
  }, [loading, movements])
  const finals = useMemo(() => movements.filter(isFinalOutsideWorkMovement), [movements])
  const drafts = useMemo(() => movements.filter((row) => row.status === 'draft')
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))), [movements])
  const foremen = useMemo(() => [...new Map(finals.filter(hasOutsideWorkForeman).map((row) => [foremanKey(row), row.foreman_name])).entries()], [finals])
  const report = useMemo(() => weeklyForemanReport(finals, reportForeman, days), [finals, reportForeman, days])
  const reportName = foremen.find(([key]) => key === reportForeman)?.[1] || ''
  const biometricIds = useMemo(() => biometricIdsByWorker(mappings), [mappings])
  const workersById = useMemo(() => new Map(workers.map((worker) => [String(worker.id), worker])), [workers])
  const teamName = (movement) => movement.team?.name || teams.find((team) => team.id === movement.team_id)?.name || '—'
  const edit = (movement) => {
    setForm({ ...outsideWorkForm(movement), team: movement.team })
    setSuccess('')
    if (movement.status === 'draft') setParams({ draft: movement.id }, { replace: true })
  }
  const save = async (status) => {
    if (busy || !form) return
    const validation = status === 'final' ? outsideWorkFinalError(form) : ''
    if (validation) { setError(l[validation]); return }
    setBusy(true); setError(''); setSuccess('')
    try {
      const id = await saveOutsideWorkMovement({ ...form, status })
      if (!id) throw new Error('The movement could not be saved.')
      if (form.work_date && !days.includes(form.work_date)) {
        // The anchor change triggers the existing loader for the saved date's week.
        setLoading(true)
        setAnchor(form.work_date)
      } else {
        await load()
      }
      setForm(null)
      setParams({}, { replace: true })
      sessionStorage.removeItem('outside_work_resume_draft')
      setTab(status === 'draft' ? 'drafts' : 'movements')
      setSuccess(l.saved)
    } catch (cause) { setError(getErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  const remove = async (id) => {
    if (busy || !window.confirm(l.confirmDelete)) return
    setBusy(true); setError('')
    try { await deleteOutsideWorkMovement(id); await load(); if (form?.id === id) setForm(null) }
    catch (cause) { setError(getErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  const dateLabel = (date) => !date ? '—' : new Intl.DateTimeFormat(language === 'ar' ? 'ar-CD' : language,
    { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
  const timestamp = (date) => date ? new Intl.DateTimeFormat(language === 'ar' ? 'ar-CD' : language,
    { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Kinshasa' }).format(new Date(date)) : '—'

  return <div className="outside-work-page space-y-6">
    <style>{`@media print { @page { size: A4 portrait; margin: 14mm; }
      .app-sidebar, main > header, .outside-work-page > :not(.outside-work-print) { display: none !important; }
      main, main > div, .outside-work-page { max-width: none !important; width: 100% !important; padding: 0 !important; margin: 0 !important; }
      .outside-work-print { display: block !important; width: 100%; color: #111; }
      .outside-work-print tr { break-inside: avoid; } .outside-work-print thead { display: table-header-group; } }`}</style>
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-2xl font-extrabold">{l.title}</h1><p className="text-sm text-(--muted)">{days[0]} → {days[6]}</p></div>
      <div className="flex flex-wrap gap-3"><label className="text-sm font-semibold">{l.week} <input aria-label={l.week} type="date" value={anchor} onChange={(event) => setAnchor(event.target.value)} className="input-base ms-2" /></label>
        <button type="button" disabled={loading || busy} className="btn-primary" onClick={() => { setForm(newOutsideWorkForm(days.includes(kinshasaClock().date) ? kinshasaClock().date : days[0])); setSuccess('') }}>{l.formTitle}</button></div>
    </header>
    <nav className="flex flex-wrap gap-2" aria-label={l.title}>{[['movements', l.movements, finals.length], ['drafts', l.drafts, drafts.length], ['report', l.report, null]].map(([key, title, count]) => <button key={key} type="button" aria-pressed={tab === key} className={tab === key ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(key)}>{title}{count != null ? ` (${count})` : ''}</button>)}</nav>
    {error && <p role="alert" className="alert alert--error">{error}</p>}
    {success && <p role="status" className="text-sm font-bold text-emerald-700">{success}</p>}
    {form && <OutsideWorkEntryForm key={form.id || 'new'} value={form} onChange={setForm} workers={workers} teams={teams} biometricIds={biometricIds} labels={l} busy={busy}
      onSave={save} onCancel={() => { setForm(null); setParams({}, { replace: true }) }} />}
    {loading && <p>{l.loading}</p>}
    {!loading && tab === 'drafts' && <section className="space-y-3" aria-label={l.drafts}>
      {!drafts.length && <p className="surface-card p-5 text-sm text-(--muted)">{l.noDrafts}</p>}
      {drafts.map((row) => <article key={row.id} className="surface-card space-y-3 border border-amber-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-extrabold">{teamName(row)} · {row.foreman_name || '—'}</h2><p className="text-sm text-(--muted)">{dateLabel(row.work_date)} · {l.selectedWorkers}: {row.outside_work_movement_workers?.length || 0}</p></div><div className="flex gap-2"><button type="button" className="btn-primary" onClick={() => edit(row)}>{l.continue}</button><button type="button" disabled={busy} className="btn-secondary" onClick={() => remove(row.id)}>{l.delete}</button></div></div>
        {row.missing_worker_note && <p className="rounded-lg bg-amber-50 p-2 text-sm">{l.missingWorker}: {row.missing_worker_note}</p>}
        <p className="text-xs text-(--muted)">{l.updated}: {timestamp(row.updated_at)}</p>
      </article>)}
    </section>}
    {!loading && tab === 'movements' && days.map((day) => {
      const rows = finals.filter((movement) => movement.work_date === day)
      return <section key={day} className="surface-card p-4 sm:p-5"><h2 className="mb-3 text-lg font-extrabold">{dateLabel(day)} <span className="text-sm text-(--muted)">({rows.length})</span></h2>
        {!rows.length && <p className="text-sm text-(--muted)">{l.noMovements}</p>}
        <div className="space-y-3">{rows.map((row) => {
          const members = row.outside_work_movement_workers || []
          const open = expanded.includes(row.id)
          const timeKey = (time) => !time ? '' : String(time).length === 5 ? `${time}:00` : String(time)
          const workerRanges = [...new Map(members.map((member) => [`${timeKey(member.start_time)}|${timeKey(member.end_time)}`, member])).values()]
          const workerStart = row.common_worker_start || (workerRanges.length === 1 ? workerRanges[0].start_time : null)
          const workerEnd = row.common_worker_end || (workerRanges.length === 1 ? workerRanges[0].end_time : null)
          const individualTimes = workerRanges.length > 1 || members.some((member) => timeKey(member.start_time) !== timeKey(workerStart) || timeKey(member.end_time) !== timeKey(workerEnd))
          return <article key={row.id} className="rounded-xl border p-3"><div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div><strong className="text-base">{row.foreman_name || teamName(row)}</strong>{row.foreman_name && <p className="text-xs text-(--muted)">{teamName(row)}</p>}</div>
            {hasOutsideWorkForeman(row) && <div className="space-y-1" aria-label={l.foreman}><h3 className="text-sm font-bold">{l.foreman}</h3><p dir="ltr">{formatClock(row.start_time)} → {formatClock(row.end_time)}</p><p className="text-sm text-(--muted)">{l.duration}: {formatDuration(durationMinutes(row.start_time, row.end_time))}</p></div>}
            <div className="space-y-1" aria-label={l.workers}><h3 className="text-sm font-bold">{l.workers}</h3>{workerStart && workerEnd ? <p dir="ltr">{formatClock(workerStart)} → {formatClock(workerEnd)}</p> : <p className="text-sm text-(--muted)">{({ ar: 'أوقات فردية موضحة في تفاصيل العمال', en: 'Individual times shown in worker details', fr: 'Horaires individuels dans les détails des travailleurs' })[language]}</p>}<p className="text-sm text-(--muted)">{l.count}: {members.length}</p></div>
            <div className="ms-auto flex gap-2"><button type="button" className="btn-secondary" aria-expanded={open} onClick={() => setExpanded((current) => open ? current.filter((id) => id !== row.id) : [...current, row.id])}>{`${open ? l.hide : l.show} (${members.length})`}</button>
              <button type="button" className="btn-secondary" onClick={() => edit(row)}>{l.edit}</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => remove(row.id)}>{l.delete}</button></div></div>
            {open && <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr>{[l.workers, l.team, ...(individualTimes ? [l.start, l.end] : [])].map((label) => <th key={label} className="p-2 text-start">{label}</th>)}</tr></thead><tbody>{members.map((member) => <tr key={member.id} className="border-t"><td className="p-2">{member.worker_name}</td><td className="p-2">{workersById.get(String(member.worker_id))?.team_name || '—'}</td>{individualTimes && <><td className="p-2" dir="ltr">{formatClock(member.start_time)}</td><td className="p-2" dir="ltr">{formatClock(member.end_time)}</td></>}</tr>)}</tbody></table></div>}
          </article>
        })}</div>
      </section>
    })}
    {tab === 'report' && <section className="surface-card space-y-4 p-5"><h2 className="text-xl font-extrabold">{l.report}</h2>
      <div className="flex flex-wrap gap-3"><label>{l.foreman} <select aria-label={l.chooseReport} value={reportForeman} onChange={(event) => setReportForeman(event.target.value)} className="ms-2 rounded-lg border p-2"><option value="">{l.chooseReport}</option>{foremen.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <button type="button" disabled={!report.rows.length} className="btn-secondary" onClick={() => window.print()}>{l.print}</button></div>
      {reportForeman && <><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{[l.day, l.date, l.foremanStart, l.foremanEnd, l.overtime, l.count].map((item) => <th key={item} className="p-2 text-start">{item}</th>)}</tr></thead><tbody>{report.rows.map((row) => <tr key={row.id} className="border-t"><td className="p-2">{dateLabel(row.work_date).split(' ')[0]}</td><td className="p-2">{row.work_date}</td><td className="p-2" dir="ltr">{formatClock(row.start_time)}</td><td className="p-2" dir="ltr">{formatClock(row.end_time)}</td><td className="p-2">{formatDuration(row.foremanOvertimeMinutes)}</td><td className="p-2">{row.outside_work_movement_workers?.length || 0}</td></tr>)}</tbody></table></div>
        <div className="flex flex-wrap gap-5 text-sm font-bold"><span>{l.dayCount}: {report.dayCount}</span><span>{l.totalOvertime}: {formatDuration(report.totalOvertimeMinutes)}</span><span>{l.movementCount}: {report.movementCount}</span></div></>}
    </section>}
    <section className="outside-work-print hidden" aria-hidden="true"><h1>{l.report}</h1><h2>{reportName}</h2><p>{days[0]} → {days[6]}</p>
      <table className="w-full border-collapse text-sm"><thead><tr>{[l.day, l.date, l.foremanStart, l.foremanEnd, l.overtime, l.count].map((item) => <th key={item} className="border p-2 text-start">{item}</th>)}</tr></thead><tbody>{report.rows.map((row) => <tr key={row.id}><td className="border p-2">{dateLabel(row.work_date).split(' ')[0]}</td><td className="border p-2">{row.work_date}</td><td className="border p-2">{formatClock(row.start_time)}</td><td className="border p-2">{formatClock(row.end_time)}</td><td className="border p-2">{formatDuration(row.foremanOvertimeMinutes)}</td><td className="border p-2">{row.outside_work_movement_workers?.length || 0}</td></tr>)}</tbody></table>
      <p className="mt-4">{l.dayCount}: {report.dayCount} · {l.totalOvertime}: {formatDuration(report.totalOvertimeMinutes)} · {l.movementCount}: {report.movementCount}</p>
    </section>

  </div>
}
